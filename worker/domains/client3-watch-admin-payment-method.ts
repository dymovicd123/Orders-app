import {json} from '../core/http.ts'
import type {AuthUser,OrderInput} from '../core/types.ts'
import {updateOrderCritical} from './orders-write.ts'

const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
type PaymentChange={paymentId:number;method:string;
 expectedPaymentDate:string;expectedMethod:string;expectedAmount:number;
 expectedPaymentKind:string;expectedComment:string}
type Input={requestId?:unknown;change?:PaymentChange}
export async function correctClient3AdminPaymentMethod(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,raw:Input,
):Promise<Response>{
 if(actor?.role!=='admin')return fail('WATCH_PAYMENT_EDIT_ADMIN_ONLY','Изменять проведённые оплаты может только администратор.',403)
 if(!Number.isSafeInteger(orderId)||orderId<1||!Number.isSafeInteger(brandId)||brandId<1)
   return fail('WATCH_PAYMENT_EDIT_SCOPE','Выберите заказ и бренд.',400)
 if(typeof raw?.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(raw.requestId))
   return fail('WATCH_PAYMENT_EDIT_REQUEST','Неверный идентификатор операции.',400)
 const x=raw?.change
 if(!x||Object.keys(x).some(k=>![
   'paymentId','method','expectedPaymentDate','expectedMethod','expectedAmount','expectedPaymentKind','expectedComment',
 ].includes(k))||
   !Number.isSafeInteger(x.paymentId)||x.paymentId<1||
   !Number.isSafeInteger(x.expectedAmount)||x.expectedAmount<1||
   typeof x.method!=='string'||!x.method.trim()||x.method.length>80||
   typeof x.expectedPaymentDate!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.expectedPaymentDate)||
   typeof x.expectedMethod!=='string'||typeof x.expectedPaymentKind!=='string'||
   typeof x.expectedComment!=='string')
   return fail('WATCH_PAYMENT_EDIT_INVALID','Обновите оплату: нужен полный исходный снимок.',400)
 const order=await db.prepare(`SELECT o.id FROM orders o
   JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')`)
   .bind(orderId,brandId).first<{id:number}>()
 if(!order)return fail('WATCH_PAYMENT_EDIT_NOT_FOUND','Заказ отсутствует в выбранном бренде.',404)
 const allowed=await db.prepare(`SELECT value FROM watch_reference_values
   WHERE kind='paymentMethods' AND is_active=1`).all<{value:string}>()
 const cleaned=x.method.trim().replace(/\s+/g,' ')
 if(!(allowed.results||[]).some(m=>m.value.toUpperCase()===cleaned.toUpperCase()))
   return fail('WATCH_PAYMENT_METHOD_INVALID','Способ оплаты отсутствует в справочнике.',400)
 if(cleaned.toUpperCase()===x.expectedMethod.trim().toUpperCase())
   return json({ok:true,unchanged:true,orderId})
 const owned=await db.prepare('SELECT id FROM payments WHERE order_id=? AND id=?')
   .bind(orderId,x.paymentId).first<{id:number}>()
 if(!owned)return fail('WATCH_PAYMENT_EDIT_FOREIGN','Оплата не принадлежит этому заказу.',403)
 try{
   const updated=await updateOrderCritical(db,orderId,{
     requestId:raw.requestId,
     paymentCorrections:[{
       paymentId:x.paymentId,method:cleaned,
       expectedPaymentDate:x.expectedPaymentDate,expectedMethod:x.expectedMethod,
       expectedAmount:x.expectedAmount,expectedPaymentKind:x.expectedPaymentKind,
       expectedComment:x.expectedComment,
     }],
   } as OrderInput,actor,actor.displayName||actor.email||'Администратор')
   if(!(updated as {ok?:boolean}|null)?.ok)
     return fail('WATCH_PAYMENT_EDIT_FAILED','Main не подтвердил исправление способа оплаты.')
   return json({ok:true,orderId,paymentId:x.paymentId,method:cleaned,mainPaymentCorrection:true})
 }catch(cause){
   return fail('WATCH_PAYMENT_EDIT_CONFLICT',
     cause instanceof Error?cause.message:'Оплата изменилась. Обновите заказ.',409)
 }
}
