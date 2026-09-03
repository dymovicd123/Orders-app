-- R5.5 — Workshop variant fallback read budget.
-- Additive index only: align the catalog-variant lookup with the existing resolver order
--   product_id = ?
--   ORDER BY is_active DESC, sort_order ASC, id ASC
-- SQLite can use the rowid/id tie-break after these three indexed terms, so the measured
-- four-column candidate brought no additional planner or VM-step benefit.
--
-- This migration must not change catalog data, order data, workshop tasks, stock,
-- reservations, returns, lifecycle state, or any user-visible business rule.

CREATE INDEX IF NOT EXISTS idx_catalog_variants_product_active_desc_sort
  ON catalog_variants(product_id, is_active DESC, sort_order ASC);
