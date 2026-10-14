-- Read-only incident evidence. Times are UTC; screenshot 2026-10-14 17:37 (UTC+05) => 12:37Z.
-- Do NOT change production D1. Paste only SELECT statements into Cloudflare D1 Console.
-- PART 1: ALL boutique arrivals near the reported time, resolving each movement's exact SKU to current catalog and stock.
WITH stock AS (
 SELECT variant_id,inventory_source,COUNT(*) AS stock_rows,
 SUM(quantity) AS physical,SUM(reserved_quantity) AS reserved,
 MAX(updated_at) AS stock_updated_at
 FROM inventory_stock GROUP BY variant_id,inventory_source
)
SELECT m.id AS movement_id,m.created_at AS movement_utc,
 m.reference_type,m.reference_id,
 m.product_id AS movement_product_id,m.variant_id AS movement_sku,
 m.product_name_snapshot AS movement_name,m.color_snapshot AS movement_color,
 m.size_snapshot AS movement_size,m.material_snapshot AS movement_material,
 m.length_snapshot AS movement_length,m.gender_snapshot AS movement_gender,
 m.quantity_delta,m.quantity_after,
 p.id AS current_catalog_product_id,p.name AS current_catalog_name,
 p.is_active AS product_active,v.is_active AS variant_active,
 v.color AS current_color,v.size_label AS current_size,
 v.material AS current_material,v.length AS current_length,
 v.stock_position_id AS current_execution,
 COALESCE(s.stock_rows,0) AS matching_stock_rows,
 s.physical AS current_boutique_physical,s.reserved AS current_boutique_reserved,
 s.stock_updated_at,
 (SELECT COUNT(*) FROM inventory_movements later
  WHERE later.inventory_source=m.inventory_source AND later.variant_id=m.variant_id AND later.id>m.id)
  AS later_movements_same_sku,
 (SELECT later.created_at || ' / ' || later.movement_type || ' / ' ||
     later.quantity_delta || ' / after ' || later.quantity_after
  FROM inventory_movements later
  WHERE later.inventory_source=m.inventory_source AND later.variant_id=m.variant_id AND later.id>m.id
  ORDER BY later.id DESC LIMIT 1) AS latest_later_movement,
 (SELECT COUNT(*) FROM inventory_movement_reversals r WHERE r.original_movement_id=m.id)
  AS reversal_records
FROM inventory_movements m
LEFT JOIN catalog_variants v ON v.id=m.variant_id
LEFT JOIN catalog_products p ON p.id=v.product_id
LEFT JOIN stock s ON s.variant_id=m.variant_id AND s.inventory_source=m.inventory_source
WHERE m.inventory_source='boutique' AND m.movement_type='arrival'
 AND m.created_at >= '2026-10-14T12:25:00'
 AND m.created_at < '2026-10-14T13:00:00'
ORDER BY m.created_at DESC,m.id DESC;
