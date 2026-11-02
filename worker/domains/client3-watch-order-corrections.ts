import {json} from '../core/http.ts'
import type {AuthUser,OrderInput} from '../core/types.ts'
import {getOrder,updateOrderCritical} from './orders-write.ts'

type Meta={orderDate:string;customerName:string;customerPhone:string;city:string;deliveryType:string;comment:string}
type Money={totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number;shippingStatus:string;orderStatus:string}
type RawMeta={requestId?:unknown;expected?:Meta;next?:Meta;expectedState?:Money}
type RawPrices={requestId?:unknown;changes?:Array<{orderItemId:number;unitPrice:number;expectedUnitPrice:number;
 expectedQuantity:number;expectedLineTotal:number;expectedCatalogPriceSnapshot:number|null}>}
const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const str=(v:unknown)=>typeof v==='string'?v.trim():''
const validId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(v)
const metadataKeys=['orderDate','customerName','customerPhone','city','deliveryType','comment'] as const

async function orderAccess(db:D1Database,actor:AuthUser,brandId:number,orderId:number){
 if(!actor||(!actor.managerId&&actor.role!=='admin')||
   actor.employeeRole==='Логист'&&actor.role!=='admin')return false
 if(actor.role!=='admin'){
   const permitted=await db.prepare(`SELECT 1 AS ok FROM watch_manager_brands mb
     JOIN managers m ON m.id=mb.manager_id AND m.is_active=1
     WHERE mb.manager_id=? AND mb.brand_id=?`)
     .bind(actor.managerId,brandId).first<{ok:number}>()
   if(!permitted?.ok)return false
 }
 const row=await db.prepare(`SELECT 1 AS ok FROM watch_order_details wd
   JOIN orders o ON o.id=wd.order_id
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')`)
   .bind(orderId,brandId).first<{ok:number}>()
 return Boolean(row?.ok)
}
const actorLabel=(a:AuthUser)=>a.displayName||a.email||a.role

/** Main's narrow optimistic metadata correction, then synchronize watch-specific
 * recipient projection. Never touch physical stock or historical money.
 * A replay of the same requestId safely completes a pending projection sync.
 */
export async function correctClient3WatchMetadata(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,raw:RawMeta,
):Promise<Response>{
 if(!Number.isSafeInteger(orderId)||orderId<1||!await orderAccess(db,actor,brandId,orderId))
   return fail('WATCH_ORDER_FORBIDDEN','Заказ недоступен в выбранном бренде.',403)
 if(!validId(raw?.requestId))return fail('WATCH_EDIT_REQUEST_INVALID','Нужен идентификатор исправления.',400)
 if(!raw?.expected||!raw.next||!raw.expectedState||
   metadataKeys.some(k=>typeof raw.expected![k]!=='string'||typeof raw.next![k]!=='string'
     ||raw.expected![k].length>500||raw.next![k].length>500)||
   Object.keys(raw.expected).some(k=>!metadataKeys.includes(k as keyof Meta))||
   Object.keys(raw.next).some(k=>!metadataKeys.includes(k as keyof Meta))||
   ['totalAmount','receivedAmount','debtAmount','returnAmount'].some(k=>
     !Number.isSafeInteger((raw.expectedState as unknown as Record<string,unknown>)[k]))||
   typeof raw.expectedState.shippingStatus!=='string'||
   typeof raw.expectedState.orderStatus!=='string')
   return fail('WATCH_METADATA_INVALID','Обновите заказ: не хватает исходных реквизитов и состояния.',400)
 if(actor.role!=='admin'&&raw.next.orderDate!==raw.expected.orderDate)
   return fail('WATCH_MANAGER_DATE_FORBIDDEN','Дату заказа меняет только администратор.',403)
 if(raw.next.customerName.trim()===''||raw.next.customerPhone.trim()===''||
   raw.next.city.trim()===''||raw.next.deliveryType.trim()==='')
   return fail('WATCH_METADATA_REQUIRED','Заполните ФИО, телефон, город и доставку.',400)
 try{
   const payload={requestId:raw.requestId,metadataCorrection:{
     expected:raw.expected,next:raw.next,expectedState:raw.expectedState,
   }} as unknown as OrderInput
   const saved=await updateOrderCritical(db,orderId,payload,actor,actorLabel(actor))
   if(!saved?.ok)throw new Error('Main не подтвердил исправление.')
   // No blind overwrite: old watch projection or already-applied next projection
   // is required. This is safe across retries after Main committed the correction.
   const old=raw.expected,next=raw.next
   const batch=await db.batch([
     db.prepare(`UPDATE watch_order_details SET
         recipient_name=?,recipient_phone=?,city=?,delivery_method=?,updated_at=?
       WHERE order_id=? AND brand_id=?
         AND ((recipient_name=? AND recipient_phone=? AND city=? AND delivery_method=?)
           OR (recipient_name=? AND recipient_phone=? AND city=? AND delivery_method=?))`)
       .bind(next.customerName.trim(),next.customerPhone.trim(),next.city.trim(),next.deliveryType.trim(),
         new Date().toISOString(),orderId,brandId,
         old.customerName,old.customerPhone,old.city,old.deliveryType,
         next.customerName.trim(),next.customerPhone.trim(),next.city.trim(),next.deliveryType.trim()),
     db.prepare(`SELECT json('WATCH_METADATA_PROJECTION_STALE') WHERE NOT EXISTS (
       SELECT 1 FROM watch_order_details
       WHERE order_id=? AND brand_id=? AND recipient_name=? AND recipient_phone=?
         AND city=? AND delivery_method=?)`)
       .bind(orderId,brandId,next.customerName.trim(),next.customerPhone.trim(),
         next.city.trim(),next.deliveryType.trim()),
   ])
   return json({ok:true,orderId,mainOrderEdited:true,watchProjectionSynced:true,
     alreadyCommitted:Boolean((saved as Record<string,unknown>).alreadyCommitted),
     changes:Number(batch[0]?.meta?.changes||0)})
 }catch(cause){
   return fail('WATCH_METADATA_CONFLICT',cause instanceof Error?cause.message:'Заказ изменился. Обновите список.')
 }
}
/** Main's narrowly-scoped price correction supports sent orders where safe
 * and rejects stale snapshots, overpayment or linked operation corruption.
 */
