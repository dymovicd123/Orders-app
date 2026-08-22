PRAGMA foreign_keys = ON;

-- Step 07: exchange money movement + simpler workshop invoice table.
-- Adds explicit financial action for exchanges:
-- none / extra_payment / refund.
ALTER TABLE exchanges ADD COLUMN financial_action TEXT NOT NULL DEFAULT 'none' CHECK (financial_action IN ('none', 'extra_payment', 'refund'));
ALTER TABLE exchanges ADD COLUMN financial_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exchanges ADD COLUMN payment_method TEXT;
ALTER TABLE exchanges ADD COLUMN payment_id INTEGER;
ALTER TABLE exchanges ADD COLUMN refund_return_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_exchanges_financial_action ON exchanges(financial_action, exchange_date);
