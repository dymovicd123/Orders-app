// Production-handler adapter for the dormant admin deletion saga. Intentionally
// NOT exposed through HTTP. The explicit guard is checked again before EVERY
// step. Real cancellation retains its own critical-operation idempotency.
import { cleanText, toInt } from '../core/text.ts'
import { CriticalOperationConflictError, criticalOperationFingerprint } from './critical.ts'
import { readOrderFinancialLedger } from './money.ts'
import { reviewAdminDeleteAppliedStock } from './admin-delete-physical.ts'
import { cancelReturn, cancelExchangeSetV2, isExchangeSetV2 } from './returns-exchanges.ts'
import type { SagaCancelDriver, SagaCancelStep } from './admin-delete-saga.ts'

type CancelDependencies = {
  cancelReturn:typeof cancelReturn
  cancelExchangeSetV2:typeof cancelExchangeSetV2
  isExchangeSetV2:typeof isExchangeSetV2
}
const handlers:CancelDependencies={cancelReturn,cancelExchangeSetV2,isExchangeSetV2}
const fail=(message:string):never=>{throw new CriticalOperationConflictError(message)}
const opType=(step:SagaCancelStep)=>step.type==='return'?'return_cancel':'exchange_set_cancel'
const cancelComment='Автоматическая отмена зависимой операции перед административным удалением'

async function readStepTarget(db:D1Database,step:SagaCancelStep){
  const table=step.type==='return'?'returns':'exchanges'
  const row=await db.prepare(
    `SELECT * FROM ${table} WHERE id=? AND order_id=? LIMIT 1`
  ).bind(step.id,step.orderId).first<Record<string,unknown>>()
  if(!row)fail('Связанная операция больше не относится к этому заказу.')
  return row!
}

async function verifyFinancialLedger(db:D1Database,step:SagaCancelStep){
  // Financial movements are allowed; their source rows and the order's
  // aggregate MUST reconcile before and after each idempotent cancellation.
  // We do not pretend an accounting void is a cash refund.
  const ledger=await readOrderFinancialLedger(db,step.orderId)
  const order=await db.prepare(
    'SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=?'
  ).bind(step.orderId).first<Record<string,unknown>>()
  if(!order || toInt(order.total_amount,-1)!==ledger.totalAmount
    ||toInt(order.received_amount,-1)!==ledger.receivedAmount
    ||toInt(order.return_amount,-1)!==ledger.returnAmount
    ||toInt(order.debt_amount,-1)!==ledger.debtAmount)
    fail('Финансовая сумма не совпадает с проводками заказа. Цепочка остановлена до сверки.')
}

async function verifyNoIssuedItems(db:D1Database,step:SagaCancelStep){
  const issued=await db.prepare(
    `SELECT COUNT(*) AS n FROM inventory_reservations
     WHERE order_id=? AND status='fulfilled'`
  ).bind(step.orderId).first<{n:number}>()
  const order=await db.prepare(
    `SELECT order_status,shipping_status,pricing_mode,total_amount
     FROM orders WHERE id=?`
  ).bind(step.orderId).first<Record<string,unknown>>()
  if(!order)throw new CriticalOperationConflictError('Заказ не найден при проверке фактического состояния.')
  if(cleanText(order.order_status)==='deleted'
    ||cleanText(order.order_status)==='archived'
    ||cleanText(order.shipping_status)==='sent')
    fail('Заказ уже закрыт или отмечен отправленным. Требуется отдельная проверка выдачи.')
  if(cleanText(order.pricing_mode)!=='itemized_v1')
    fail('Старый формат стоимости требует отдельного сценария отмены цепочки.')
  const review=await reviewAdminDeleteAppliedStock(db,step.orderId)
  if(!review.allowed)
    fail('По заказу есть проведённые физические складские движения. '+review.blockers.join(' '))
  // The only permitted "fulfilled" item while an unsent order is being
  // deleted is an Exchange replacement with a proved ZERO sale movement.
  // The saga requires the administrator's not-issued consent before any step,
  // and cancelInventoryLifecycleEvent releases this bookkeeping-only reserve
  // without adding a phantom unit to physical stock.
  const fulfilledCount=toInt(issued?.n,0)
  if(fulfilledCount>0 && fulfilledCount!==review.bookkeepingFulfilledCount)
    fail('Есть настоящая или неоднозначная выдача помимо нулевого списания обмена. Автоматическая отмена остановлена.')

}

async function assertCriticalOwnedBySaga(db:D1Database,step:SagaCancelStep,needsCompleted:boolean){
  const operation=await db.prepare(
    `SELECT operation_type,status,request_id,response_json,
            request_fingerprint,target_type,target_id
     FROM critical_operations WHERE request_id=?`
  ).bind(step.cancelRequestId).first<Record<string,unknown>>()
  if(!operation){
    if(needsCompleted)fail('Не найдена подтверждённая запись об отмене операции.')
    return false
  }
  if(cleanText(operation.operation_type)!==opType(step)
    ||!['started','completed'].includes(cleanText(operation.status)))
    fail('Ключ отмены уже используется другой критической операцией.')
  // A matching request ID and operation type alone do not prove ownership.
  // Cross-check the exact production handler fingerprint and persisted target
  // before accepting a cached reply or a recovered cancellation.
  const payload=step.type==='return'
    ? {returnId:step.id,requestId:step.cancelRequestId,comment:cancelComment}
    : {exchangeId:step.id,requestId:step.cancelRequestId,comment:cancelComment}
  const expectedFingerprint=await criticalOperationFingerprint(opType(step),payload)
  const recordedType=cleanText(operation.target_type)
  const recordedId=toInt(operation.target_id,0)
  if(cleanText(operation.request_fingerprint)!==expectedFingerprint
    ||(recordedType&&recordedType!==step.type)
    ||(recordedId&&recordedId!==step.id))
    fail('Ключ отмены связан с другим запросом или другой операцией. Цепочка остановлена.')
  if(needsCompleted&&cleanText(operation.status)!=='completed')
    fail('Обработчик ещё не завершил отмену; переходить к следующей операции рано.')
  if(needsCompleted&&(recordedType!==step.type||recordedId!==step.id))
    fail('Завершённая отмена не подтверждена для указанного обмена или возврата.')
  return true
}

