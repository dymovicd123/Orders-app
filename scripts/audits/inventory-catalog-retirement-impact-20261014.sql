-- READ ONLY. Enumerate any actual stock removals attributed to Catalog deletion since Oct 1.
-- These movements were produced by the current catalog-retirement code path.
-- No database mutations. This does NOT determine physical reality.
SELECT
  m.reference_id AS catalog_retirement_reference,
  MIN(m.created_at) AS first_recorded_at_utc,
  MAX(m.created_at) AS last_recorded_at_utc,
  COUNT(*) AS affected_stock_positions,
  COUNT(DISTINCT m.variant_id) AS affected_skus,
  SUM(CASE WHEN m.quantity_delta < 0 THEN -m.quantity_delta ELSE 0 END)
    AS units_removed_from_accounting,
  GROUP_CONCAT(DISTINCT m.product_name_snapshot) AS affected_product_names,
  SUM(CASE WHEN m.inventory_source='warehouse' AND m.quantity_delta<0
    THEN -m.quantity_delta ELSE 0 END) AS warehouse_units_removed,
  SUM(CASE WHEN m.inventory_source='boutique' AND m.quantity_delta<0
    THEN -m.quantity_delta ELSE 0 END) AS boutique_units_removed
FROM inventory_movements m
WHERE m.reference_type='catalog_retirement'
  AND m.created_at>='2026-10-01T00:00:00'
GROUP BY m.reference_id
ORDER BY last_recorded_at_utc DESC
LIMIT 100;
