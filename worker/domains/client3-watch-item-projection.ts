/** Canonical, item-scoped physical lifecycle projection for Client3.
 * Reused by orders, logistics and return validation. Never derive a
 * quantity from an order-wide sent flag or a boolean "shipped" value.
 * Every expression expects the current order_items row to be aliased oi.
 */
export const WATCH_ITEM_SHIPPED_SQL = `COALESCE((
  SELECT SUM(MAX(0, di.quantity-COALESCE(di.cancelled_quantity,0)))
  FROM order_dispatch_items di
  JOIN order_dispatches d ON d.id=di.dispatch_id AND d.order_id=oi.order_id
  WHERE di.order_item_id=oi.id
),0)`

export const WATCH_ITEM_RETURNED_SQL = `COALESCE((
  SELECT SUM(ri.quantity)
  FROM return_items ri JOIN returns r ON r.id=ri.return_id
  WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled'
),0)`

export const WATCH_ITEM_PENDING_RETURN_RECEIPT_SQL = `COALESCE((
  SELECT SUM(ri.quantity)
  FROM return_items ri JOIN returns r ON r.id=ri.return_id
  WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled'
    AND ri.physical_tracking=1 AND ri.physical_received_at IS NULL
),0)`

export const WATCH_ITEM_PENDING_EXCHANGE_RECEIPT_SQL = `COALESCE((
  SELECT SUM(ei.quantity)
  FROM exchange_items ei JOIN exchanges e ON e.id=ei.exchange_id
  WHERE ei.order_item_id=oi.id AND ei.role='old'
    AND COALESCE(e.status,'completed')<>'cancelled'
    AND ei.physical_tracking=1 AND ei.physical_received_at IS NULL
),0)`

// Before the dispatch ledger existed, Main recorded a confirmed physical
// handover as fulfilled. This is not a reservation or an order-wide status.
export const WATCH_ITEM_ISSUED_SQL = `(CASE
  WHEN oi.stock_writeoff_status='fulfilled' THEN oi.quantity
  ELSE MIN(oi.quantity, ${WATCH_ITEM_SHIPPED_SQL})
END)`

// A client cannot physically return more units than were actually issued.
// Monetary-only refunds remain a separate valid operation.
export const WATCH_ITEM_RETURNABLE_SQL =
  `MAX(0, ${WATCH_ITEM_ISSUED_SQL}-${WATCH_ITEM_RETURNED_SQL})`
