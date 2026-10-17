// Read-only, admin-only deletion impact preview. Never sends or reverses money,
// cancels an Exchange/Return, or changes inventory. The actual POST independently
// rechecks all dependencies before any mutation.
import { cleanText, toInt } from '../core/text.ts'
import { previewAdminOrderDeleteChain, type AdminDeleteChainPlan } from './order-delete-chain-plan.ts'
import { previewAdminDeleteImpact, type AdminDeleteImpact } from './admin-delete-impact.ts'
import { reviewAdminDeleteAppliedStock, type AdminDeleteAppliedStockReview } from './admin-delete-physical.ts'

export type AdminOrderDeletePreview = {
  orderId:number;externalId:string;orderStatus:string;shippingStatus:string;
  canAttemptDelete:boolean;canStartChain:boolean;requiresPhysicalFact:boolean;
  activeExchanges:number[];activeReturns:number[];
  receivedAmount:number;returnAmount:number;paymentCount:number;
  registeredPayments:number;recordedRefunds:number;
  issuedItemCount:number;issuedQuantity:number;
  reasons:string[];explanations:string[];impact:AdminDeleteImpact;appliedStockReview:AdminDeleteAppliedStockReview;
  chainPlan:AdminDeleteChainPlan;
}

export async function previewAdminOrderDeletion(
  db:D1Database,orderIdRaw:number,
):Promise<AdminOrderDeletePreview>{
  const orderId=toInt(orderIdRaw,0)
  if(!orderId)throw new Error('Укажите существующий заказ.')
  const order=await db.prepare(
    `SELECT id,external_id,order_status,shipping_status,total_amount,received_amount,return_amount
     FROM orders WHERE id=? LIMIT 1`
  ).bind(orderId).first<Record<string,unknown>>()
  if(!order)throw new Error('Заказ не найден.')
  const [exchanges,returns,payments,fulfilled]=await Promise.all([
    db.prepare(
      `SELECT id FROM exchanges WHERE order_id=?
       AND COALESCE(status,'completed')<>'cancelled' ORDER BY id DESC LIMIT 201`
    ).bind(orderId).all<{id:number}>(),
    db.prepare(
      `SELECT id,amount FROM returns WHERE order_id=?
       AND COALESCE(status,'completed')<>'cancelled' ORDER BY id DESC LIMIT 201`
    ).bind(orderId).all<{id:number;amount:number}>(),
    db.prepare(
      `SELECT COUNT(*) AS payment_count,
              COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS positive_amount
       FROM payments WHERE order_id=?`
    ).bind(orderId).first<{payment_count:number;positive_amount:number}>(),
    db.prepare(
      `SELECT COUNT(*) AS issued_count,COALESCE(SUM(quantity),0) AS issued_quantity
       FROM inventory_reservations WHERE order_id=? AND status='fulfilled'`
    ).bind(orderId).first<{issued_count:number;issued_quantity:number}>(),
  ])
  const activeExchanges=(exchanges.results||[]).map(x=>toInt(x.id,0)).filter(Boolean)
  const activeReturns=(returns.results||[]).map(x=>toInt(x.id,0)).filter(Boolean)
  const chainPlan=await previewAdminOrderDeleteChain(db,orderId)
  const impact=await previewAdminDeleteImpact(db,orderId,Math.max(0,toInt(order.total_amount,0)),new Set(activeReturns))
  const appliedStockReview=await reviewAdminDeleteAppliedStock(db,orderId)
  const reasons:string[]=[]
  if(!appliedStockReview.allowed)reasons.push(...appliedStockReview.blockers)
  if(activeExchanges.length>200||activeReturns.length>200)
    reasons.push('Слишком много связанных операций. Требуется отдельная проверка истории.')
  const hasChain=Boolean(activeExchanges.length||activeReturns.length)
  if(hasChain&&(chainPlan.manualReviewRequired||!chainPlan.allOperationsAccountedFor))
    reasons.push('Некоторые связанные операции требуют ручной проверки истории перед автоматической отменой.')
  const status=cleanText(order.order_status).toLowerCase()
  if(status==='archived')reasons.push('Заказ находится в архиве. Сначала верните его из архива.')
  if(status==='deleted')reasons.push('Заказ уже удалён.')
  const shipping=cleanText(order.shipping_status).toLowerCase()
  const requiresPhysicalFact=shipping==='sent'||toInt(fulfilled?.issued_count,0)>0
  const recordedRefunds=(returns.results||[]).reduce((sum,x)=>sum+Math.max(0,toInt(x.amount,0)),0)
  const registeredPayments=Math.max(0,toInt(payments?.positive_amount,0))
  for(const blocker of chainPlan.blockers)reasons.push(blocker)
  if(activeExchanges.length!==chainPlan.activeExchangeIds.length||activeReturns.length!==chainPlan.activeReturnIds.length)
    reasons.push('Невозможно сверить полный список связанных операций. Удаление заблокировано.')
  const cachedPaid=toInt(order.received_amount,0)
  const cachedReturned=toInt(order.return_amount,0)
  if(impact.truncated)reasons.push('Список финансовых или складских операций слишком велик; удаление остановлено для проверки.')
  if(cachedPaid!==registeredPayments||cachedReturned!==recordedRefunds)
    reasons.push('Финансовые суммы заказа не совпадают с действующими оплатами и возвратами. Перед удалением требуется сверка.')
  const explanations=[
    activeExchanges.length?`Будут отменены ${activeExchanges.length} обменов в безопасном порядке зависимостей.`:'',
    activeReturns.length?`Возвратов в истории: ${activeReturns.length}; при отмене их учётные движения сторнируются.`:'',
    registeredPayments?`Записанные оплаты на ${registeredPayments} ₸ будут аннулированы в учёте. Это не физическая выдача денег клиенту.`:'',
    recordedRefunds?`Зарегистрированные возвраты на ${recordedRefunds} ₸ будут компенсированы учётным сторно.`:'',
    requiresPhysicalFact?'Есть признак выдачи товара. Система отдельно запросит факт физической передачи и проверит более поздние ревизии.':'',
    appliedStockReview.reversals.length?`Обнаружено ${appliedStockReview.reversals.length} подтверждённых учётных списаний без выдачи: при отмене обмена восстановится точно списанное количество, а активные резервы освободятся.`:'',
  ].filter(Boolean)
  if(hasChain&&requiresPhysicalFact)
    reasons.push('Для цепочки с зафиксированной выдачей товара сначала нужна проверка фактической передачи и более поздних ревизий.')
  const canStartChain=hasChain && reasons.length===0
    && !requiresPhysicalFact && chainPlan.allOperationsAccountedFor
    && !chainPlan.manualReviewRequired && chainPlan.steps.length>0
  return {
    orderId,externalId:cleanText(order.external_id),orderStatus:status,shippingStatus:shipping,
    canAttemptDelete:!hasChain&&reasons.length===0,canStartChain,requiresPhysicalFact,
    activeExchanges,activeReturns,
    receivedAmount:Math.max(0,toInt(order.received_amount,0)),
    returnAmount:Math.max(0,toInt(order.return_amount,0)),
    paymentCount:Math.max(0,toInt(payments?.payment_count,0)),
    registeredPayments,recordedRefunds,
    issuedItemCount:Math.max(0,toInt(fulfilled?.issued_count,0)),
    issuedQuantity:Math.max(0,toInt(fulfilled?.issued_quantity,0)),
    reasons,explanations,chainPlan,impact,appliedStockReview,
  }
}
