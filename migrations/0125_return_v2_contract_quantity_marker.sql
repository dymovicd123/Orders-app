-- Return V2 compatibility marker. It is NOT a switch and does not post a Return.
-- Existing rows default to 0: their quantity continues to be deducted by the
-- historical Return capacity queries, with no historical reinterpretation.
-- Future V2 posting will set 1 ONLY when it atomically reduces order_items.quantity.
-- The marker avoids subtracting that same returned quantity a second time.
-- Do not use this column in existing Worker SQL until the migration has been
-- applied to each target D1 and the complete financial/dispatch consumers
-- have passed their release gate.
ALTER TABLE return_items ADD COLUMN contract_quantity_applied INTEGER NOT NULL DEFAULT 0
 CHECK (contract_quantity_applied IN (0,1));

CREATE INDEX IF NOT EXISTS idx_return_items_contract_quantity_applied
 ON return_items(order_item_id, contract_quantity_applied, return_id);
