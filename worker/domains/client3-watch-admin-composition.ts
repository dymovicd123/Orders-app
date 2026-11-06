import {json} from '../core/http.ts'
import type {AuthUser,OrderInput} from '../core/types.ts'
import {getOrder,updateOrderCritical} from './orders-write.ts'
import {ensureManualWatchOrderSku,type ManualWatchOrderItem} from './client3-watch-order-manual.ts'
import type {WatchRewriteLine} from './client3-watch-edit-attach.ts'

type Snapshot={orderItemId:number;watchVariantId:number;quantity:number;
 unitPrice:number;source:'office'|'showcase';engravingText:string;catalogPriceSnapshot:number|null}
type Incoming={orderItemId?:number|null;watchVariantId?:number;
 manual?:ManualWatchOrderItem;source:'office'|'showcase';quantity:number;unitPrice:number;
 engravingText:string}
type Request={requestId?:unknown;expected?:Snapshot[];items?:Incoming[]}
const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const validRequest=(v:unknown):v is string=>
 typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(v)
/** Brand-scoped, strictly admin-only, exact SKU rewrite. Main retires rows
 * and replaces reserves; its critical operation attaches per-watch identity
 * before final completion. Neither caller nor manager can mutate raw stock.
 */
export async function rewriteClient3AdminWatchItems(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,raw:Request,
):Promise<Response>{
 if(actor?.role!=='admin')
   return fail('WATCH_REWRITE_ADMIN_ONLY','Состав заказа редактирует только администратор.',403)
 if(!Number.isSafeInteger(brandId)||brandId<1||!Number.isSafeInteger(orderId)||orderId<1)
   return fail('WATCH_REWRITE_SCOPE','Выберите заказ и бренд.',400)
 if(!validRequest(raw?.requestId))
   return fail('WATCH_REWRITE_REQUEST','Некорректный номер операции.',400)
 if(!Array.isArray(raw?.expected)||!Array.isArray(raw?.items)||
   !raw.expected.length||raw.expected.length>20||!raw.items.length||raw.items.length>20)
   return fail('WATCH_REWRITE_ITEMS','В заказе должно быть от 1 до 20 товаров.',400)
 const ids=new Set<number>()
 for(const line of raw.expected){
   if(!line||!Number.isSafeInteger(line.orderItemId)||line.orderItemId<1||
     !Number.isSafeInteger(line.watchVariantId)||line.watchVariantId<1||
     !Number.isSafeInteger(line.quantity)||line.quantity<1||
     !Number.isSafeInteger(line.unitPrice)||line.unitPrice<0||
     !['office','showcase'].includes(line.source)||
     typeof line.engravingText!=='string'||ids.has(line.orderItemId)||
     (line.catalogPriceSnapshot!==null&&
       (!Number.isSafeInteger(line.catalogPriceSnapshot)||line.catalogPriceSnapshot<0)))
     return fail('WATCH_REWRITE_EXPECTED','Обновите заказ: исходные позиции не определены.',400)
   ids.add(line.orderItemId)
 }
 const carried=new Set<number>()
 for(const line of raw.items){
   const oldId=Number(line?.orderItemId||0)
   if(!line||!['office','showcase'].includes(line.source)||
     !Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>1000||
     !Number.isSafeInteger(line.unitPrice)||line.unitPrice<0||line.unitPrice>1_000_000_000||
     typeof line.engravingText!=='string'||line.engravingText.length>500||
     (oldId&&(!Number.isSafeInteger(oldId)||!ids.has(oldId)||carried.has(oldId)))||
     (!line.manual&&(!Number.isSafeInteger(line.watchVariantId)||Number(line.watchVariantId)<1)))
     return fail('WATCH_REWRITE_LINE','Проверьте источник, характеристики, количество и цену каждого товара.',400)
   if(oldId)carried.add(oldId)
 }
 const belongs=await db.prepare(`SELECT o.id,o.order_status,o.shipping_status,o.pricing_mode,
   o.total_amount,o.received_amount,o.debt_amount
   FROM orders o JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=?`).bind(orderId,brandId).first<Record<string,unknown>>()
 if(!belongs)return fail('WATCH_REWRITE_NOT_FOUND','Заказ не найден в выбранном бренде.',404)
 if(belongs.order_status!=='active'||belongs.shipping_status==='sent'||belongs.pricing_mode!=='itemized_v1')
   return fail('WATCH_REWRITE_CLOSED','Состав отправленного или закрытого заказа нельзя переписывать.',409)
 const relations=await db.prepare(`SELECT oi.id AS orderItemId,wi.watch_variant_id AS watchVariantId,
     oi.quantity,oi.unit_price AS unitPrice,oi.source_type AS source,
     wi.engraving_text AS engravingText,oi.catalog_price_snapshot AS catalogPriceSnapshot,
     oi.product_id AS catalogProductId,oi.variant_id AS catalogVariantId,
     wp.brand_id AS watchBrandId
     FROM order_items oi LEFT JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
     LEFT JOIN watch_variants wv ON wv.id=wi.watch_variant_id
     LEFT JOIN watch_products wp ON wp.id=wv.watch_product_id
     WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`).bind(orderId)
     .all<Record<string,unknown>>()
 const existing=relations.results||[]
 if(existing.length!==raw.expected.length||existing.some(row=>
   !row.watchVariantId||Number(row.watchBrandId)!==brandId))
   return fail('WATCH_REWRITE_STALE','Состав часов изменился. Обновите карточку.',409)
 const expected=raw.expected
 for(let i=0;i<existing.length;i++){
   const row=existing[i],old=expected.find(x=>x.orderItemId===row.orderItemId)
   if(!old||old.watchVariantId!==row.watchVariantId||old.quantity!==row.quantity||
     old.unitPrice!==row.unitPrice||
     old.source!==(row.source==='warehouse'?'office':'showcase')||
     old.engravingText!==row.engravingText||
     old.catalogPriceSnapshot!==row.catalogPriceSnapshot)
     return fail('WATCH_REWRITE_STALE','Состав или цена уже изменились. Обновите заказ.',409)
 }
 const linked=await db.prepare(`SELECT
   (SELECT COUNT(*) FROM returns WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled') AS returnCount,
   (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=? AND status='fulfilled') AS handovers,
   (SELECT COUNT(*) FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
     WHERE d.order_id=? AND di.quantity>COALESCE(di.cancelled_quantity,0)) AS sentCount
 `).bind(orderId,orderId,orderId).first<Record<string,number>>()
 if(Number(linked?.returnCount||0)+
   Number(linked?.handovers||0)+Number(linked?.sentCount||0)>0)
   return fail('WATCH_REWRITE_LIFECYCLE','Есть отправленные товары или возвраты. Изменение состава заблокировано.',409)
 if(existing.reduce((sum,row)=>sum+Number(row.quantity)*Number(row.unitPrice),0)!==
    Number(belongs.total_amount))
   return fail('WATCH_REWRITE_MONEY','Итог заказа не совпадает с действующим составом. Нужна сверка.',409)
 const requested:WatchRewriteLine[]=[]
 const canonical:Array<Record<string,unknown>>=[]
 try{
   for(const line of raw.items){
     const selected=line.manual
       ?await ensureManualWatchOrderSku(db,actor,brandId,line.manual)
       :{watchVariantId:Number(line.watchVariantId),catalogVariantId:0}
     const sku=await db.prepare(`SELECT wv.id AS watchVariantId,wv.catalog_variant_id AS catalogVariantId,
       wp.catalog_product_id AS catalogProductId,cp.name AS productName,
       wp.is_active AS modelActive,wv.is_active AS watchActive,cv.is_active AS catalogActive,
       (SELECT ep.sale_price FROM catalog_execution_prices ep WHERE ep.stock_position_id=cv.stock_position_id
         AND ep.category=COALESCE(cv.category,'adult') LIMIT 1) AS catalogPrice
       FROM watch_variants wv JOIN watch_products wp ON wp.id=wv.watch_product_id
       JOIN catalog_products cp ON cp.id=wp.catalog_product_id
       JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id
       WHERE wv.id=? AND wp.brand_id=?`).bind(selected.watchVariantId,brandId)
       .first<Record<string,unknown>>()
     if(!sku||Number(sku.watchActive)!==1||Number(sku.modelActive)!==1||Number(sku.catalogActive)!==1)
       return fail('WATCH_REWRITE_SKU','Выбранные часы отсутствуют в активном каталоге бренда.',409)
     const previous=line.orderItemId?existing.find(row=>row.orderItemId===line.orderItemId):undefined
     const snapshot=previous&&Number(previous.catalogVariantId)===Number(sku.catalogVariantId)
       ?previous.catalogPriceSnapshot
       :sku.catalogPrice===null?null:Number(sku.catalogPrice)
     const source=line.source==='office'?'warehouse':'boutique'
     canonical.push({
       productName:String(sku.productName),audienceType:'ВЗРОСЛЫЙ',
       sourceType:source,quantity:line.quantity,unitPrice:line.unitPrice,
       catalogPriceSnapshot:snapshot,
       ...(line.orderItemId?{orderItemId:line.orderItemId}:{}),
       shortageAcknowledged:true,
     })
     requested.push({orderItemId:line.orderItemId||null,
       watchVariantId:Number(sku.watchVariantId),
       catalogProductId:Number(sku.catalogProductId),
       catalogVariantId:Number(sku.catalogVariantId),
       source:line.source,quantity:line.quantity,unitPrice:line.unitPrice,
       engravingText:line.engravingText.trim()})
   }
   const sum=requested.reduce((v,x)=>v+x.quantity*x.unitPrice,0)
   if(!Number.isSafeInteger(sum)||sum>1_000_000_000||
      sum<Number(belongs.received_amount))
     return fail('WATCH_REWRITE_TOTAL','Итог нового состава меньше проведённых оплат или слишком велик.',409)
   const active=await getOrder(db,orderId)
   if(!active||!Array.isArray(active.items)||active.items.length!==existing.length)
     return fail('WATCH_REWRITE_ORDER_STALE','Состав заказа уже изменился. Обновите карточку.',409)
   const expectedItems=active.items.map(row=>({...row,orderItemId:row.id}))
   const done=await updateOrderCritical(db,orderId,{
     requestId:raw.requestId,
     itemContentReplacement:{expectedItems,items:canonical},
   } as unknown as OrderInput,actor,actor.displayName||actor.email||'Администратор',{
     watchRewrite:{brandId,lines:requested},
   })
   if(!(done as {ok?:boolean}|null)?.ok)
     return fail('WATCH_REWRITE_NOT_CONFIRMED','Main не подтвердил изменение состава.')
   const updated=await db.prepare(`SELECT COUNT(*) AS n FROM order_items oi
     JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
     JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
     JOIN watch_products wp ON wp.id=wv.watch_product_id AND wp.brand_id=?
     WHERE oi.order_id=? AND oi.quantity>0`).bind(brandId,orderId).first<{n:number}>()
   if(Number(updated?.n)!==requested.length)
     return fail('WATCH_REWRITE_RECHECK','Состав изменён, но не все связи часов подтверждены. Повторите тот же запрос.')
   return json({ok:true,orderId,updatedLines:requested.length,mainReservationRewrite:true})
 }catch(cause){
   return fail('WATCH_REWRITE_CONFLICT',
     cause instanceof Error?cause.message:'Редактирование прервано. Обновите заказ.',409)
 }
}