async function verifyOrderAndInventoryFacts(db:D1Database,step:SagaCancelStep){
  // All row-level stock changes are performed by the established cancellation
  // handler, which owns its own snapshots and stocktake checks. This verifier
  // independently rejects dangling live reservations and negative stock; it
  // does NOT purport to prove real-world physical stock by itself.
  const order=await db.prepare(
    `SELECT total_amount,received_amount,return_amount,debt_amount
     FROM orders WHERE id=?`
  ).bind(step.orderId).first<Record<string,unknown>>()
  if(!order)fail('Заказ исчез после отмены.')
  const ledger=await readOrderFinancialLedger(db,step.orderId)
  if(toInt(order!.total_amount,-1)!==ledger.totalAmount
    ||toInt(order!.received_amount,-1)!==ledger.receivedAmount
    ||toInt(order!.return_amount,-1)!==ledger.returnAmount
    ||toInt(order!.debt_amount,-1)!==ledger.debtAmount)
    fail('Финансовый баланс заказа не сошёлся с журналом оплат и возвратов.')
  const totals=await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN quantity>0 THEN line_total ELSE 0 END),0) AS total,
       COUNT(CASE WHEN quantity<0 OR unit_price<0 OR line_total<0
         OR (quantity>0 AND line_total<>quantity*unit_price)
         OR (quantity=0 AND line_total<>0) THEN 1 END) AS invalid
     FROM order_items WHERE order_id=?`
  ).bind(step.orderId).first<{total:number;invalid:number}>()
  if(toInt(totals?.invalid,0)
    ||toInt(totals?.total,-1)!==ledger.totalAmount)
    fail('Суммы или количество активных позиций не совпадают с итогом заказа.')
  const stock=await db.prepare(
    `SELECT COUNT(*) AS invalid FROM inventory_stock
     WHERE (quantity<0 OR reserved_quantity<0)
       AND EXISTS(
         SELECT 1 FROM inventory_reservations r
         WHERE r.order_id=? AND r.variant_id=inventory_stock.variant_id
           AND r.inventory_source=inventory_stock.inventory_source
       )`
  ).bind(step.orderId).first<{invalid:number}>()
  if(toInt(stock?.invalid,0))fail('Складские остатки или резервы ушли ниже нуля.')
  // A cancellation cannot be accepted while its own inventory events remain
  // applied, even if the unrelated stock balance still looks nonnegative.
  const activeEvents=await db.prepare(
    `SELECT COUNT(*) AS n FROM inventory_lifecycle_events
     WHERE operation_type=? AND operation_id=? AND status='applied'`
  ).bind(step.type,step.id).first<{n:number}>()
  if(toInt(activeEvents?.n,0))
    fail('После отмены остались применённые складские движения этой операции.')
}

export function createRealAdminDeleteCancellationDriver(
  db:D1Database,overrides:Partial<CancelDependencies>={},
):SagaCancelDriver {
  const h={...handlers,...overrides}
  return {
    async preflight(step) {
      if(!Number.isSafeInteger(step.orderId)||step.orderId<=0
        ||!Number.isSafeInteger(step.id)||step.id<=0
        ||!step.cancelRequestId)
        fail('Повреждены идентификаторы шага отмены.')
      const row=await readStepTarget(db,step)
      const cancelled=cleanText(row.status)==='cancelled'
      const replay=await assertCriticalOwnedBySaga(db,step,false)
      if(cancelled&&!replay)
        fail('Связанная операция уже отменена вручную, но не этим журналом. Автоматическое продолжение запрещено.')
      if(step.type==='exchange') {
        if(!await h.isExchangeSetV2(db,step.id))
          fail('Обмен старого формата не допускает автоматического исполнения этой цепочки.')
        // The V2 cancellation handler itself reverses the linked extra payment
        // or exchange refund in its own idempotent money ledger.
      } else {
        // The existing Return cancellation reverses the refund and keeps
        // historical financial events for audit.
        const parent=await db.prepare(
          `SELECT id FROM exchanges WHERE refund_return_id=?
           AND COALESCE(status,'completed')<>'cancelled' LIMIT 1`
        ).bind(step.id).first<{id:number}>()
        if(parent?.id)fail('Этот возврат принадлежит обмену. Отменять отдельно его нельзя.')
      }
      await verifyFinancialLedger(db,step)
      await verifyNoIssuedItems(db,step)
    },
    async cancel(step) {
      const comment=cancelComment
      return step.type==='return'
        ? h.cancelReturn(db,step.id,{requestId:step.cancelRequestId,comment})
        : h.cancelExchangeSetV2(db,step.id,{requestId:step.cancelRequestId,comment})
    },
    async verifyReconciled(step) {
      const row=await readStepTarget(db,step)
      if(cleanText(row.status)!=='cancelled')return false
      await assertCriticalOwnedBySaga(db,step,true)
      // Recheck physical facts AFTER the handler as well as before it.
      // A concurrent inbound or confirmed handover on a sibling operation
      // must stop the saga cursor even if this step itself reconciled.
      await verifyNoIssuedItems(db,step)
      await verifyFinancialLedger(db,step)
      await verifyOrderAndInventoryFacts(db,step)
      return true
    },
  }
}
