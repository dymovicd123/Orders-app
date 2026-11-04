import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {cancelReturn} from './returns-exchanges.ts'

const fail=(code:string,message:string,status=409)=>
  json({ok:false,code,message},{status})

/** Brand-scoped history of Main returns, including item-level physical intake. */
export async function listClient3WatchReturnHistory(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
){
 if(!actor?.id)return fail('WATCH_AUTH_REQUIRED','Необходим вход в систему.',403)
 const own=await db.prepare(`SELECT o.id FROM orders o
   JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('archived','deleted') LIMIT 1`)
   .bind(orderId,brandId).first<{id:number}>()
 if(!own)return fail('WATCH_RETURN_ORDER_NOT_FOUND','Заказ не найден в выбранном бренде.',404)
 const entries=await db.prepare(`
   SELECT r.id,r.return_date AS date,r.amount,r.payment_method AS method,
     COALESCE(r.status,'completed') AS status,COALESCE(r.comment,'') AS comment,
     COALESCE((SELECT SUM(CASE WHEN COALESCE(ri.amount,0)>0 THEN ri.amount
       ELSE COALESCE(ri.quantity,0)*COALESCE(oi.unit_price,0) END)
       FROM return_items ri JOIN order_items oi ON oi.id=ri.order_item_id
       WHERE ri.return_id=r.id),0) AS commercialGoodsValue,
     (SELECT e.id FROM exchanges e WHERE e.refund_return_id=r.id
       AND COALESCE(e.status,'completed')<>'cancelled' LIMIT 1) AS parentExchangeId,
     (SELECT COALESCE(json_group_array(json_object(
       'id',ri.id,'orderItemId',ri.order_item_id,'quantity',ri.quantity,
       'modelName',COALESCE(wp.model_name,oi.product_name_snapshot,'Часы'),
       'gender',COALESCE(v.gender,''),
       'movement',COALESCE(a.movement,v.movement,''),
       'braceletMaterial',COALESCE(a.bracelet_material,v.bracelet_material,''),
       'dialColor',COALESCE(a.dial_color,v.dial_color,''),
       'braceletColor',COALESCE(a.bracelet_color,v.bracelet_color,''),
       'physicalTracking',COALESCE(ri.physical_tracking,0),
       'physicalReceivedAt',ri.physical_received_at
     )),'[]') FROM return_items ri
       JOIN order_items oi ON oi.id=ri.order_item_id
       LEFT JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
       LEFT JOIN watch_variants v ON v.id=wi.watch_variant_id
       LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=v.id
       LEFT JOIN watch_products wp ON wp.id=v.watch_product_id
       WHERE ri.return_id=r.id) AS items
   FROM returns r WHERE r.order_id=? ORDER BY r.id DESC LIMIT 100
 `).bind(orderId).all<Record<string,unknown>>()
 return json({ok:true,brandId,orderId,rows:entries.results||[]})
}

/** Only a standalone return may be independently cancelled.
 * Main's cancelReturn owns the dependency, stock and money checks.
 */
export async function cancelClient3WatchReturn(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,returnId:number,
 input:{requestId?:unknown;reason?:unknown},
){
 if(!actor?.id||['Логист','Завсклад','Упаковщик'].includes(actor.employeeRole||'')&&actor.role!=='admin')
   return fail('WATCH_RETURN_CANCEL_FORBIDDEN','Отмену возврата оформляет менеджер или администратор.',403)
 if(!Number.isSafeInteger(returnId)||returnId<1||
   typeof input.requestId!=='string'||!/^[A-Za-z0-9._:-]{16,128}$/.test(input.requestId))
   return fail('WATCH_RETURN_CANCEL_INVALID','Укажите возврат и уникальный номер операции.',400)
 const reason=typeof input.reason==='string'?input.reason.trim():''
 if(reason.length<8||reason.length>500)
   return fail('WATCH_RETURN_CANCEL_REASON','Укажите причину отмены (от 8 до 500 символов).',400)
 const own=await db.prepare(`SELECT r.id,r.status FROM returns r
   JOIN watch_order_details wd ON wd.order_id=r.order_id
   WHERE r.id=? AND r.order_id=? AND wd.brand_id=? LIMIT 1`)
   .bind(returnId,orderId,brandId).first<{id:number;status:string|null}>()
 if(!own)return fail('WATCH_RETURN_NOT_FOUND','Возврат не принадлежит этому заказу и бренду.',404)
 const exchange=await db.prepare(`SELECT e.id FROM exchanges e
   WHERE e.refund_return_id=? AND COALESCE(e.status,'completed')<>'cancelled' LIMIT 1`)
   .bind(returnId).first<{id:number}>()
 if(exchange)return fail('WATCH_RETURN_EXCHANGE_LINKED',
   'Этот денежный возврат связан с обменом. Отменять нужно сам обмен с учётом его цепочки.',409)
 try{
   const result=await cancelReturn(db,returnId,{
     requestId:input.requestId,comment:reason,
   })
   return json(result)
 }catch(cause){
   return fail('WATCH_RETURN_CANCEL_BLOCKED',
     cause instanceof Error?cause.message:'Нельзя отменить возврат из-за зависимых операций.')
 }
}
