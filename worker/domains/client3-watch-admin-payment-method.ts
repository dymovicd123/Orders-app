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


type FullPaymentChange=PaymentChange&{
  paymentDate:string;amount:number;paymentKind:string;comment:string
}
type FullPaymentInput={requestId?:unknown;expectedOrderDate?:unknown;change?:FullPaymentChange}
const dateValid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 !Number.isNaN(Date.parse(value+'T00:00:00Z'))&&
 new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value

/**
 * The complete Main admin editor can update recorded payment date, amount,
 * method, category and comment. Client3 uses a brand-scoped, single-payment
 * adapter with optimistic snapshots and the unchanged Main financial engine.
 * Any non-method correction of an Exchange extra, or an order already
 * carrying downstream Return/Exchange operations, must be done through its
 * original operation rather than rewriting its financial lineage.
 */
export async function correctClient3AdminRecordedPayment(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,raw:FullPaymentInput,
):Promise<Response>{
 if(actor?.role!=='admin')return fail('WATCH_PAYMENT_EDIT_ADMIN_ONLY',
   'Полное редактирование проведённых оплат доступно только администратору.',403)
 if(!Number.isSafeInteger(brandId)||brandId<1||!Number.isSafeInteger(orderId)||orderId<1)
   return fail('WATCH_PAYMENT_EDIT_SCOPE','Выберите заказ и бренд.',400)
 const requestId=raw?.requestId
 if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId))
   return fail('WATCH_PAYMENT_EDIT_REQUEST','Неверный ключ изменения оплаты.',400)
 const x=raw?.change
 const fields=['paymentId','method','expectedPaymentDate','expectedMethod','expectedAmount',
   'expectedPaymentKind','expectedComment','paymentDate','amount','paymentKind','comment']
 if(!x||Object.keys(x).some(k=>!fields.includes(k))
   ||!Number.isSafeInteger(x.paymentId)||x.paymentId<1
   ||!Number.isSafeInteger(x.expectedAmount)||x.expectedAmount<1
   ||!Number.isSafeInteger(x.amount)||x.amount<1||x.amount>1_000_000_000
   ||!['primary','debt_close','extra'].includes(x.expectedPaymentKind)
   ||!['primary','debt_close','extra'].includes(x.paymentKind)
   ||typeof x.method!=='string'||!x.method.trim()||x.method.length>80
   ||typeof x.expectedMethod!=='string'||!x.expectedMethod.trim()
   ||typeof x.paymentDate!=='string'||!dateValid(x.paymentDate)
   ||typeof x.expectedPaymentDate!=='string'||!dateValid(x.expectedPaymentDate)
   ||typeof x.expectedComment!=='string'||typeof x.comment!=='string'
   ||x.comment.length>500||x.expectedComment.length>500
   ||typeof raw.expectedOrderDate!=='string'||!dateValid(raw.expectedOrderDate))
   return fail('WATCH_PAYMENT_EDIT_INVALID','Проверьте сумму, дату, тип и снимок исходной оплаты.',400)
 const own=await db.prepare(`SELECT o.id,o.order_date,o.order_status,o.pricing_mode,
   p.id AS payment_id FROM orders o JOIN watch_order_details wd ON wd.order_id=o.id
   JOIN payments p ON p.order_id=o.id AND p.id=?
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('archived','deleted') LIMIT 1`)
   .bind(x.paymentId,orderId,brandId).first<Record<string,unknown>>()
 if(!own)return fail('WATCH_PAYMENT_EDIT_NOT_FOUND','Оплата не найдена у этого заказа и бренда.',404)
 if(own.order_date!==raw.expectedOrderDate)
   return fail('WATCH_PAYMENT_EDIT_STALE_DATE','Дата заказа изменилась. Откройте редактор заново.',409)
 if(own.pricing_mode!=='itemized_v1')
   return fail('WATCH_PAYMENT_EDIT_LEGACY','Для старого формата нужен отдельный финансовый разбор.',409)
 const valid=await db.prepare(`SELECT value FROM watch_reference_values
   WHERE kind='paymentMethods' AND is_active=1`).all<{value:string}>()
 const method=valid.results?.find(m=>m.value.toLocaleUpperCase('ru-RU')===
   x.method.trim().toLocaleUpperCase('ru-RU'))?.value
 if(!method)return fail('WATCH_PAYMENT_EDIT_METHOD','Способ оплаты отсутствует в справочнике.',400)
 const changedOther=x.paymentDate!==x.expectedPaymentDate||
   x.amount!==x.expectedAmount||x.paymentKind!==x.expectedPaymentKind||
   x.comment.trim()!==x.expectedComment.trim()
 const changedMethod=method.toLocaleUpperCase('ru-RU')!==
   x.expectedMethod.trim().toLocaleUpperCase('ru-RU')
 if(!changedOther&&!changedMethod)return json({ok:true,unchanged:true,orderId,paymentId:x.paymentId})
 if(changedOther){
   if(x.expectedPaymentKind==='extra'||x.paymentKind==='extra')
     return fail('WATCH_PAYMENT_EDIT_EXTRA',
       'Дополнительная оплата с особым назначением требует отдельной финансовой корректировки.',409)
   const downstream=await db.prepare(`SELECT
     (SELECT COUNT(*) FROM returns WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled') AS returns_count`)
     .bind(orderId).first<{returns_count:number}>()
   if(Number(downstream?.returns_count||0)>0)
     return fail('WATCH_PAYMENT_EDIT_LINKED',
       'После возврата сумму, дату и назначение оплаты нельзя переписывать отдельно. Сначала исправьте соответствующую операцию.',409)
 }
 try{
   const paymentCorrection={
     paymentId:x.paymentId,paymentDate:x.paymentDate,method,amount:x.amount,
     paymentKind:x.paymentKind,comment:x.comment.trim(),
     expectedPaymentDate:x.expectedPaymentDate,expectedMethod:x.expectedMethod,
     expectedAmount:x.expectedAmount,expectedPaymentKind:x.expectedPaymentKind,
     expectedComment:x.expectedComment,
   }
   const input:OrderInput=changedOther
     ?{requestId,orderDate:raw.expectedOrderDate,paymentCorrections:[paymentCorrection]}
     :{requestId,paymentCorrections:[paymentCorrection]}
   const updated=await updateOrderCritical(db,orderId,input,actor,
     actor.displayName||actor.email||'Администратор')
   if(!(updated as {ok?:boolean}|null)?.ok)
     return fail('WATCH_PAYMENT_EDIT_FAILED','Main не подтвердил изменение финансовой записи.')
   return json({ok:true,orderId,paymentId:x.paymentId,
     mainPaymentCorrection:true,changedAmount:changedOther,refreshRequired:true})
 }catch(cause){
   return fail('WATCH_PAYMENT_EDIT_CONFLICT',
     cause instanceof Error?cause.message:'Оплата уже изменилась. Откройте редактор заново.',409)
 }
}
