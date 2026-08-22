PRAGMA foreign_keys = ON;

-- Step 04: dedicated workshop dashboard support.
-- Comments are intentionally separate from urgency. A comment never makes a task urgent.
-- Note: order_items.workshop_urgent and order_items.workshop_due_date are added idempotently
-- by Worker startup safety code, because SQLite/D1 has no safe ADD COLUMN IF NOT EXISTS here.

CREATE INDEX IF NOT EXISTS idx_workshop_tasks_active_urgent_due
  ON workshop_tasks(status, urgent, due_date, created_at);

CREATE INDEX IF NOT EXISTS idx_workshop_tasks_order_status
  ON workshop_tasks(order_id, status);

CREATE INDEX IF NOT EXISTS idx_orders_order_date_workshop
  ON orders(order_date, workshop_status, order_status);

SELECT 'v72 step 04 workshop dashboard' AS migration_marker;
