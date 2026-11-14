// Versioned Return V2 preview only. This module never edits money, orders or inventory.
type ReturnLineInput={orderItemId?:unknown;quantity?:unknown}
type ReturnPreviewInput={orderId?:unknown;expectedTotalAmount?:unknown;refundAmount?:unknown;items?:ReturnLineInput[]}
class PreviewConflict extends Error {
  readonly status:number
  readonly code:string
  constructor(message:string,code='return_v2_preview_unavailable',status=409){
    super(message);this.name='PreviewConflict';this.code=code;this.status=status
  }
}
function safeInt(raw:unknown,label:string,min=0):number {
  if(raw===null||raw===undefined||raw===''||typeof raw==='boolean')
    throw new PreviewConflict(label+': укажите число.','return_v2_invalid_input',400)
  const n=Number(raw)
  if(!Number.isSafeInteger(n)||n<min)
    throw new PreviewConflict(label+': ожидается неотрицательное целое число.','return_v2_invalid_input',400)
  return n
}

export async function previewStandaloneReturnV2(db:D1Database,input:ReturnPreviewInput){
  const orderId=safeInt(input.orderId,'ID заказа',1)
  const order=await db.prepare(
    `SELECT id,pricing_mode,total_amount,order_status,archived_at,updated_at FROM orders WHERE id=? LIMIT 1`
  ).bind(orderId).first<Record<string,unknown>>()
  if(!order)throw new PreviewConflict('Заказ не найден.','return_v2_not_found',404)
  if(['archived','deleted'].includes(String(order.order_status||''))||order.archived_at)
    throw new PreviewConflict('Возврат архивного/удалённого заказа недоступен.')
  if(String(order.pricing_mode||'')!=='itemized_v1')
    throw new PreviewConflict('В старом заказе нет проверенных поштучных цен. Автопересчёт запрещён.','return_v2_legacy_price')

  const [prior,active,payments]=await Promise.all([
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM returns WHERE order_id=?) AS return_count,
      (SELECT COUNT(*) FROM exchanges WHERE order_id=?) AS exchange_count`
    ).bind(orderId,orderId).first<{return_count:number;exchange_count:number}>(),
    db.prepare(`SELECT oi.id,oi.product_name_snapshot,oi.quantity,oi.unit_price,oi.line_total,oi.stock_writeoff_status,
        COALESCE((SELECT SUM(MAX(0,di.quantity-di.cancelled_quantity)) FROM order_dispatch_items di
          WHERE di.order_item_id=oi.id),0) AS dispatched_quantity
      FROM order_items oi WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`
    ).bind(orderId).all<Record<string,unknown>>(),
    db.prepare(`SELECT COALESCE(SUM(amount),0) AS received_amount
      FROM payments WHERE order_id=? AND amount>0`
    ).bind(orderId).first<{received_amount:number}>(),
  ])
  // Old Return/Exchange events cannot be assigned a new contractual reduction.
  if(Number(prior?.return_count||0)>0||Number(prior?.exchange_count||0)>0)
    throw new PreviewConflict('Заказ уже содержит возврат или обмен. Пока используйте действующую логику.','return_v2_prior_operation')
  const total=safeInt(order.total_amount,'Сумма заказа')
  if(input.expectedTotalAmount!==undefined&&safeInt(input.expectedTotalAmount,'Ожидаемая сумма')!==total)
    throw new PreviewConflict('Стоимость заказа изменилась. Обновите форму.','return_v2_stale')
  const byId=new Map<number,{quantity:number;price:number;name:string;issuedQuantity:number}>()
  let sourceTotal=0
  for(const row of active.results||[]){
    const id=safeInt(row.id,'Позиция',1)
    const quantity=safeInt(row.quantity,'Количество',1)
    const price=safeInt(row.unit_price,'Цена продажи')
    const lineTotal=safeInt(row.line_total,'Сумма позиции')
    if(quantity*price!==lineTotal||!Number.isSafeInteger(sourceTotal+lineTotal))
      throw new PreviewConflict('Цена или количество позиции не совпадают с итогом.','return_v2_ambiguous_price')
    sourceTotal+=lineTotal
    const dispatched=safeInt(row.dispatched_quantity,'Выдано')
    const issuedByOldStatus=['fulfilled','written_off','negative','retired_physically_issued'].includes(String(row.stock_writeoff_status||''))
    const issuedQuantity=dispatched>0?Math.min(quantity,dispatched):(issuedByOldStatus?quantity:0)
    byId.set(id,{quantity,price,name:String(row.product_name_snapshot||''),issuedQuantity})
  }
  if(!byId.size||total!==sourceTotal)
    throw new PreviewConflict('Стоимость заказа не совпадает с суммой активных товарных позиций.','return_v2_ambiguous_price')

  if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)
    throw new PreviewConflict('Выберите возвращаемые товары.','return_v2_invalid_input',400)
  const seen=new Set<number>()
  const selected:Array<{orderItemId:number;productName:string;quantity:number;orderLineQuantity:number;unitSoldPrice:number;cancelledValue:number}>=[]
  let removed=0
  for(const i of input.items){
    const itemId=safeInt(i?.orderItemId,'Позиция',1)
    const quantity=safeInt(i?.quantity,'Возвращаемое количество',1)
    if(seen.has(itemId))throw new PreviewConflict('Одна позиция выбрана дважды.','return_v2_duplicate_item',400)
    seen.add(itemId)
    const line=byId.get(itemId)
    if(!line||quantity>line.quantity)
      throw new PreviewConflict('Выбранной позиции или количества больше нет. Обновите форму.','return_v2_stale')
    if(quantity>line.issuedQuantity)
      throw new PreviewConflict('Товар ещё не был выдан клиенту в выбранном количестве. Для него нужна отмена невыданной позиции, а не физический возврат.','return_v2_unissued')
    const amount=line.price*quantity
    if(!Number.isSafeInteger(removed+amount))
      throw new PreviewConflict('Сумма возврата слишком велика.','return_v2_invalid_input',400)
    removed+=amount
    selected.push({orderItemId:itemId,productName:line.name,quantity,orderLineQuantity:line.quantity,unitSoldPrice:line.price,cancelledValue:amount})
  }
  const paidIn=safeInt(payments?.received_amount??0,'Получено денег')
  const refund=input.refundAmount===undefined?removed:safeInt(input.refundAmount,'Выплата клиенту')
  const cashAvailable=paidIn
  const cashCovered=refund<=cashAvailable
  const currentSale=total-removed
  const netHeld=paidIn-refund
  const signedBalance=currentSale-netHeld
  return {
    ok:true,mode:'return_v2_shadow_preview',readOnly:true,commitAllowed:false,orderId,
    baseline:{totalAmount:total,receivedAmount:paidIn,returnAmount:0,updatedAt:String(order.updated_at||'')},
    selected,suggestedRefundAmount:removed,requestedRefundAmount:refund,
    cashAvailable,cashCovered,
    projected:{currentSale,netHeld,signedBalance,customerDebt:Math.max(0,signedBalance),customerOverpay:Math.max(0,-signedBalance)},
    physicalReceipt:'unconfirmed',requiresPhysicalIntake:true,
    warning:cashCovered?'Расчёт предварительный: деньги, заказ, склад и резервы не изменены.':
      'Предложенная выплата превышает реально полученные средства. Проводить её нельзя.',
  }
}
