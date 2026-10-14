-- READ ONLY heuristic across the entire inventory. Flags are INVESTIGATION LEADS, not proof of missing goods.
-- Last movement.quantity_after is a historical post-operation count; later stock changes may be legal.
WITH latest AS (
 SELECT m.id AS movement_id,m.inventory_source,m.variant_id,m.product_id AS movement_product_id,
 m.movement_type,m.reference_type,m.reference_id,m.quantity_after,m.created_at,
 ROW_NUMBER() OVER (PARTITION BY m.inventory_source,m.variant_id ORDER BY m.id DESC) AS rn
 FROM inventory_movements m WHERE m.variant_id IS NOT NULL
), stock AS (
 SELECT inventory_source,variant_id,COUNT(*) AS stock_rows,SUM(quantity) AS physical,
 SUM(reserved_quantity) AS reserved,MAX(updated_at) AS stock_updated_at,
 MAX(last_action) AS last_action,MAX(last_source_ref) AS last_source_ref
 FROM inventory_stock WHERE variant_id IS NOT NULL GROUP BY inventory_source,variant_id
)
SELECT last.inventory_source,last.variant_id,
 p.name AS current_product,p.is_active AS product_active,v.is_active AS variant_active,
 v.color,v.size_label,
 last.movement_id,last.created_at AS movement_utc,last.movement_type,
 last.reference_type,last.reference_id,
 last.quantity_after AS historical_after_last_movement,
 COALESCE(s.stock_rows,0) AS stock_rows,
 s.physical AS current_physical,s.reserved AS current_reserved,s.stock_updated_at,
 s.last_action,s.last_source_ref,
 CASE
  WHEN v.id IS NULL THEN 'MISSING_CATALOG_SKU'
  WHEN p.id IS NULL THEN 'MISSING_CATALOG_PRODUCT'
  WHEN COALESCE(s.stock_rows,0)=0 THEN 'MOVEMENT_WITH_NO_STOCK_ROW'
  WHEN s.stock_rows>1 THEN 'DUPLICATE_STOCK_ROWS'
  WHEN (v.is_active<>1 OR p.is_active<>1) AND (s.physical<>0 OR s.reserved<>0) THEN 'INACTIVE_WITH_QUANTITY'
  WHEN last.quantity_after<>s.physical THEN 'LAST_MOVEMENT_DISAGREES_WITH_CURRENT_STOCK'
  ELSE 'OK'
 END AS audit_flag
FROM latest last
LEFT JOIN stock s ON s.inventory_source=last.inventory_source AND s.variant_id=last.variant_id
LEFT JOIN catalog_variants v ON v.id=last.variant_id
LEFT JOIN catalog_products p ON p.id=v.product_id
WHERE last.rn=1 AND (
 v.id IS NULL OR p.id IS NULL OR s.stock_rows IS NULL OR s.stock_rows>1
 OR ((v.is_active<>1 OR p.is_active<>1) AND (s.physical<>0 OR s.reserved<>0))
 OR last.quantity_after<>s.physical
)
ORDER BY
 CASE WHEN v.id IS NULL OR p.id IS NULL OR s.stock_rows IS NULL OR s.stock_rows>1 THEN 0
  WHEN (v.is_active<>1 OR p.is_active<>1) AND (s.physical<>0 OR s.reserved<>0) THEN 1
  ELSE 2 END,
 last.created_at DESC
LIMIT 300;
