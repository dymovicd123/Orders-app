-- Client3 only. Separate real cash registers for each watch brand.
-- Main cash tables are global and MUST NOT be reused across two brands.
CREATE TABLE IF NOT EXISTS watch_brand_cash_registers (
 brand_id INTEGER PRIMARY KEY REFERENCES watch_brands(id),
 opening_amount INTEGER NOT NULL CHECK(opening_amount>=0),
 financial_event_watermark INTEGER NOT NULL DEFAULT 0,
 initialized_at TEXT NOT NULL,
 initialized_by INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watch_brand_cash_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
 request_id TEXT NOT NULL,
 entry_type TEXT NOT NULL CHECK(entry_type IN ('manual_in','manual_out','reconcile_in','reconcile_out')),
 amount_delta INTEGER NOT NULL CHECK(amount_delta<>0),
 business_date TEXT NOT NULL,
 comment TEXT NOT NULL,
 actor_user_id INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(brand_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_brand_cash_history
 ON watch_brand_cash_entries(brand_id,id DESC);
