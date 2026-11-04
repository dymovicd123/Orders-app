import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {recoverPendingOrderReservationsBeforeShipping} from './reservation-admission.ts'

const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})

/** Activate only existing, unresolved watch reservations after real stock
 * arrives. Main owns the guarded stock claim and records no physical arrival.
 */
export async function retryClient3WatchReservations(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
){
 if(!actor?.id||['Завсклад','Упаковщик'].includes(actor.employeeRole||'')&&actor.role!=='admin'||
   actor.role!=='admin'&&actor.role!=='manager')
   return fail('WATCH_RESERVE_FORBIDDEN','Резерв может проверить менеджер, логист или администратор.',403)
 if(!Number.isSafeInteger(orderId)||orderId<1)
   return fail('WATCH_RESERVE_ORDER_INVALID','Выберите заказ.',400)
 const own=await db.prepare(`
   SELECT o.id,o.order_status FROM orders o
   JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('archived','deleted')
 `).bind(orderId,brandId).first<{id:number;order_status:string}>()
 if(!own)return fail('WATCH_RESERVE_NOT_FOUND','Заказ не принадлежит выбранному бренду.',404)
 const invalid=await db.prepare(`
   SELECT oi.id FROM order_items oi WHERE oi.order_id=? AND oi.quantity>0
     AND NOT EXISTS (
       SELECT 1 FROM watch_order_item_details wi
       JOIN watch_variants v ON v.id=wi.watch_variant_id
         AND v.catalog_variant_id=oi.variant_id
       JOIN watch_products p ON p.id=v.watch_product_id
       WHERE wi.order_item_id=oi.id AND p.brand_id=?
     ) LIMIT 1
 `).bind(orderId,brandId).first<{id:number}>()
 if(invalid)return fail('WATCH_RESERVE_UNVERIFIED_SKU',
   'Не все активные позиции имеют подтверждённую комплектацию выбранного бренда.',409)
 try{
   const result=await recoverPendingOrderReservationsBeforeShipping(db,orderId,new Date().toISOString(),
     {allowSentExchangeReplacements:true})
   const pending=await db.prepare(`
     SELECT COUNT(*) AS count FROM inventory_reservations
     WHERE order_id=? AND status='unresolved'
   `).bind(orderId).first<{count:number}>()
   return json({ok:true,brandId,orderId,...result,pending:Number(pending?.count||0),
     stockUnchanged:true,notice:result.activated>0
       ?'Резерв восстановлен по фактическому остатку. Обновите логистику.'
       :'Свободного остатка для подтверждения резерва пока нет. Поступление не создаётся автоматически.'})
 }catch(cause){
   return fail('WATCH_RESERVE_RETRY_FAILED',
     cause instanceof Error?cause.message:'Не удалось проверить резерв.')
 }
}
