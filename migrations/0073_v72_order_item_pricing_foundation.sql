PRAGMA foreign_keys = ON;

-- Stage03-F1 pricing compatibility foundation.
-- Existing orders are explicitly classified as legacy/manual without recalculating money.
ALTER TABLE orders
  ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'legacy_manual_total'
  CHECK (pricing_mode IN ('legacy_manual_total', 'itemized_v1'));

-- Historical rows intentionally remain NULL. Never backfill this from today's Catalog.
ALTER TABLE order_items
  ADD COLUMN catalog_price_snapshot INTEGER
  CHECK (catalog_price_snapshot IS NULL OR catalog_price_snapshot >= 0);

SELECT 'stage03-f1 pricing compatibility schema ready' AS migration_marker;
