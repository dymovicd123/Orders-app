-- R5.6 — measured Finance / Orders Summary D1 read-budget indexes.
-- Additive only: no business-row mutation and no truth-model change.
-- Runtime predicate rewrites paired with this migration were benchmarked as truth-equivalent
-- against a read-only Production snapshot before this migration was prepared.

-- /api/reports/orders-summary: payment-date range + order validation + SUM(amount).
CREATE INDEX IF NOT EXISTS idx_payments_payment_date_order_amount
  ON payments(payment_date, order_id, amount);

-- Global current-debt card. The exact partial predicate matches the runtime query.
CREATE INDEX IF NOT EXISTS idx_orders_current_debt_partial
  ON orders(debt_amount)
  WHERE debt_amount > 0 AND order_status <> 'deleted';

-- Routine pending-writeoff counter. Only non-workshop positive-quantity rows are candidates.
CREATE INDEX IF NOT EXISTS idx_order_items_pending_writeoff_status_order
  ON order_items(stock_writeoff_status, order_id)
  WHERE is_workshop = 0 AND quantity > 0;

-- Orders period summary: preserve every workshop quantity, including historical edge values.
-- Only replace COALESCE(is_workshop, 0) = 1 with logically identical is_workshop = 1.
CREATE INDEX IF NOT EXISTS idx_order_items_workshop_order_quantity
  ON order_items(order_id, quantity)
  WHERE is_workshop = 1;

PRAGMA optimize;
