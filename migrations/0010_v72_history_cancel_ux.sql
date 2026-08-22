PRAGMA foreign_keys = ON;

-- Step 08: history/cancel support for returns and exchanges.
ALTER TABLE returns ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled'));
ALTER TABLE returns ADD COLUMN cancelled_at TEXT;
ALTER TABLE returns ADD COLUMN cancellation_comment TEXT;

ALTER TABLE exchanges ADD COLUMN cancelled_at TEXT;
ALTER TABLE exchanges ADD COLUMN cancellation_comment TEXT;

CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status, return_date);
CREATE INDEX IF NOT EXISTS idx_exchanges_status ON exchanges(status, exchange_date);
