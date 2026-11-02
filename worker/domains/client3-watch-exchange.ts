import {json} from '../core/http.ts'
import type {AuthUser,OrderInput} from '../core/types.ts'
import {createExchange} from './returns-exchanges.ts'
import {watchSourceToLegacy,type WatchSource} from '../../shared/client3/watch-domain.ts'
import type {WatchExchangeCommit} from './client3-watch-exchange-commit.ts'

const deny=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const dateAlmaty=()=>new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
/**
 * First safe Client3 exchange: full single-watch replacement, same brand,
 * same actual sale price, shipped original, replacement initially NOT shipped.
 * Does not touch cash. Main owns all reserves, return lifecycle and business rows.
 */
export async function exchangeClient3Watch(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
 input:{requestId?:unknown;newWatchVariantId?:unknown;newSource?:unknown;engravingText?:unknown;reason?:unknown},
){
 if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
   return deny('WATCH_EXCHANGE_FORBIDDEN','Обмен оформляет менеджер или администратор.',403)
 const newWatchVariantId=Number(input.newWatchVariantId)
 if(!Number.isSafeInteger(orderId)||orderId<1||
   !Number.isSafeInteger(newWatchVariantId)||newWatchVariantId<1||
   typeof input.requestId!=='string'||!/^[A-Za-z0-9._:-]{15,119}$/.test(input.requestId))
   return deny('WATCH_EXCHANGE_INPUT_INVALID','Укажите заказ, новую комплектацию и уникальный идентификатор.',400)
 if(input.newSource!=='office'&&input.newSource!=='showcase')
   return deny('WATCH_EXCHANGE_SOURCE_INVALID','Выберите офис или витрину.',400)
 if(typeof input.engravingText!=='string'||input.engravingText.length>500)
   return deny('WATCH_EXCHANGE_ENGRAVING_INVALID','Текст гравировки должен быть не длиннее 500 символов.',400)
 const reason=typeof input.reason==='string'?input.reason.trim():''
 if(!reason||reason.length>300)return deny('WATCH_EXCHANGE_REASON_REQUIRED','Укажите причину обмена.',400)
 const source=watchSourceToLegacy(input.newSource as WatchSource)
 const order=await db.prepare(`
   SELECT o.id,o.order_status,o.shipping_status,o.total_amount,o.pricing_mode,
     wd.brand_id FROM orders o JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? LIMIT 1
 `).bind(orderId,brandId).first<Record<string,unknown>>()
 if(!order)return deny('WATCH_EXCHANGE_NOT_FOUND','Заказ отсутствует в выбранном бренде.',404)
 if(order.order_status==='archived'||order.order_status==='deleted')
   return deny('WATCH_EXCHANGE_CLOSED','Заказ закрыт.')
 if(order.shipping_status!=='sent'||order.pricing_mode!=='itemized_v1')
   return deny('WATCH_EXCHANGE_SHIPMENT_REQUIRED','Пока поддерживается обмен только полностью отправленных часов с построчным расчётом.')
 const oldLines=await db.prepare(`
   SELECT oi.id,oi.quantity,oi.unit_price,oi.line_total,oi.catalog_price_snapshot,
     oi.stock_writeoff_status,oi.variant_id,oi.is_workshop,oi.source_type,wi.watch_variant_id,
     wp.brand_id AS item_brand
   FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id
   WHERE oi.order_id=? AND oi.quantity>0 LIMIT 3
 `).bind(orderId).all<Record<string,unknown>>()
 const lines=oldLines.results||[]
 const current=await db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=? AND quantity>0')
   .bind(orderId).first<{n:number}>()
 if(Number(current?.n)!==1||lines.length!==1||Number(lines[0].quantity)!==1||
    Number(lines[0].is_workshop)!==0||Number(lines[0].item_brand)!==brandId)
   return deny('WATCH_EXCHANGE_COMPLEX','Нужна проверка состава: разрешён обмен только одной активной позиции в количестве 1 шт.')
 const old=lines[0]
 const physical=await db.prepare(`
   SELECT COALESCE(SUM(di.quantity-di.cancelled_quantity),0) AS sent
   FROM order_dispatch_items di WHERE di.order_item_id=?
 `).bind(old.id).first<{sent:number}>()
 if(Number(physical?.sent)!==1)
   return deny('WATCH_EXCHANGE_NOT_PHYSICALLY_SENT','У исходных часов нет подтверждённой физической отправки.')
 const already=await db.prepare(`
   SELECT COALESCE(SUM(ri.quantity),0) AS count FROM return_items ri
   JOIN returns r ON r.id=ri.return_id WHERE ri.order_item_id=?
     AND COALESCE(r.status,'completed')<>'cancelled'
 `).bind(old.id).first<{count:number}>()
 if(Number(already?.count)>0)
   return deny('WATCH_EXCHANGE_ALREADY_RETURNED','Исходный товар уже участвовал в возврате.')
 const sku=await db.prepare(`
   SELECT wv.catalog_variant_id AS variantId,wp.catalog_product_id AS productId,
    cp.name AS productName,cv.gender,cv.color,cv.material,cv.length,cv.size_label AS size,
    cv.category,ep.sale_price AS catalogPrice
   FROM watch_variants wv JOIN watch_products wp ON wp.id=wv.watch_product_id
   JOIN catalog_products cp ON cp.id=wp.catalog_product_id AND cp.is_active=1
   JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.product_id=cp.id AND cv.is_active=1
   JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.is_active=1
   LEFT JOIN catalog_execution_prices ep ON ep.stock_position_id=sp.id
     AND ep.category=COALESCE(cv.category,'adult')
   WHERE wv.id=? AND wp.brand_id=? AND wv.is_active=1 AND wp.is_active=1 LIMIT 1
 `).bind(newWatchVariantId,brandId).first<Record<string,unknown>>()
 if(!sku||!sku.variantId||!sku.productId)
   return deny('WATCH_EXCHANGE_SKU_INVALID','Новая комплектация отсутствует в активном каталоге бренда.')
 if(Number(sku.variantId)===Number(old.variant_id))
   return deny('WATCH_EXCHANGE_SAME_SKU','Для обмена выберите другую комплектацию.')
 const count=await db.prepare(`
   SELECT COALESCE(SUM(quantity),0) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved
   FROM inventory_stock WHERE variant_id=? AND inventory_source=?
 `).bind(sku.variantId,source).first<{physical:number;reserved:number}>()
 const ledger=await db.prepare(`
   SELECT COALESCE(SUM(quantity),0) AS reserved
   FROM inventory_reservations WHERE variant_id=? AND inventory_source=? AND status='active'
 `).bind(sku.variantId,source).first<{reserved:number}>()
 if(Number(count?.physical||0)-Math.max(Number(count?.reserved||0),Number(ledger?.reserved||0))<1)
   return deny('WATCH_EXCHANGE_NO_STOCK','Новая комплектация отсутствует в свободном остатке.')
 // No unreviewed money movements in the first exchange release.
 const price=Number(old.unit_price)
 if(!Number.isSafeInteger(price)||price<0||Number(old.line_total)!==price
   ||Number(order.total_amount)!==price)
   return deny('WATCH_EXCHANGE_PRICE_COMPLEX','Для этого обмена требуется отдельное согласование расчёта.')
 const catalogPrice=sku.catalogPrice==null?null:Number(sku.catalogPrice)
 const newItem:NonNullable<OrderInput['items']>[number]={
   productName:String(sku.productName),quantity:1,unitPrice:price,
   catalogPriceSnapshot:catalogPrice,sourceType:source,shortageAcknowledged:true,
   audienceType:'ВЗРОСЛЫЙ',gender:String(sku.gender||''),color:String(sku.color||''),
   material:String(sku.material||''),length:String(sku.length||''),size:String(sku.size||''),
   shipmentState:'pending',
 } as NonNullable<OrderInput['items']>[number]
 const commit:WatchExchangeCommit={
   brand:brandId===1?'TAUWACH':'WACHIZEN',brandId,oldOrderItemId:Number(old.id),
   watchVariantId:newWatchVariantId,catalogProductId:Number(sku.productId),
   catalogVariantId:Number(sku.variantId),source,engravingText:input.engravingText.trim(),
 }
 try{
   const result=await createExchange(db,{
     requestId:input.requestId,orderId,exchangeDate:dateAlmaty(),
     oldItemId:Number(old.id),oldQuantity:1,oldPhysicalState:'pending',
     oldReturnSource:'none',newItem,newSourceWasManuallyChanged:true,
     expectedOrderTotal:price,expectedOldActiveQuantity:1,
     expectedOldUnitPrice:price,expectedOldLineTotal:price,
     expectedOldCatalogPriceSnapshot:old.catalog_price_snapshot==null?null:Number(old.catalog_price_snapshot),
     financialAction:'none',financialAmount:0,comment:reason,
   },commit)
   if(!result||typeof result!=='object'||!('ok' in result)||result.ok!==true)
     return deny('WATCH_EXCHANGE_NOT_APPLIED','Обмен не был подтверждён складским ядром.')
   return json({...result,brandId,oldOrderItemId:Number(old.id),
     newWatchVariantId,newShippingStatus:'pending',
     physicalOldIntakePending:true,
     notice:'Новые часы зарезервированы. Отправка и приём старых часов выполняются отдельно.'})
 }catch(cause){
   return deny('WATCH_EXCHANGE_FAILED',cause instanceof Error?cause.message:'Обмен не выполнен.')
 }
}
