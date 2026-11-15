// A cancelled dispatch is harmless for a new customer cancellation ONLY
// when every old item-level issue was fully undone, physical stock was
// actually restored, and the original movement still proves what was reversed.
// A missing correction or partial cancellation always fails closed.
export function noUnreversedDispatchSql(itemIdSql:string):string {
  return `NOT EXISTS(SELECT 1 FROM order_dispatch_items di
    JOIN order_dispatches d ON d.id=di.dispatch_id
    WHERE di.order_item_id=${itemIdSql}
      AND (
        di.quantity<=0 OR di.cancelled_quantity<>di.quantity
        OR di.movement_id IS NULL
        OR NOT EXISTS(SELECT 1 FROM order_dispatch_corrections dc
           WHERE dc.dispatch_item_id=di.id AND dc.quantity=di.quantity
             AND dc.stock_restored=1)
        OR NOT EXISTS(SELECT 1 FROM inventory_movements m
           WHERE m.id=di.movement_id AND m.movement_type='sale'
             AND m.reference_type='order_dispatch'
             AND m.inventory_source=di.source_type AND m.variant_id=di.variant_id)
        OR NOT EXISTS(SELECT 1 FROM order_items oi
           WHERE oi.id=di.order_item_id AND oi.order_id=d.order_id)
      ))`
}

// An old shipping attempt may be fully reversed and followed by a valid
// new issue of the same line. The cancelled issue is harmless only if its
// entire physical stock was restored and the matching correction is journaled.
// A partial or unproven correction still forbids a new Return V2.
export function noUnsafeCancelledDispatchSql(itemIdSql:string):string {
  return `NOT EXISTS(SELECT 1 FROM order_dispatch_items di
     WHERE di.order_item_id=${itemIdSql} AND di.cancelled_quantity>0
       AND (
         di.quantity<=0 OR di.cancelled_quantity<>di.quantity
         OR di.movement_id IS NULL
         OR NOT EXISTS(SELECT 1 FROM order_dispatch_corrections dc
           WHERE dc.dispatch_item_id=di.id AND dc.quantity=di.quantity
             AND dc.stock_restored=1)
         OR NOT EXISTS(SELECT 1 FROM inventory_movements m
           WHERE m.id=di.movement_id AND m.movement_type='sale'
             AND m.reference_type='order_dispatch'
             AND m.inventory_source=di.source_type
             AND m.variant_id=di.variant_id)
       ))`
}
