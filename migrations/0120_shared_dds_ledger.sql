-- Separate single shared DDS funds journal. No connections to office cash, orders or payroll.
CREATE TABLE IF NOT EXISTS dds_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('funding','expense','reversal_funding','reversal_expense')),
  amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 1000000000),
  business_date TEXT NOT NULL CHECK(length(business_date) = 10),
  category TEXT NOT NULL DEFAULT '',
  article TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  reverses_entry_id INTEGER REFERENCES dds_entries(id),
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dds_reverse_once ON dds_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dds_month ON dds_entries(business_date DESC,id DESC);

-- A serialized SQLite write is authoritative, including concurrent managers/tabs.
-- A withdrawal or reversal of a funding entry must not overdraw the shared balance.
CREATE TRIGGER IF NOT EXISTS dds_prevent_overdraft
BEFORE INSERT ON dds_entries
WHEN NEW.kind IN ('expense','reversal_funding')
AND COALESCE((
  SELECT SUM(CASE kind
    WHEN 'funding' THEN amount WHEN 'reversal_expense' THEN amount
    WHEN 'expense' THEN -amount WHEN 'reversal_funding' THEN -amount
  END) FROM dds_entries
),0) < NEW.amount
BEGIN
  SELECT RAISE(ABORT, 'DDS_INSUFFICIENT_FUNDS');
END;
