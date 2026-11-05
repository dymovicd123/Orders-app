/**
 * A replacement marked "sent" during Exchange is recorded by its applied
 * outbound lifecycle event, not by the later Stage-5 dispatch ledger.
 * Only the exact replacement row + completed Exchange + linked stock movement
 * establish the prior shipment; a fulfilled reservation alone is NOT enough.
 *
 * Use this predicate for read-side status and when closing a mixed dispatch.
 * Never create a second stock issue to fill a missing shipment ledger row.
 */
export const recordedExchangeShipmentSql = (item = 'oi') => `EXISTS (
  SELECT 1
  FROM inventory_lifecycle_events le
  JOIN exchanges e ON e.id=le.operation_id AND e.order_id=le.order_id
  JOIN inventory_movements m ON m.id=le.movement_id
    AND m.movement_type='sale' AND m.reference_type='exchange_new'
  WHERE le.order_id=${item}.order_id AND le.order_item_id=${item}.id
    AND le.operation_type='exchange'
    AND le.event_type='exchange_new_out'
    AND le.direction='out' AND le.status='applied'
    AND le.quantity>=${item}.quantity AND ${item}.quantity>0
    AND COALESCE(e.status,'completed')='completed'
    AND (e.new_order_item_id=${item}.id OR EXISTS (
      SELECT 1 FROM exchange_items ei
      WHERE ei.exchange_id=e.id AND ei.role='new'
        AND ei.order_item_id=${item}.id
        AND ei.quantity>=${item}.quantity
    ))
)`
