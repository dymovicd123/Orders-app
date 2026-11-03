-- Client3 ONLY. One physical cash register across both watch brands.
-- Original per-brand entries/cycles are preserved as a read-only archive.
-- Snapshot the exact combined active balances ONCE, atomically at migration.
CREATE TABLE IF NOT EXISTS watch_shared_cash_register (
 id INTEGER PRIMARY KEY CHECK(id=1),
 opening_amount INTEGER NOT NULL CHECK(opening_amount>=0),
 financial_event_watermark INTEGER NOT NULL,
 initialized_at TEXT NOT NULL,
 initialized_by INTEGER NOT NULL,
 auto_tracking_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_tracking_enabled IN (0,1)),
 paused_event_id INTEGER,
 paused_at TEXT,
 cash_entry_watermark INTEGER NOT NULL DEFAULT 0,
 cycle_started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watch_shared_cash_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL UNIQUE,
 entry_type TEXT NOT NULL CHECK(entry_type IN ('manual_in','manual_out','reconcile_in','reconcile_out','manual_reversal')),
 amount_delta INTEGER NOT NULL CHECK(amount_delta<>0),
 business_date TEXT NOT NULL,
 comment TEXT NOT NULL,
 actor_user_id INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 reverses_entry_id INTEGER REFERENCES watch_shared_cash_entries(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_watch_shared_cash_reversal
 ON watch_shared_cash_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS watch_shared_cash_skipped_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 first_event_id INTEGER NOT NULL,
 last_event_id INTEGER NOT NULL,
 started_at TEXT NOT NULL,
 ended_at TEXT NOT NULL,
 CHECK(first_event_id<=last_event_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_shared_cash_skips
 ON watch_shared_cash_skipped_events(first_event_id,last_event_id);
CREATE TABLE IF NOT EXISTS watch_shared_cash_cycles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 started_at TEXT NOT NULL,
 finished_at TEXT NOT NULL,
 opening_amount INTEGER NOT NULL,
 financial_event_watermark INTEGER NOT NULL,
 cash_entry_watermark INTEGER NOT NULL,
 closing_balance INTEGER NOT NULL,
 recorded_by INTEGER NOT NULL,
 comment TEXT NOT NULL,
 request_id TEXT NOT NULL UNIQUE
);

-- Carry forward brand 1 + brand 2 as a single starting snapshot.
-- Only initialized registers contribute; old ledger remains immutable.
-- Financial events behind each old watermark/cycle or while auto was paused
-- never count twice, and old skipped intervals remain excluded.
INSERT OR IGNORE INTO watch_shared_cash_register (
 id,opening_amount,financial_event_watermark,initialized_at,initialized_by,
 auto_tracking_enabled,paused_event_id,paused_at,cash_entry_watermark,cycle_started_at
)
SELECT 1,
 SUM(c.opening_amount
   + (SELECT COALESCE(SUM(e.amount_delta),0)
      FROM watch_brand_cash_entries e
      WHERE e.brand_id=c.brand_id AND e.id>c.cash_entry_watermark)
   + (SELECT COALESCE(SUM(f.amount_delta),0)
      FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
      WHERE wd.brand_id=c.brand_id AND f.id>c.financial_event_watermark
        AND (c.auto_tracking_enabled=1 OR f.id<=COALESCE(c.paused_event_id,0))
        AND NOT EXISTS (SELECT 1 FROM watch_brand_cash_skipped_events sk
          WHERE sk.brand_id=c.brand_id AND f.id BETWEEN sk.first_event_id AND sk.last_event_id)
        AND UPPER(TRIM(f.payment_method)) IN ('НАЛИЧНЫЕ','CASH','CASH KZT'))),
 (SELECT COALESCE(MAX(id),0) FROM financial_events),datetime('now'),
 MIN(c.initialized_by),
 MIN(c.auto_tracking_enabled),
 CASE WHEN MIN(c.auto_tracking_enabled)=0
   THEN (SELECT COALESCE(MAX(id),0) FROM financial_events) ELSE NULL END,
 CASE WHEN MIN(c.auto_tracking_enabled)=0 THEN datetime('now') ELSE NULL END,
 0,datetime('now')
FROM watch_brand_cash_registers c
HAVING COUNT(*)>0;
