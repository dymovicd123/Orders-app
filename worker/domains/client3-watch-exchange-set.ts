import {json} from '../core/http.ts'
import type {AuthUser,OrderInput} from '../core/types.ts'
import {createExchangeSetV2} from './returns-exchanges.ts'
import {WATCH_ITEM_ISSUED_SQL,WATCH_ITEM_RETURNED_SQL} from './client3-watch-item-projection.ts'
import {ensureManualWatchOrderSku,type ManualWatchOrderItem} from './client3-watch-order-manual.ts'
import type {WatchSource} from '../../shared/client3/watch-domain.ts'

type Old={orderItemId:number;quantity:number;physicalState:'not_issued'|'pending';
 expectedActiveQuantity:number;expectedUnitPrice:number;
 expectedLineTotal:number;expectedCatalogPriceSnapshot:number|null}
type New={manual:ManualWatchOrderItem;quantity:number;unitPrice:number;
 source:WatchSource;engravingText:string}
type Part={method:string;amount:number}
type Input={requestId?:unknown;expectedOrderTotal?:unknown;
 oldItems?:Old[];newItems?:New[];paymentParts?:Part[];refundParts?:Part[];
 reason?:unknown}
const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const validKey=(v:unknown)=>typeof v==='string'&&
 /^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(v)
