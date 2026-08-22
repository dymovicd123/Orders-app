PRAGMA foreign_keys = ON;

-- Step 05: workshop completion polish.
-- Keeps the simple workshop model: active / invoice / done.
-- Comments are visible production notes only; they never set urgency.

CREATE INDEX IF NOT EXISTS idx_workshop_tasks_status_updated
  ON workshop_tasks(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_workshop_tasks_external_order_status
  ON workshop_tasks(external_order_id, status);

SELECT 'v72 step 05 workshop complete' AS migration_marker;
