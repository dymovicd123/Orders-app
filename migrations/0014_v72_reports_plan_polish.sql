PRAGMA foreign_keys = ON;

-- Step 12: polishing reports and plan module.
-- No destructive schema changes. Bonus/salary columns already exist in plans from the base schema.
CREATE INDEX IF NOT EXISTS idx_plans_manager_period ON plans(manager_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_type ON activity_log(created_at, event_type);
