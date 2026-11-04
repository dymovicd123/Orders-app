import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {cancelExactOrderDispatchItem} from './order-dispatch-cancel.ts'
import {cancelRetiredWatchDispatch} from './client3-watch-retired-correction.ts'

const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
type Raw={dispatchItemId?:unknown;requestId?:unknown;reason?:unknown}

/** Correction of an erroneous recorded shipment, not a customer return.
 * Main independently determines whether physical stock may be restored.
 * A watch brand, exact SKU and dispatch-item match are mandatory.
 */
export async function correctClient3WatchDispatch(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,input:Raw,
):Promise<Response>{
 if(actor?.role!=='admin')
   return fail('WATCH_DISPATCH_CORRECTION_ADMIN_ONLY','Исправлять отправки может только администратор.',403)
 if(!Number.isSafeInteger(brandId)||brandId<1||!Number.isSafeInteger(orderId)||orderId<1)
   return fail('WATCH_DISPATCH_CORRECTION_SCOPE','Не выбран бренд или заказ.',400)
 const id=input?.dispatchItemId
 const requestId=input?.requestId
 const reason=typeof input?.reason==='string'?input.reason.trim():''
 if(!Number.isSafeInteger(id)||Number(id)<1||
   typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId)||
   reason.length<8||reason.length>500)
   return fail('WATCH_DISPATCH_CORRECTION_INVALID',
     'Выберите точную отправку и укажите причину исправления (не менее 8 символов).',400)
 const own=await db.prepare(`SELECT di.id FROM order_dispatch_items di
   JOIN order_dispatches d ON d.id=di.dispatch_id
   JOIN watch_order_details wd ON wd.order_id=d.order_id
   JOIN order_items oi ON oi.id=di.order_item_id AND oi.order_id=d.order_id
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants v ON v.id=wi.watch_variant_id AND v.catalog_variant_id=oi.variant_id
   JOIN watch_products wp ON wp.id=v.watch_product_id AND wp.brand_id=wd.brand_id
   WHERE di.id=? AND d.order_id=? AND wd.brand_id=? AND di.quantity>0
     AND di.source_type IN ('warehouse','boutique') LIMIT 1`)
   .bind(id,orderId,brandId).first<{id:number}>()
 if(!own)return fail('WATCH_DISPATCH_CORRECTION_NOT_FOUND',
   'Эта отправка не принадлежит выбранному заказу и бренду.',404)
 try{
   const line=await db.prepare(`SELECT oi.stock_writeoff_status,di.movement_id,
     di.reservation_id,j.order_item_id AS retired_journal
     FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
     JOIN order_items oi ON oi.id=di.order_item_id
     LEFT JOIN retired_order_item_issues j ON j.order_item_id=oi.id
     WHERE di.id=? AND d.order_id=?`).bind(Number(id),orderId).first<Record<string,unknown>>()
   const archived=line?.retired_journal!=null&&line.movement_id==null&&
     line.reservation_id==null
   const payload={dispatchItemId:Number(id),requestId,
     actor:'client3-watch-admin:'+actor.id,reason}
   const result=archived
     ?await cancelRetiredWatchDispatch(db,brandId,orderId,payload)
     :await cancelExactOrderDispatchItem(db,orderId,payload)
   return json({...result,orderId,brandId,mainDispatchCorrection:true})
 }catch(cause){
   return fail('WATCH_DISPATCH_CORRECTION_BLOCKED',
     cause instanceof Error?cause.message:'Исправление отправки заблокировано.',409)
 }
}
