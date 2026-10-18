CREATE TABLE IF NOT EXISTS retired_order_item_corrections (
 order_item_id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL,
 old_variant_id INTEGER NOT NULL, new_variant_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL, old_price INTEGER NOT NULL, new_price INTEGER NOT NULL,
 old_total INTEGER NOT NULL, new_total INTEGER NOT NULL, previous_snapshot TEXT NOT NULL,
 next_snapshot TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending','completed'))
);
CREATE INDEX IF NOT EXISTS idx_retired_item_correction_order
 ON retired_order_item_corrections(order_id,recorded_at);