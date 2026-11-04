import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {createManualOrderPaymentCritical} from './money.ts'

const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
type DebtInput={requestId?:unknown;method?:unknown;amount?:unknown;paymentDate?:unknown;comment?:unknown}

/** Brand-scoped adapter over Main's critical payment operation.
 * Never write payments directly or mutate inventory when closing a debt.
 */
export async function addClient3WatchDebtPayment(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,input:DebtInput,
):Promise<Response>{
 if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
   return fail('WATCH_PAYMENT_FORBIDDEN','Оплату принимает менеджер или администратор.',403)
 if(!Number.isSafeInteger(brandId)||brandId<=0||!Number.isSafeInteger(orderId)||orderId<=0)
   return fail('WATCH_PAYMENT_ORDER_INVALID','Выберите заказ и бренд.',400)
 if(actor.role!=='admin'){
   const grant=await db.prepare(`SELECT 1 AS ok FROM watch_manager_brands mb
     JOIN managers m ON m.id=mb.manager_id AND m.is_active=1
     WHERE mb.manager_id=? AND mb.brand_id=? LIMIT 1`)
     .bind(actor.managerId||0,brandId).first<{ok:number}>()
   if(!grant?.ok)return fail('WATCH_PAYMENT_BRAND_FORBIDDEN',
     'Нет доступа к оплатам этого бренда.',403)
 }
 const owned=await db.prepare(`SELECT o.id FROM watch_order_details wd
   JOIN orders o ON o.id=wd.order_id
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')`)
   .bind(orderId,brandId).first<{id:number}>()
 if(!owned)return fail('WATCH_PAYMENT_ORDER_MISSING','Заказ отсутствует в выбранном бренде.',404)
 const requestId=input?.requestId
 if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId))
   return fail('WATCH_PAYMENT_REQUEST_INVALID','Некорректный идентификатор оплаты.',400)
 const amount=input?.amount
 if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<1||amount>1_000_000_000)
   return fail('WATCH_PAYMENT_AMOUNT_INVALID','Укажите положительную сумму в целых тенге.',400)
 const method=typeof input.method==='string'?input.method.trim().replace(/\s+/g,' '):''
 if(!method||method.length>80)
   return fail('WATCH_PAYMENT_METHOD_INVALID','Выберите способ оплаты.',400)
 const configured=await db.prepare(`SELECT value FROM watch_reference_values
   WHERE kind='paymentMethods' AND is_active=1`).all<{value:string}>()
 if(!(configured.results||[]).some(x=>x.value.toLocaleUpperCase('ru-RU')===method.toLocaleUpperCase('ru-RU')))
   return fail('WATCH_PAYMENT_METHOD_INVALID','Способ оплаты отсутствует в справочнике.',400)
 const paymentDate=typeof input.paymentDate==='string'?input.paymentDate:''
 const parsedDate=Date.parse(paymentDate+'T00:00:00Z')
 if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)||!Number.isFinite(parsedDate)||
   new Date(parsedDate).toISOString().slice(0,10)!==paymentDate)
   return fail('WATCH_PAYMENT_DATE_INVALID','Укажите правильную дату оплаты.',400)
 const comment=typeof input.comment==='string'?input.comment.trim():''
 if(comment.length>300)return fail('WATCH_PAYMENT_COMMENT_INVALID','Комментарий не более 300 символов.',400)
 try{
   const saved=await createManualOrderPaymentCritical(db,{
     requestId,orderId,paymentDate,method,amount,paymentKind:'debt_close',comment,
   },{watchCommercialBalance:true})
   return json({...saved,brandId,mainFinancialLedger:true},{status:201})
 }catch(cause){
   return fail('WATCH_PAYMENT_BLOCKED',
     cause instanceof Error?cause.message:'Долг изменился. Обновите заказ и повторите.')
 }
}


/** Main's recorded debt-close payments, restricted to the exact watch brand.
 * This is history of actual money received, not commercial-return credits. */
export async function listClient3WatchDebtHistory(
 db:D1Database,actor:AuthUser,brandId:number,orderId=0,
):Promise<Response>{
 if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
   return fail('WATCH_PAYMENT_FORBIDDEN','История оплат доступна менеджеру и администратору.',403)
 if(!Number.isSafeInteger(brandId)||brandId<=0||
    !Number.isSafeInteger(orderId)||orderId<0)
   return fail('WATCH_PAYMENT_HISTORY_SCOPE','Некорректный заказ или бренд.',400)
 if(actor.role!=='admin'){
   const grant=await db.prepare(`SELECT 1 AS ok FROM watch_manager_brands mb
     JOIN managers m ON m.id=mb.manager_id AND m.is_active=1
     WHERE mb.manager_id=? AND mb.brand_id=? LIMIT 1`)
     .bind(actor.managerId||0,brandId).first<{ok:number}>()
   if(!grant?.ok)return fail('WATCH_PAYMENT_BRAND_FORBIDDEN',
     'Нет доступа к истории этого бренда.',403)
 }
 const items=await db.prepare(`SELECT p.id, p.order_id AS orderId,
     o.external_id AS externalId, o.order_date AS orderDate,
     p.payment_date AS paymentDate,p.method,p.amount,p.comment,
     p.created_at AS recordedAt,wd.recipient_name AS customer
   FROM payments p
   JOIN orders o ON o.id=p.order_id
   JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE wd.brand_id=? AND p.payment_kind='debt_close' AND p.amount>0
     AND (?=0 OR o.id=?)
   ORDER BY p.payment_date DESC,p.id DESC LIMIT 81`)
   .bind(brandId,orderId,orderId).all<Record<string,unknown>>()
 const rows=items.results||[]
 return json({ok:true,brandId,orderId,rows:rows.slice(0,80),hasMore:rows.length>80})
}
