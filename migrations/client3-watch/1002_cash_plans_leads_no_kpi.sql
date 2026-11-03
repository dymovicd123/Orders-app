-- Client3 ONLY, no Main/Branch2 or existing watch order/stock schema changes.
-- Extend brand-separated cash without rewriting historic cash entries or payments.
ALTER TABLE watch_brand_cash_registers ADD COLUMN auto_tracking_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_tracking_enabled IN (0,1));
ALTER TABLE watch_brand_cash_registers ADD COLUMN paused_event_id INTEGER;
ALTER TABLE watch_brand_cash_registers ADD COLUMN paused_at TEXT;
ALTER TABLE watch_brand_cash_registers ADD COLUMN cash_entry_watermark INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_brand_cash_registers ADD COLUMN cycle_started_at TEXT;
ALTER TABLE watch_brand_cash_entries ADD COLUMN reverses_entry_id INTEGER REFERENCES watch_brand_cash_entries(id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_watch_brand_cash_reversal
 ON watch_brand_cash_entries(brand_id,reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS watch_brand_cash_skipped_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
 first_event_id INTEGER NOT NULL,
 last_event_id INTEGER NOT NULL,
 started_at TEXT NOT NULL,
 ended_at TEXT NOT NULL,
 CHECK(first_event_id<=last_event_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_brand_cash_skipped_events ON watch_brand_cash_skipped_events(brand_id,first_event_id,last_event_id);
CREATE TABLE IF NOT EXISTS watch_brand_cash_cycles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
 started_at TEXT,
 finished_at TEXT NOT NULL,
 opening_amount INTEGER NOT NULL,
 financial_event_watermark INTEGER NOT NULL,
 cash_entry_watermark INTEGER NOT NULL,
 closing_balance INTEGER NOT NULL,
 recorded_by INTEGER NOT NULL,
 comment TEXT NOT NULL,
 request_id TEXT NOT NULL,
 UNIQUE(brand_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_brand_cash_cycles ON watch_brand_cash_cycles(brand_id,id DESC);

-- Main-like department and manager money plans; no KPI module.
CREATE TABLE IF NOT EXISTS watch_brand_department_plans (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL,
 planned_amount INTEGER NOT NULL CHECK(planned_amount>=0),
 comment TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 CHECK(period_start<=period_end),
 UNIQUE(brand_id,period_start,period_end)
);
CREATE TABLE IF NOT EXISTS watch_brand_manager_plans (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
 manager_id INTEGER NOT NULL REFERENCES managers(id),
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL,
 planned_amount INTEGER NOT NULL CHECK(planned_amount>=0),
 salary_base INTEGER NOT NULL DEFAULT 0 CHECK(salary_base>=0),
 bonus_hit_percent REAL NOT NULL DEFAULT 5 CHECK(bonus_hit_percent>=0 AND bonus_hit_percent<=100),
 bonus_miss_percent REAL NOT NULL DEFAULT 3 CHECK(bonus_miss_percent>=0 AND bonus_miss_percent<=100),
 comment TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 CHECK(period_start<=period_end),
 UNIQUE(brand_id,manager_id,period_start,period_end)
);
CREATE INDEX IF NOT EXISTS idx_watch_brand_manager_plans_period ON watch_brand_manager_plans(brand_id,period_start,period_end);

-- Main-like daily Leads and Call Centre, strictly scoped to the watch brand.
CREATE TABLE IF NOT EXISTS watch_brand_lead_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
 lead_date TEXT NOT NULL,
 manager_id INTEGER NOT NULL REFERENCES managers(id),
 accepted_count INTEGER NOT NULL DEFAULT 0 CHECK(accepted_count>=0),
 bad_count INTEGER NOT NULL DEFAULT 0 CHECK(bad_count>=0),
 comment TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(brand_id,lead_date,manager_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_brand_leads_date ON watch_brand_lead_records(brand_id,lead_date,manager_id);
CREATE TABLE IF NOT EXISTS watch_brand_call_centre_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
 record_date TEXT NOT NULL,
 manager_id INTEGER NOT NULL REFERENCES managers(id),
 accepted_leads INTEGER NOT NULL DEFAULT 0 CHECK(accepted_leads>=0),
 calls_made INTEGER NOT NULL DEFAULT 0 CHECK(calls_made>=0),
 calls_accepted INTEGER NOT NULL DEFAULT 0 CHECK(calls_accepted>=0),
 fake_count INTEGER NOT NULL DEFAULT 0 CHECK(fake_count>=0),
 refusal_count INTEGER NOT NULL DEFAULT 0 CHECK(refusal_count>=0),
 potential_count INTEGER NOT NULL DEFAULT 0 CHECK(potential_count>=0),
 comment TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(brand_id,record_date,manager_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_brand_call_date ON watch_brand_call_centre_records(brand_id,record_date,manager_id);
