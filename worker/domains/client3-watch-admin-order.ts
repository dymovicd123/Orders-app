import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {previewAdminOrderDeletion} from './order-delete-preview.ts'
import {deleteOrderSafely} from './order-delete.ts'
import {updateOrderCritical} from './orders-write.ts'
import type {OrderInput} from '../core/types.ts'

const error=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const name=(actor:AuthUser)=>actor.displayName||actor.email||'Администратор'
async function watchOrder(db:D1Database,brandId:number,orderId:number){
 if(!Number.isSafeInteger(brandId)||brandId<1||!Number.isSafeInteger(orderId)||orderId<1)
   return null
 return db.prepare(`SELECT o.id,o.manager_id,o.order_status,o.shipping_status,
   o.total_amount,o.received_amount,o.debt_amount,o.return_amount
   FROM orders o JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? LIMIT 1`).bind(orderId,brandId)
   .first<Record<string,unknown>>()
}
const issued=async(db:D1Database,orderId:number)=>{
 const result=await db.prepare(`SELECT
   (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=? AND status='fulfilled') AS fulfilled,
   (SELECT COUNT(*) FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
     WHERE d.order_id=? AND di.quantity>COALESCE(di.cancelled_quantity,0)) AS sent
 `).bind(orderId,orderId).first<{fulfilled:number;sent:number}>()
 return Number(result?.fulfilled||0)+Number(result?.sent||0)
}
const authorize=(actor:AuthUser)=>actor?.role==='admin'
/** Read-only Main preview; never allow a watch sale to be deleted if any
 * physical handover was recorded even if its aggregate "not sent" is stale.
 */
export async function previewClient3AdminOrderDelete(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
):Promise<Response>{
 if(!authorize(actor))return error('WATCH_DELETE_ADMIN_ONLY','Удаление доступно только администратору.',403)
 const order=await watchOrder(db,brandId,orderId)
 if(!order)return error('WATCH_DELETE_NOT_FOUND','Заказ отсутствует в выбранном бренде.',404)
 try{
   const preview=await previewAdminOrderDeletion(db,orderId)
   const physical=await issued(db,orderId)
   const safe=preview.canAttemptDelete&&physical===0
     &&order.shipping_status!=='sent'&&order.order_status==='active'
   const reasons=[...preview.reasons]
   if(!safe&&!reasons.length)reasons.push('Есть отправка или неподтверждённая история. Сначала разрешите складские последствия в Main.')
   return json({ok:true,brandId,orderId,preview:{
     externalId:preview.externalId,totalAmount:Number(order.total_amount||0),
     receivedAmount:preview.receivedAmount,returnedAmount:preview.returnAmount,
     activeReturns:preview.activeReturns.length,activeExchanges:preview.activeExchanges.length,
     issuedItems:preview.issuedItemCount,paymentCount:preview.paymentCount,
     reasons,explanations:preview.explanations,canDelete:safe,
     expectedSnapshot:preview.chainPlan.snapshotFingerprint,
   }})
 }catch(cause){
   return error('WATCH_DELETE_PREVIEW_BLOCKED',cause instanceof Error?cause.message:'Нельзя проверить последствия.')
 }
}
export async function deleteClient3AdminOrder(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
 raw:{requestId?:unknown;expectedSnapshot?:unknown;comment?:unknown},
):Promise<Response>{
 if(!authorize(actor))return error('WATCH_DELETE_ADMIN_ONLY','Удаление доступно только администратору.',403)
 const order=await watchOrder(db,brandId,orderId)
 if(!order)return error('WATCH_DELETE_NOT_FOUND','Заказ отсутствует в выбранном бренде.',404)
 if(order.order_status==='deleted')return json({ok:true,alreadyDeleted:true,orderId})
 if(typeof raw?.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(raw.requestId))
   return error('WATCH_DELETE_REQUEST_INVALID','Неверный идентификатор операции.',400)
 if(typeof raw?.expectedSnapshot!=='string'||!/^[0-9a-f]{64}$/.test(raw.expectedSnapshot))
   return error('WATCH_DELETE_PREVIEW_REQUIRED','Откройте свежую проверку удаления.',400)
 if(typeof raw?.comment!=='string'||raw.comment.trim().length<5||raw.comment.length>500)
   return error('WATCH_DELETE_REASON_REQUIRED','Укажите причину удаления от 5 до 500 символов.',400)
 if(order.shipping_status==='sent'||order.order_status!=='active'||await issued(db,orderId)>0)
   return error('WATCH_DELETE_PHYSICAL_BLOCKED','Фактическая отправка или закрытый заказ: удаление заблокировано. Проверьте возврат и склад.',409)
 try{
   const preview=await previewAdminOrderDeletion(db,orderId)
   if(!preview.canAttemptDelete||preview.chainPlan.snapshotFingerprint!==raw.expectedSnapshot)
     return error('WATCH_DELETE_STALE','Заказ или связанные операции изменились. Снова откройте предпросмотр.',409)
   const done=await deleteOrderSafely(db,orderId,{
     requestId:raw.requestId,expectedSnapshot:raw.expectedSnapshot,
     comment:raw.comment.trim(),
   },actor,name(actor))
   if(!done||typeof done!=='object'||(done as {ok?:boolean}).ok!==true)
     return error('WATCH_DELETE_NOT_CONFIRMED','Main не подтвердил завершение удаления.')
   return json({...done,orderId,brandId,mainDelete:true})
 }catch(cause){
   return error('WATCH_DELETE_CONFLICT',cause instanceof Error?cause.message:'Удаление заблокировано.',409)
 }
}
/** Reassign the salesperson through Main's critical editor, with client3
 * brand-specific active-manager entitlement and strict preflight on money,
 * physical handover and dependent operations. Never rewrite item rows.
 */