const dateAlmaty=()=>new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
const sum=(rows:Part[])=>rows.reduce((n,p)=>n+p.amount,0)
export async function exchangeClient3WatchSet(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,raw:Input,
):Promise<Response>{
 if(!actor||(actor.employeeRole==='Логист'&&actor.role!=='admin'))
   return fail('WATCH_EXCHANGE_FORBIDDEN','Обмен оформляет менеджер или администратор.',403)
 if(!Number.isSafeInteger(brandId)||brandId<1||!Number.isSafeInteger(orderId)||orderId<1||
   !validKey(raw?.requestId))
   return fail('WATCH_EXCHANGE_INVALID','Выберите заказ и уникальный идентификатор операции.',400)
 if(!Array.isArray(raw.oldItems)||!raw.oldItems.length||raw.oldItems.length>20||
   !Array.isArray(raw.newItems)||!raw.newItems.length||raw.newItems.length>20)
   return fail('WATCH_EXCHANGE_SELECT','Выберите старые часы и добавьте новые, до 20 позиций.',400)
 const reason=typeof raw.reason==='string'?raw.reason.trim():''
 if(!reason||reason.length>300)
   return fail('WATCH_EXCHANGE_REASON','Укажите причину обмена.',400)
 const o=await db.prepare(`SELECT o.id,o.total_amount,o.received_amount,o.return_amount,
   o.order_status,o.pricing_mode FROM orders o
   JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=?`).bind(orderId,brandId)
   .first<Record<string,unknown>>()
 if(!o)return fail('WATCH_EXCHANGE_NOT_FOUND','Заказ отсутствует в выбранном бренде.',404)
 if(o.order_status==='deleted'||o.order_status==='archived'||o.pricing_mode!=='itemized_v1')
   return fail('WATCH_EXCHANGE_CLOSED','Обмен недоступен для закрытого или исторического заказа.',409)
 const prior=await db.prepare(`SELECT status,target_id FROM critical_operations
   WHERE operation_type='exchange_set_create' AND request_id=?`)
   .bind(raw.requestId).first<{status:string;target_id:number|null}>()
 if(!prior&&Number(raw.expectedOrderTotal)!==Number(o.total_amount))
   return fail('WATCH_EXCHANGE_TOTAL_STALE','Итог заказа изменился. Обновите карточку.',409)
 const unique=new Set<number>()
 const ids=raw.oldItems.map(x=>Number(x.orderItemId))
 if(ids.some(id=>!Number.isSafeInteger(id)||id<1||unique.has(id)||!unique.add(id)))
   return fail('WATCH_EXCHANGE_OLD_INVALID','Выберите уникальные старые позиции.',400)
 const oldRows=await db.prepare(`SELECT oi.id,oi.quantity,oi.unit_price,oi.line_total,
   ${WATCH_ITEM_ISSUED_SQL} AS issued_quantity,
   ${WATCH_ITEM_RETURNED_SQL} AS returned_quantity,
   oi.catalog_price_snapshot,oi.variant_id,wi.watch_variant_id,
   wp.brand_id FROM order_items oi
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id
   WHERE oi.order_id=? AND oi.id IN (${ids.map(()=>'?').join(',')})`)
   .bind(orderId,...ids).all<Record<string,unknown>>()
 const found=new Map((oldRows.results||[]).map(r=>[Number(r.id),r]))
 if(found.size!==ids.length||[...found.values()].some(r=>Number(r.brand_id)!==brandId))
   return fail('WATCH_EXCHANGE_BRAND','Старые часы не принадлежат выбранному бренду.',403)

 for(const line of raw.oldItems){
   const snapshot=found.get(line.orderItemId)!
   const retry=prior?.status==='started'||prior?.status==='completed'
   if(!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>1000||
     !['not_issued','pending'].includes(line.physicalState)||
     line.expectedUnitPrice!==Number(snapshot.unit_price)||
     line.expectedLineTotal!==Number(snapshot.line_total)&&!retry||
     line.expectedActiveQuantity!==Number(snapshot.quantity)&&!retry||
     line.expectedCatalogPriceSnapshot!==(snapshot.catalog_price_snapshot==null?null:Number(snapshot.catalog_price_snapshot)))
     return fail('WATCH_EXCHANGE_OLD_STALE','Характеристики или количество старых часов изменились. Обновите заказ.',409)
   // One outgoing watch is distinct from an unsent reserved watch. The
   // physical state must agree with exact dispatch evidence before Main can
   // create any exchange movements or financial entries.
   if(!retry){
     const issued=Math.min(Number(snapshot.quantity),Math.max(0,Number(snapshot.issued_quantity)))
     const returned=Math.max(0,Number(snapshot.returned_quantity))
     const limit=line.physicalState==='pending'
       ?Math.max(0,issued-returned)
       :Math.max(0,Number(snapshot.quantity)-issued)
     if(line.quantity>limit)return fail('WATCH_EXCHANGE_OLD_PHYSICAL_STATE',
       line.physicalState==='pending'
         ?'Выбранные часы не выдавались клиенту в указанном количестве. Для неотправленных позиций выберите «Ещё не отправляли».'
         :'Часы уже отправлены клиенту. Для них необходимо оформить физический возврат при обмене.',409)
   }
 }
 for(const line of raw.newItems){
   if(!line||!['office','showcase'].includes(line.source)||
     !Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>1000||
     !Number.isSafeInteger(line.unitPrice)||line.unitPrice<0||line.unitPrice>1_000_000_000||
     typeof line.engravingText!=='string'||line.engravingText.length>500||
     !line.manual||!line.manual.modelName?.trim())
     return fail('WATCH_EXCHANGE_NEW_INVALID','Заполните новые часы, источник, количество и цену.',400)
 }
 const paymentParts=raw.paymentParts||[],refundParts=raw.refundParts||[]
 if(!Array.isArray(paymentParts)||paymentParts.length>3||
   !Array.isArray(refundParts)||refundParts.length>3||
   [...paymentParts,...refundParts].some(x=>!x||!Number.isSafeInteger(x.amount)||
     x.amount<1||typeof x.method!=='string'||!x.method.trim()))
   return fail('WATCH_EXCHANGE_MONEY_INVALID','Некорректные способы или суммы оплаты.',400)
 const available=await db.prepare(`SELECT value FROM watch_reference_values
   WHERE kind='paymentMethods' AND is_active=1`).all<{value:string}>()
 if([...paymentParts,...refundParts].some(x=>!(available.results||[]).some(v=>
   v.value.toLocaleUpperCase('ru-RU')===x.method.trim().toLocaleUpperCase('ru-RU'))))
   return fail('WATCH_EXCHANGE_METHOD','Способ оплаты отсутствует в общем справочнике.',400)
 const canonical:NonNullable<OrderInput['items']>=[]
 const watchLines:Array<{watchVariantId:number;catalogProductId:number;
   catalogVariantId:number;engravingText:string}>=[]
 try{
   for(const newLine of raw.newItems){
     const selected=await ensureManualWatchOrderSku(db,actor,brandId,newLine.manual)
     const sku=await db.prepare(`SELECT wv.id,wp.catalog_product_id AS productId,
       wv.catalog_variant_id AS variantId,cp.name AS productName,
       cv.gender,cv.color,cv.material,cv.length,cv.size_label AS size,
       cv.category,ep.sale_price AS catalogPrice
       FROM watch_variants wv JOIN watch_products wp ON wp.id=wv.watch_product_id
       JOIN catalog_products cp ON cp.id=wp.catalog_product_id
       JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id
       LEFT JOIN catalog_execution_prices ep ON ep.stock_position_id=cv.stock_position_id
         AND ep.category=COALESCE(cv.category,'adult')
       WHERE wv.id=? AND wp.brand_id=?`)
       .bind(selected.watchVariantId,brandId).first<Record<string,unknown>>()
     if(!sku||!sku.variantId||!sku.productId)
       return fail('WATCH_EXCHANGE_SKU','Новая комплектация не найдена в выбранном бренде.',409)
     canonical.push({
       productName:String(sku.productName),quantity:newLine.quantity,
       unitPrice:newLine.unitPrice,sourceType:newLine.source==='office'?'warehouse':'boutique',
       catalogPriceSnapshot:sku.catalogPrice===null?null:Number(sku.catalogPrice),
       audienceType:'ВЗРОСЛЫЙ',gender:String(sku.gender||''),
       color:String(sku.color||''),material:String(sku.material||''),
       length:String(sku.length||''),size:String(sku.size||''),
       shipmentState:'pending',shortageAcknowledged:true,
     } as NonNullable<OrderInput['items']>[number])
     watchLines.push({watchVariantId:Number(sku.id),catalogProductId:Number(sku.productId),
       catalogVariantId:Number(sku.variantId),engravingText:newLine.engravingText.trim()})
   }
   const paymentAmount=sum(paymentParts)
   const settled=await createExchangeSetV2(db,{
     requestId:raw.requestId as string,orderId,exchangeDate:dateAlmaty(),
     expectedOrderTotal:Number(raw.expectedOrderTotal),
     oldItems:raw.oldItems,newItems:canonical,
     paymentAmount,paymentMethod:paymentParts[0]?.method||'',
     refundMethod:refundParts[0]?.method||'',
     paymentParts:paymentParts.length?paymentParts:undefined,
     refundParts:refundParts.length?refundParts:undefined,
     comment:reason,
   },{watchCommit:{brandId,lines:watchLines}})
   if(!settled||typeof settled!=='object'||!('ok' in settled)||settled.ok!==true)
     return fail('WATCH_EXCHANGE_NOT_APPLIED','Main не подтвердил обмен.',409)
   return json({...settled,orderId,brandId,physicalOldIntakePending:raw.oldItems.some(x=>x.physicalState==='pending'),
     newShippingStatus:'pending'})
 }catch(cause){
   return fail('WATCH_EXCHANGE_FAILED',
     cause instanceof Error?cause.message:'Обмен не завершён. Повторите исходный запрос.',409)
 }
}
