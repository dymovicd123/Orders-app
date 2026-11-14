// New Return V2 contract-capacity projection, intentionally NOT wired to old handlers.
// Requires migration 0125 first. Existing Return rows default to marker 0.
// This helper neither changes stock nor posts a refund; posting needs an atomic CAS.
type QuantityRow = {
  order_id:number
  order_item_id:number
  current_quantity:number
  unit_price:number
  line_total:number
  historical_returned_quantity:number
  v2_contract_returned_quantity:number
  total_returned_quantity:number
}

export type ReturnV2ContractCapacity = {
  orderId:number
  orderItemId:number
  currentOrderItemQuantity:number
  alreadyReturnedWithoutLineReduction:number
  alreadyReturnedWithLineReduction:number
  totalPhysicalReturnQuantity:number
  availableForNewReturn:number
  unitPrice:number
  currentContractLineValue:number
}

export class ReturnV2ContractCapacityConflict extends Error {
  readonly code='return_v2_contract_capacity_conflict'
  readonly status=409
}

// Legacy return marker=0: did not reduce order_items.quantity, so subtract it.
// V2 marker=1: already reduced that line, so do NOT subtract it again.
// Both types remain in physical receipt and audit history.
export async function readReturnV2ContractCapacity(
  db:D1Database,orderId:number,orderItemId:number,
):Promise<ReturnV2ContractCapacity> {
  if (!Number.isSafeInteger(orderId)||orderId<1
    ||!Number.isSafeInteger(orderItemId)||orderItemId<1) {
    throw new ReturnV2ContractCapacityConflict('Некорректная позиция заказа.')
  }
  const row=await db.prepare(
    `SELECT oi.order_id,oi.id AS order_item_id,oi.quantity AS current_quantity,
      oi.unit_price,oi.line_total,
      COALESCE(SUM(CASE WHEN COALESCE(ri.contract_quantity_applied,0)=0
        THEN ri.quantity ELSE 0 END),0) AS historical_returned_quantity,
      COALESCE(SUM(CASE WHEN ri.contract_quantity_applied=1
        THEN ri.quantity ELSE 0 END),0) AS v2_contract_returned_quantity,
      COALESCE(SUM(ri.quantity),0) AS total_returned_quantity
     FROM order_items oi
     LEFT JOIN return_items ri ON ri.order_item_id=oi.id
       AND EXISTS(
         SELECT 1 FROM returns r WHERE r.id=ri.return_id AND r.order_id=oi.order_id
          AND COALESCE(r.status,'completed')<>'cancelled'
          AND NOT EXISTS(
            SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id
            AND COALESCE(e.status,'completed')<>'cancelled'
          )
       )
     WHERE oi.id=? AND oi.order_id=?
     GROUP BY oi.id`
  ).bind(orderItemId,orderId).first<QuantityRow>()
  if(!row)throw new ReturnV2ContractCapacityConflict('Позиция заказа не найдена.')
  const vals=[row.current_quantity,row.unit_price,row.line_total,
    row.historical_returned_quantity,row.v2_contract_returned_quantity,row.total_returned_quantity]
  if(vals.some(x=>!Number.isSafeInteger(x)||x<0)
    ||!Number.isSafeInteger(row.current_quantity*row.unit_price)
    ||row.line_total!==row.current_quantity*row.unit_price) {
    throw new ReturnV2ContractCapacityConflict('Цена или количество позиции не согласованы. Проведение остановлено.')
  }
  const available=row.current_quantity-row.historical_returned_quantity
  if(available<0
    ||row.historical_returned_quantity+row.v2_contract_returned_quantity!==row.total_returned_quantity){
    throw new ReturnV2ContractCapacityConflict('Возвращённое количество расходится с заказом. Требуется проверка.')
  }
  return {
    orderId,orderItemId,
    currentOrderItemQuantity:row.current_quantity,
    alreadyReturnedWithoutLineReduction:row.historical_returned_quantity,
    alreadyReturnedWithLineReduction:row.v2_contract_returned_quantity,
    totalPhysicalReturnQuantity:row.total_returned_quantity,
    availableForNewReturn:available,
    unitPrice:row.unit_price,
    currentContractLineValue:row.line_total,
  }
}
