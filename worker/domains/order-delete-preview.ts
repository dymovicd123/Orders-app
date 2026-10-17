// Read-only, admin-only deletion impact preview. Never sends or reverses money,
// cancels an Exchange/Return, or changes inventory. The actual POST independently
// rechecks all dependencies before any mutation.
import { cleanText, toInt } from '../core/text.ts'

export type AdminOrderDeletePreview = {
  orderId:number;externalId:string;orderStatus:string;shippingStatus:string;
  canAttemptDelete:boolean;requiresPhysicalFact:boolean;
  activeExchanges:number[];activeReturns:number[];
  receivedAmount:number;returnAmount:number;paymentCount:number;
  registeredPayments:number;recordedRefunds:number;
  issuedItemCount:number;issuedQuantity:number;
  reasons:string[];explanations:string[];
}

export async function previewAdminOrderDeletion(
  db:D1Database,orderIdRaw:number,
):Promise<AdminOrderDeletePreview>{
  const orderId=toInt(orderIdRaw,0)
  if(!orderId)throw new Error('Укажите существующий заказ.')
  const order=await db.prepare(
    `SELECT id,external_id,order_status,shipping_status,received_amount,return_amount
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
  const reasons:string[]=[]
  if(activeExchanges.length>200||activeReturns.length>200)
    reasons.push('Слишком много связанных операций. Требуется отдельная проверка истории.')
  if(activeExchanges.length||activeReturns.length)
    reasons.push('Есть действующие обмены или возвраты. Их нельзя отменять при удалении по одной операции без защищённого плана восстановления.')
  const status=cleanText(order.order_status).toLowerCase()
  if(status==='archived')reasons.push('Заказ находится в архиве. Сначала верните его из архива.')
  if(status==='deleted')reasons.push('Заказ уже удалён.')
  const shipping=cleanText(order.shipping_status).toLowerCase()
  const requiresPhysicalFact=shipping==='sent'||toInt(fulfilled?.issued_count,0)>0
  const recordedRefunds=(returns.results||[]).reduce((sum,x)=>sum+Math.max(0,toInt(x.amount,0)),0)
  const registeredPayments=Math.max(0,toInt(payments?.positive_amount,0))
  const explanations=[
    activeExchanges.length?`Активных обменов: ${activeExchanges.length}. Их учёт и складские события останутся неизменными, пока не будет безопасно подтверждена цепочка отмен.`:'',
    activeReturns.length?`Активных возвратов: ${activeReturns.length}. Их финансы и склад не будут отменены автоматически при текущем ограничении.`:'',
    registeredPayments?`Зарегистрировано оплат на ${registeredPayments} ₸. Удаление не означает физическую выдачу денег клиенту; необходимо подтвердить реальное движение отдельно.`:'',
    recordedRefunds?`По активным возвратам записано ${recordedRefunds} ₸. Действительно переданные деньги нельзя просто стирать.`:'',
    requiresPhysicalFact?'Есть признак выдачи товара. Система отдельно запросит факт физической передачи и проверит более поздние ревизии.':'',
  ].filter(Boolean)
  return {
    orderId,externalId:cleanText(order.external_id),orderStatus:status,shippingStatus:shipping,
    canAttemptDelete:reasons.length===0,requiresPhysicalFact,
    activeExchanges,activeReturns,
    receivedAmount:Math.max(0,toInt(order.received_amount,0)),
    returnAmount:Math.max(0,toInt(order.return_amount,0)),
    paymentCount:Math.max(0,toInt(payments?.payment_count,0)),
    registeredPayments,recordedRefunds,
    issuedItemCount:Math.max(0,toInt(fulfilled?.issued_count,0)),
    issuedQuantity:Math.max(0,toInt(fulfilled?.issued_quantity,0)),
    reasons,explanations,
  }
}
