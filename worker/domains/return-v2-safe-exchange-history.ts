// Historical exchanges with no cash operation may coexist with an independently
// evidenced Return V2. The replaced old item must be absent from the current
// purchase and the replacement must belong to that same order.
// This expression is only called with static SQL identifiers within the Worker.
export function unsafeActiveExchangeSql(orderIdSql:string):string {
  return `EXISTS(SELECT 1 FROM exchanges e
     WHERE e.order_id=${orderIdSql}
       AND COALESCE(e.status,'completed')<>'cancelled'
       AND (
         COALESCE(e.financial_action,'none')<>'none'
         OR COALESCE(e.financial_amount,0)<>0
         OR e.payment_id IS NOT NULL OR e.refund_return_id IS NOT NULL
         OR e.old_order_item_id IS NULL OR e.new_order_item_id IS NULL
         OR e.old_order_item_id=e.new_order_item_id
         OR NOT EXISTS(SELECT 1 FROM order_items old_item
            WHERE old_item.id=e.old_order_item_id
              AND old_item.order_id=e.order_id AND old_item.quantity=0)
         OR NOT EXISTS(SELECT 1 FROM order_items new_item
            WHERE new_item.id=e.new_order_item_id AND new_item.order_id=e.order_id)
       ))`
}
