// Prepared Return V2 snapshot, NOT a committed Return/payment/stock receipt.
// Deliberately not registered in worker/index.ts until posting compatibility is proven.
import { criticalOperationFingerprint } from './critical.ts'
import { previewStandaloneReturnV2 } from './return-v2-shadow-preview.ts'

export class ReturnV2PreparationConflict extends Error {
  readonly status = 409
  readonly code = 'return_v2_preparation_conflict'
}
type Input = {
  requestId: string
  orderId: number
  expectedTotalAmount: number
  refundAmount?: number
  refundMethod?: string
  items: Array<{ orderItemId: number; quantity: number }>
}
function fail(message:string):never { throw new ReturnV2PreparationConflict(message) }
function validRequestId(value:unknown):string {
  if(typeof value!=='string'||!/^[a-zA-Z0-9._:-]{1,160}$/.test(value))fail('Некорректный идентификатор запроса.')
  return value as string
}
function money(value:unknown):number {
  if(value===null||value===undefined||value===''||typeof value==='boolean')fail('Укажите сумму.')
  const n=Number(value)
  if(!Number.isSafeInteger(n)||n<0)fail('Сумма должна быть целым неотрицательным числом.')
  return n
}
async function readPrepared(db:D1Database,requestId:string) {
  const header=await db.prepare(
    `SELECT id,request_id,payload_fingerprint,order_id,baseline_total,baseline_received,
      reduced_value,projected_total,planned_refund,planned_refund_method,status,created_at,baseline_order_updated_at
     FROM return_v2_prepared_operations WHERE request_id=? LIMIT 1`
  ).bind(requestId).first<Record<string,unknown>>()
  if(!header)return null
  const items=await db.prepare(
    `SELECT order_item_id,quantity,sold_unit_price,reduced_value,physical_state,baseline_order_item_quantity
     FROM return_v2_prepared_items WHERE operation_id=? ORDER BY order_item_id`
  ).bind(header.id).all<Record<string,unknown>>()
  return {header,items:items.results||[]}
}