export async function reassignClient3AdminOrderManager(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
 raw:{requestId?:unknown;expectedManagerId?:unknown;managerId?:unknown},
):Promise<Response>{
 if(!authorize(actor))return error('WATCH_MANAGER_EDIT_ADMIN_ONLY','Ответственного меняет только администратор.',403)
 const order=await watchOrder(db,brandId,orderId)
 if(!order)return error('WATCH_MANAGER_EDIT_NOT_FOUND','Заказ отсутствует в выбранном бренде.',404)
 const expected=raw?.expectedManagerId,target=raw?.managerId
 if(!Number.isSafeInteger(expected)||Number(expected)<0||!Number.isSafeInteger(target)||Number(target)<1)
   return error('WATCH_MANAGER_EDIT_INVALID','Укажите исходного и нового менеджера.',400)
 if(typeof raw.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(raw.requestId))
   return error('WATCH_MANAGER_EDIT_REQUEST_INVALID','Некорректный идентификатор сохранения.',400)
 if(Number(order.manager_id||0)!==expected)
   return error('WATCH_MANAGER_EDIT_STALE','Ответственный уже изменился. Обновите заказ.',409)
 const manager=await db.prepare(`SELECT m.id,m.name FROM managers m
   JOIN watch_manager_brands mb ON mb.manager_id=m.id
   WHERE m.id=? AND m.is_active=1 AND mb.brand_id=?`).bind(target,brandId)
   .first<{id:number;name:string}>()
 if(!manager)return error('WATCH_MANAGER_EDIT_BRAND_DENIED','Менеджер не назначен выбранному бренду.',403)
 if(expected===target)return json({ok:true,unchanged:true,orderId})
 if(order.order_status!=='active'||order.shipping_status==='sent'||await issued(db,orderId)>0)
   return error('WATCH_MANAGER_EDIT_LIFECYCLE','После отправки ответственного исправляют отдельной сверкой.',409)
 const [operations,prices]=await Promise.all([
   db.prepare(`SELECT
     (SELECT COUNT(*) FROM returns WHERE order_id=? AND status<>'cancelled') AS returns_count,
     (SELECT COUNT(*) FROM exchanges WHERE order_id=? AND status<>'cancelled') AS exchanges_count`)
       .bind(orderId,orderId).first<{returns_count:number;exchanges_count:number}>(),
   db.prepare(`SELECT COALESCE(SUM(line_total),0) AS total
     FROM order_items WHERE order_id=? AND quantity>0`).bind(orderId).first<{total:number}>(),
 ])
 if(Number(operations?.returns_count||0)+Number(operations?.exchanges_count||0)>0||
   Number(prices?.total)!==Number(order.total_amount))
   return error('WATCH_MANAGER_EDIT_HISTORY','История заказа требует сверки перед переносом менеджера.',409)
 try{
   const done=await updateOrderCritical(db,orderId,{
     requestId:raw.requestId,managerId:Number(target),managerName:manager.name,
   } as OrderInput,actor,name(actor))
   if(!(done as {ok?:boolean}|null)?.ok)
     return error('WATCH_MANAGER_EDIT_NOT_CONFIRMED','Main не подтвердил смену менеджера.')
   return json({ok:true,orderId,managerId:target,managerName:manager.name,mainAudit:true})
 }catch(cause){
   return error('WATCH_MANAGER_EDIT_CONFLICT',cause instanceof Error?cause.message:'Не удалось сменить менеджера.')
 }
}