export async function correctClient3WatchItemPrices(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,raw:RawPrices,
):Promise<Response>{
 if(!Number.isSafeInteger(orderId)||orderId<1||!await orderAccess(db,actor,brandId,orderId))
   return fail('WATCH_ORDER_FORBIDDEN','Заказ недоступен в выбранном бренде.',403)
 if(!validId(raw?.requestId))return fail('WATCH_EDIT_REQUEST_INVALID','Нужен идентификатор исправления.',400)
 const changes=raw?.changes
 if(!Array.isArray(changes)||changes.length<1||changes.length>20)
   return fail('WATCH_PRICE_INVALID','Выберите позиции для исправления цены.',400)
 const ids=new Set<number>()
 for(const change of changes){
   if(!change||!Number.isSafeInteger(change.orderItemId)||change.orderItemId<1||
     ids.has(change.orderItemId)||!Number.isSafeInteger(change.unitPrice)||change.unitPrice<0||
     !Number.isSafeInteger(change.expectedUnitPrice)||change.expectedUnitPrice<0||
     !Number.isSafeInteger(change.expectedQuantity)||change.expectedQuantity<1||
     !Number.isSafeInteger(change.expectedLineTotal)||change.expectedLineTotal<0||
     (change.expectedCatalogPriceSnapshot!==null&&
       (!Number.isSafeInteger(change.expectedCatalogPriceSnapshot)||change.expectedCatalogPriceSnapshot<0)))
       return fail('WATCH_PRICE_INVALID','Для каждой цены укажите позицию и исходные значения.',400)
   ids.add(change.orderItemId)
   const row=await db.prepare(`SELECT oi.id FROM order_items oi
     JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
     JOIN watch_variants v ON v.id=wi.watch_variant_id AND v.catalog_variant_id=oi.variant_id
     JOIN watch_products p ON p.id=v.watch_product_id AND p.brand_id=?
     WHERE oi.id=? AND oi.order_id=? AND oi.quantity>0`)
     .bind(brandId,change.orderItemId,orderId).first<{id:number}>()
   if(!row)return fail('WATCH_PRICE_SKU_MISMATCH','Позиция не относится к выбранному заказу и бренду.',403)
 }
 try{
   const payload={requestId:raw.requestId,itemPriceCorrections:changes} as unknown as OrderInput
   const saved=await updateOrderCritical(db,orderId,payload,actor,actorLabel(actor))
   if(!saved?.ok)throw new Error('Main не подтвердил исправление цены.')
   return json({ok:true,orderId,mainPriceCorrection:true,refreshRequired:true})
 }catch(cause){
   return fail('WATCH_PRICE_CONFLICT',cause instanceof Error?cause.message:'Цена или оплата изменились. Обновите заказ.')
 }
}
