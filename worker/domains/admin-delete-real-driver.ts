// Production-handler adapter for the dormant admin deletion saga. Intentionally
// NOT exposed through HTTP. The explicit guard is checked again before EVERY
// step. Real cancellation retains its own critical-operation idempotency.
import { cleanText, toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { readOrderFinancialLedger } from './money.ts'
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

async function readStepTarget(db:D1Database,step:SagaCancelStep){
  const table=step.type==='return'?'returns':'exchanges'
  const row=await db.prepare(
    `SELECT * FROM ${table} WHERE id=? AND order_id=? LIMIT 1`
  ).bind(step.id,step.orderId).first<Record<string,unknown>>()
  if(!row)fail('Связанная операция больше не относится к этому заказу.')
  return row!
}

async function verifyNoMoneyMutation(db:D1Database,step:SagaCancelStep){
  const ledger=await readOrderFinancialLedger(db,step.orderId)
  const payments=await db.prepare(
    `SELECT COUNT(*) AS n FROM payments WHERE order_id=?`
  ).bind(step.orderId).first<{n:number}>()
  const returns=await db.prepare(
    `SELECT COUNT(*) AS n FROM returns
     WHERE order_id=? AND COALESCE(amount,0)<>0`
  ).bind(step.orderId).first<{n:number}>()
  const exchanges=await db.prepare(
    `SELECT COUNT(*) AS n FROM exchanges
     WHERE order_id=?
       AND (COALESCE(financial_amount,0)<>0
         OR COALESCE(financial_action,'none') NOT IN ('none','')
         OR payment_id IS NOT NULL)`
  ).bind(step.orderId).first<{n:number}>()
  if(toInt(payments?.n,0)||toInt(returns?.n,0)||toInt(exchanges?.n,0)
    ||ledger.receivedAmount!==0||ledger.returnAmount!==0
    ||ledger.debtAmount!==Math.max(0,ledger.totalAmount))
    fail('У заказа найдены денежные операции, включая исторически отменённые. Пока их сторно не подтверждено, цепочка остановлена.')
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
    ||cleanText(order.shipping_status)==='sent'||toInt(issued?.n,0)>0)
    fail('Заказ уже закрыт, отправлен или имеет зарегистрированную выдачу. Нужна проверка фактического движения товара.')
  if(cleanText(order.pricing_mode)!=='itemized_v1')
    fail('Старый формат стоимости требует отдельного сценария отмены цепочки.')
}

async function assertCriticalOwnedBySaga(db:D1Database,step:SagaCancelStep,needsCompleted:boolean){
  const operation=await db.prepare(
    `SELECT operation_type,status,request_id,response_json
     FROM critical_operations WHERE request_id=?`
  ).bind(step.cancelRequestId).first<Record<string,unknown>>()
  if(!operation){
    if(needsCompleted)fail('Не найдена подтверждённая запись об отмене операции.')
    return false
  }
  if(cleanText(operation.operation_type)!==opType(step)
    ||!['started','completed'].includes(cleanText(operation.status)))
    fail('Ключ отмены уже используется другой критической операцией.')
  if(needsCompleted&&cleanText(operation.status)!=='completed')
    fail('Обработчик ещё не завершил отмену; переходить к следующей операции рано.')
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
       COUNT(CASE WHEN quantity<0 OR unit_price<0 OR line_total<0 THEN 1 END) AS invalid
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
        if(toInt(row.financial_amount,0)>0||toInt(row.payment_id,0)>0
          ||!['','none'].includes(cleanText(row.financial_action)))
          fail('У обмена зарегистрирована денежная операция. Для неё требуется отдельная проверка сторно.')
      } else {
        if(toInt(row.amount,0)!==0)
          fail('Возврат с денежным движением нельзя автоматически отменять без утверждённого финансового сторно.')
        const parent=await db.prepare(
          `SELECT id FROM exchanges WHERE refund_return_id=?
           AND COALESCE(status,'completed')<>'cancelled' LIMIT 1`
        ).bind(step.id).first<{id:number}>()
        if(parent?.id)fail('Этот возврат принадлежит обмену. Отменять отдельно его нельзя.')
      }
      await verifyNoMoneyMutation(db,step)
      await verifyNoIssuedItems(db,step)
    },
    async cancel(step) {
      const comment='Автоматическая отмена зависимой операции перед административным удалением'
      return step.type==='return'
        ? h.cancelReturn(db,step.id,{requestId:step.cancelRequestId,comment})
        : h.cancelExchangeSetV2(db,step.id,{requestId:step.cancelRequestId,comment})
    },
    async verifyReconciled(step) {
      const row=await readStepTarget(db,step)
      if(cleanText(row.status)!=='cancelled')return false
      await assertCriticalOwnedBySaga(db,step,true)
      await verifyNoMoneyMutation(db,step)
      await verifyOrderAndInventoryFacts(db,step)
      return true
    },
  }
}
