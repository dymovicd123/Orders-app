// Dormant final phase, deliberately NOT exposed by production Worker routes.
// The injected deleter must call the existing deleteOrderSafely (never a
// second implementation of inventory, financial, and order lifecycle writes).
import { cleanText, toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { previewAdminOrderDeletion } from './order-delete-preview.ts'
import { getAdminDeleteSagaProgress, type SagaProgress } from './admin-delete-saga.ts'
import { readOrderFinancialLedger } from './money.ts'
export type FinalOrderDelete=(db:D1Database,orderId:number,input:{
  requestId:string; expectedSnapshot:string; comment:string
})=>Promise<unknown>
const txt=(x:unknown)=>cleanText(x)
const n=(x:unknown)=>toInt(x,0)
const fail=(msg:string):never=>{throw new CriticalOperationConflictError(msg)}
const finalId=(requestId:string)=>requestId+':final'
async function criticalComplete(db:D1Database,requestId:string,orderId:number){
  const row=await db.prepare(
    "SELECT operation_type,status,target_type,target_id FROM critical_operations WHERE request_id=?"
  ).bind(finalId(requestId)+':order').first<Record<string,unknown>>()
  return txt(row?.operation_type)==='order_edit'&&txt(row?.status)==='completed'
    &&txt(row?.target_type)==='order'&&n(row?.target_id)===orderId
}
async function finalFacts(db:D1Database,orderId:number){
  const order=await db.prepare(
    'SELECT order_status,shipping_status,pricing_mode,total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=?'
  ).bind(orderId).first<Record<string,unknown>>()
  if(!order)throw new CriticalOperationConflictError('Заказ исчез. Требуется ручная проверка.')
  if(txt(order.order_status)==='deleted')return {deleted:true,snapshot:''}
  if(txt(order.order_status)==='archived'||txt(order.shipping_status)!=='not_sent'
    ||txt(order.pricing_mode)!=='itemized_v1')
    fail('Статус или схема цены изменились; окончательное удаление остановлено.')
  const summary=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM returns WHERE order_id=?
      AND COALESCE(status,'completed')<>'cancelled') AS active_returns,
    (SELECT COUNT(*) FROM exchanges WHERE order_id=?
      AND COALESCE(status,'completed')<>'cancelled') AS active_exchanges,
    (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=?
      AND status='fulfilled') AS issued,
    (SELECT COUNT(*) FROM inventory_lifecycle_events
      WHERE order_id=? AND status='applied') AS applied`
  ).bind(orderId,orderId,orderId,orderId).first<Record<string,unknown>>()
  if(Object.values(summary||{}).some(v=>n(v)!==0))
    fail('Появились действующие обмены/возвраты или физические складские движения.')
  const ledger=await readOrderFinancialLedger(db,orderId)
  if(n(order.total_amount)!==ledger.totalAmount
    ||n(order.received_amount)!==ledger.receivedAmount
    ||n(order.return_amount)!==ledger.returnAmount
    ||n(order.debt_amount)!==ledger.debtAmount)
    fail('Финансовый баланс изменился; перед удалением нужна сверка.')
  // Payments may remain at the final stage. The established order-delete
  // handler preserves their rows for audit and appends idempotent reversals.
  const lines=await db.prepare(`SELECT COALESCE(SUM(line_total),0) AS total,
    SUM(CASE WHEN quantity<0 OR unit_price<0 OR line_total<0
      OR line_total<>quantity*unit_price THEN 1 ELSE 0 END) AS invalid
    FROM order_items WHERE order_id=?`
  ).bind(orderId).first<Record<string,unknown>>()
  if(n(lines?.invalid)||n(lines?.total)!==n(order.total_amount))
    fail('Стоимость и количество позиций не согласованы.')
  const stock=await db.prepare(
    'SELECT COUNT(*) AS n FROM inventory_stock WHERE quantity<0 OR reserved_quantity<0'
  ).first<{n:number}>()
  if(n(stock?.n))fail('На складе отрицательные остатки или резервы.')
  const preview=await previewAdminOrderDeletion(db,orderId)
  if(!preview.canAttemptDelete||preview.requiresPhysicalFact
    ||preview.activeExchanges.length||preview.activeReturns.length)
    fail('Штатный предпросмотр не разрешил удаление. Остановлено.')
  return {deleted:false,snapshot:preview.chainPlan.snapshotFingerprint}
}
export async function finalizeAdminDeleteSaga(
  db:D1Database,requestIdRaw:string,deleter:FinalOrderDelete,
):Promise<SagaProgress>{
  const requestId=txt(requestIdRaw)
  if(!/^[A-Za-z0-9_:\-.]{10,128}$/.test(requestId))fail('Некорректный ключ цепочки.')
  const saga=await db.prepare(
    'SELECT request_id,order_id,status,next_step,lease_token,lease_until_ms FROM admin_order_delete_sagas WHERE request_id=?'
  ).bind(requestId).first<Record<string,unknown>>()
  if(!saga)throw new CriticalOperationConflictError('Журнал удаления не найден.')
  const orderId=n(saga.order_id)
  if(txt(saga.status)==='completed'){
    const order=await db.prepare('SELECT order_status FROM orders WHERE id=?')
      .bind(orderId).first<{order_status:string}>()
    if(txt(order?.order_status)!=='deleted'||!await criticalComplete(db,requestId,orderId))
      fail('Журнал завершён без доказательства штатного удаления. Требуется проверка.')
    return getAdminDeleteSagaProgress(db,requestId)
  }
  if(txt(saga.status)!=='ready_for_final_delete')
    fail('Не все зависимые отмены завершены.')
  const stepRows=await db.prepare(
    'SELECT step_index,status FROM admin_order_delete_saga_steps WHERE saga_request_id=? ORDER BY step_index'
  ).bind(requestId).all<Record<string,unknown>>()
  const steps=stepRows.results||[]
  if(!steps.length||n(saga.next_step)!==steps.length
    ||steps.some((row,i)=>n(row.step_index)!==i||txt(row.status)!=='completed'))
    fail('Состояние цепочки неоднозначно; нельзя завершить удаление.')
  const lease=crypto.randomUUID(),now=Date.now()
  const claim=await db.prepare(`UPDATE admin_order_delete_sagas
    SET lease_token=?,lease_until_ms=?,updated_at=?
    WHERE request_id=? AND status='ready_for_final_delete' AND next_step=?
      AND (lease_token IS NULL OR lease_until_ms<=?)`
  ).bind(lease,now+45000,new Date().toISOString(),requestId,steps.length,now).run()
  if(n(claim.meta?.changes)!==1)fail('Другое удаление уже выполняется. Повторите позже.')
  try{
    const facts=await finalFacts(db,orderId)
    if(!facts.deleted){
      await deleter(db,orderId,{
        requestId:finalId(requestId),expectedSnapshot:facts.snapshot,
        comment:'Удалено после проверенной цепочки отмен зависимых операций',
      })
    }
    const order=await db.prepare('SELECT order_status FROM orders WHERE id=?')
      .bind(orderId).first<{order_status:string}>()
    if(txt(order?.order_status)!=='deleted'||!await criticalComplete(db,requestId,orderId))
      fail('Штатное удаление не подтверждено. Журнал не завершён.')
    await db.batch([
      db.prepare(`SELECT json('ADMIN_DELETE_FINAL_STALE')
        WHERE NOT EXISTS(SELECT 1 FROM admin_order_delete_sagas
          WHERE request_id=? AND lease_token=? AND status='ready_for_final_delete'
            AND next_step=?)`).bind(requestId,lease,steps.length),
      db.prepare(`UPDATE admin_order_delete_sagas
        SET status='completed',lease_token=NULL,lease_until_ms=0,
          last_error=NULL,updated_at=?
        WHERE request_id=? AND lease_token=? AND next_step=?
          AND status='ready_for_final_delete'`
      ).bind(new Date().toISOString(),requestId,lease,steps.length),
    ])
    return getAdminDeleteSagaProgress(db,requestId)
  }catch(error){
    await db.prepare(`UPDATE admin_order_delete_sagas
      SET lease_token=NULL,lease_until_ms=0,last_error=?,updated_at=?
      WHERE request_id=? AND lease_token=?`
    ).bind(txt(error instanceof Error?error.message:error).slice(0,900),
      new Date().toISOString(),requestId,lease).run().catch(()=>null)
    throw error
  }
}