// Atomic proposal only; no mutation of orders, return_items, cash, inventory or reservations.
export async function prepareReturnV2(db:D1Database,input:Input) {
  const requestId=validRequestId(input.requestId)
  const orderId=money(input.orderId)
  if(orderId===0)fail('Укажите заказ.')
  const expectedTotal=money(input.expectedTotalAmount)
  const selected=Array.isArray(input.items)?[...input.items]:[]
  if(!selected.length||selected.length>100)fail('Выберите возвращаемые позиции.')
  const fingerprint=await criticalOperationFingerprint('return_v2_prepare',{
    orderId,expectedTotal,
    items:selected.map(x=>({orderItemId:x.orderItemId,quantity:x.quantity}))
      .sort((a,b)=>Number(a.orderItemId)-Number(b.orderItemId)),
    refundAmount:input.refundAmount,refundMethod:String(input.refundMethod||'').trim().toUpperCase()
  })
  const previous=await readPrepared(db,requestId)
  const resumed=(row:NonNullable<Awaited<ReturnType<typeof readPrepared>>>)=>({
    ok:true,prepared:true,posted:false,replayed:true,
    preparationId:row.header.id,orderId,plannedContractReduction:row.header.reduced_value,
    plannedCashRefund:row.header.planned_refund,items:row.items
  })
  if(previous){
    if(previous.header.payload_fingerprint!==fingerprint)fail('Этот идентификатор уже использован для другого возврата.')
    if(previous.items.length!==selected.length)fail('Сохранённая подготовка возврата неполная.')
    return resumed(previous)
  }
  const preview=await previewStandaloneReturnV2(db,{
    orderId,expectedTotalAmount:expectedTotal,items:selected,refundAmount:input.refundAmount
  })
  if(!preview.cashCovered)fail('Предлагаемая выплата превышает ранее полученные деньги.')
  const refund=money(preview.requestedRefundAmount)
  const method=String(input.refundMethod||'').trim().toUpperCase()
  if(refund>0&&!method)fail('Выберите способ возврата денег.')
  if(refund===0&&method)fail('При нулевой выплате способ оплаты не нужен.')
  if(method.length>100)fail('Слишком длинное название способа оплаты.')
  const baselineVersion=String(preview.baseline.updatedAt||'')
  if(!baselineVersion)fail('В заказе отсутствует версия изменения.')
  const baseline=money(preview.baseline.totalAmount)
  const received=money(preview.baseline.receivedAmount)
  const reduced=money(preview.suggestedRefundAmount)
  const projectedTotal=money(preview.projected.currentSale)
  const timestamp=new Date().toISOString()
  // NULL in a required field makes stale CAS fail atomically; D1 batch rolls back.
  const statements:D1PreparedStatement[]=[
    db.prepare(
      `INSERT INTO return_v2_prepared_operations (
        request_id,payload_fingerprint,order_id,baseline_total,baseline_received,
        reduced_value,projected_total,planned_refund,planned_refund_method,created_at,baseline_order_updated_at
      ) VALUES (?,?,?,
        CASE WHEN EXISTS (
          SELECT 1 FROM orders o WHERE o.id=?
          AND o.pricing_mode='itemized_v1'
          AND o.order_status NOT IN ('deleted','archived') AND o.archived_at IS NULL
          AND o.total_amount=? AND o.updated_at=?
          AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
               WHERE oi.order_id=o.id AND oi.quantity>0)=?
          AND NOT EXISTS(SELECT 1 FROM returns r WHERE r.order_id=o.id)
          AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id)
          AND (SELECT COALESCE(SUM(p.amount),0) FROM payments p
               WHERE p.order_id=o.id AND p.amount>0)=?
        ) THEN ? ELSE NULL END,
        ?,?,?,?,?,?,?
      )`
    ).bind(requestId,fingerprint,orderId,
      orderId,baseline,baselineVersion,baseline,received,baseline,
      received,reduced,projectedTotal,refund,method||null,timestamp,baselineVersion)
  ]
  for(const item of preview.selected){
    statements.push(db.prepare(
      `INSERT INTO return_v2_prepared_items (
        operation_id,order_item_id,quantity,sold_unit_price,reduced_value,baseline_order_item_quantity
      ) VALUES (
        (SELECT id FROM return_v2_prepared_operations WHERE request_id=?),?,
        CASE WHEN EXISTS(
          SELECT 1 FROM order_items oi
          WHERE oi.id=? AND oi.order_id=? AND oi.quantity>=? AND oi.quantity=?
            AND oi.unit_price=? AND oi.line_total=oi.quantity*oi.unit_price
            AND (
              (SELECT COALESCE(SUM(di.quantity-di.cancelled_quantity),0)
               FROM order_dispatch_items di WHERE di.order_item_id=oi.id)>=?
              OR (NOT EXISTS(SELECT 1 FROM order_dispatch_items di
                              WHERE di.order_item_id=oi.id)
                AND oi.stock_writeoff_status IN
                 ('fulfilled','written_off','negative','retired_physically_issued'))
            )
            AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir
                           WHERE ir.order_item_id=oi.id AND ir.status IN ('active','unresolved'))
        ) THEN ? ELSE NULL END,?,?,?
      )`
    ).bind(requestId,item.orderItemId,item.orderItemId,orderId,item.quantity,
      item.orderLineQuantity,item.unitSoldPrice,item.quantity,item.quantity,item.unitSoldPrice,item.cancelledValue,item.orderLineQuantity))
  }
  try { await db.batch(statements) }
  catch(err) {
    const raced=await readPrepared(db,requestId)
    if(raced?.header.payload_fingerprint===fingerprint&&raced.items.length===selected.length)return resumed(raced)
    const message=err instanceof Error?err.message:String(err)
    if(/constraint failed|NOT NULL|UNIQUE/i.test(message))
      fail('Данные заказа, выдачи или оплаты изменились. Подготовка отменена, обновите расчёт.')
    throw err
  }
  const saved=await readPrepared(db,requestId)
  if(!saved||saved.items.length!==selected.length)throw Error('Неполная подготовка после транзакции.')
  return {ok:true,prepared:true,posted:false,replayed:false,
    preparationId:saved.header.id,orderId,plannedContractReduction:reduced,plannedCashRefund:refund,items:saved.items}
}
