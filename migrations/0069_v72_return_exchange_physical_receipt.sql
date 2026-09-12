PRAGMA foreign_keys = ON;

-- Track whether the returned physical item has actually reached us.
-- Legacy rows stay physical_tracking = 0 because the old workflow did not
-- distinguish "not received yet" from "received but not restocked".
ALTER TABLE return_items ADD COLUMN physical_tracking INTEGER NOT NULL DEFAULT 0 CHECK (physical_tracking IN (0, 1));
ALTER TABLE return_items ADD COLUMN physical_received_at TEXT;

-- Exchange old-item rows use the same physical receipt model.
-- Only role='old' will be marked physical_tracking = 1 by the application.
ALTER TABLE exchange_items ADD COLUMN physical_tracking INTEGER NOT NULL DEFAULT 0 CHECK (physical_tracking IN (0, 1));
ALTER TABLE exchange_items ADD COLUMN physical_received_at TEXT;

CREATE INDEX IF NOT EXISTS idx_return_items_physical_receipt
  ON return_items(physical_tracking, physical_received_at, return_id);

CREATE INDEX IF NOT EXISTS idx_exchange_items_physical_receipt
  ON exchange_items(role, physical_tracking, physical_received_at, exchange_id);
