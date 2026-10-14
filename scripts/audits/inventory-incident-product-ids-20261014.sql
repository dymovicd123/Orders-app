-- Read-only: distinguish the two ACTUAL product names on user screenshots.
-- The history says АЙНҰРЫМ-АЙ КӨЙЛЕК; the catalog/stock screenshots show АЙ-НӘЗІГІМ КӨЙЛЕК.
-- This cannot be diagnosed by comparing names or sizes alone.
WITH stock AS (
 SELECT variant_id,
 SUM(CASE WHEN inventory_source='warehouse' THEN quantity ELSE 0 END) AS warehouse,
 SUM(CASE WHEN inventory_source='boutique' THEN quantity ELSE 0 END) AS boutique,
 SUM(reserved_quantity) AS reserved
 FROM inventory_stock GROUP BY variant_id
)
SELECT p.id AS product_id,p.name AS product_name,p.is_active AS product_active,
 v.id AS sku,v.is_active AS sku_active,v.stock_position_id,
 v.gender,v.color,v.size_label,v.material,v.length,
 COALESCE(s.warehouse,0) AS warehouse,COALESCE(s.boutique,0) AS boutique,
 COALESCE(s.reserved,0) AS reserved
FROM catalog_products p
LEFT JOIN catalog_variants v ON v.product_id=p.id
LEFT JOIN stock s ON s.variant_id=v.id
WHERE p.name LIKE '%НҰРЫМ%'
   OR p.name LIKE '%НӘЗІГІМ%'
ORDER BY p.name,v.color,v.size_label,v.id;
