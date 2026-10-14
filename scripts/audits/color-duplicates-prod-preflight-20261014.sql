-- READ ONLY. Diagnostic candidates for the current orders_db_prod; does not authorize merges.
-- No UPDATE, DELETE, INSERT, ALTER, DROP, or stock changes.
WITH bad_variants AS (
 SELECT v.id AS sku,v.product_id,p.name AS product_name,v.stock_position_id,
 v.category,v.gender,v.size_label,v.material,v.length,v.is_active,v.color AS old_color,
 CASE UPPER(TRIM(v.color))
  WHEN 'СВЕТЛО СЕРЫЙ' THEN 'СВЕТЛО-СЕРЫЙ'
  WHEN 'ТЕМНО СИНИЙ' THEN 'ТЕМНО-СИНИЙ' END AS preferred_color
 FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id
 WHERE UPPER(TRIM(v.color)) IN ('СВЕТЛО СЕРЫЙ','ТЕМНО СИНИЙ')
), stock AS (
 SELECT variant_id,
 SUM(CASE WHEN inventory_source='warehouse' THEN quantity ELSE 0 END) AS warehouse,
 SUM(CASE WHEN inventory_source='boutique' THEN quantity ELSE 0 END) AS boutique,
 SUM(COALESCE(reserved_quantity,0)) AS reserved
 FROM inventory_stock GROUP BY variant_id
), active_res AS (
 SELECT variant_id,COUNT(*) AS active_reservation_rows,SUM(quantity) AS active_reserved_quantity
 FROM inventory_reservations WHERE status='active' GROUP BY variant_id
), open_orders AS (
 SELECT oi.variant_id,COUNT(*) AS open_order_lines FROM order_items oi
 JOIN orders o ON o.id=oi.order_id
 WHERE o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent'
 GROUP BY oi.variant_id
), report AS (
 SELECT v.*,COALESCE(s.warehouse,0) AS warehouse,COALESCE(s.boutique,0) AS boutique,
 COALESCE(s.reserved,0) AS reserved,
 COALESCE(r.active_reservation_rows,0) AS active_reservation_rows,
 COALESCE(r.active_reserved_quantity,0) AS active_reserved_quantity,
 COALESCE(o.open_order_lines,0) AS open_order_lines,
 (SELECT COUNT(*) FROM catalog_variants k WHERE k.id<>v.sku
  AND k.product_id=v.product_id AND k.stock_position_id IS v.stock_position_id
  AND COALESCE(k.category,'adult')=COALESCE(v.category,'adult')
  AND COALESCE(k.gender,'')=COALESCE(v.gender,'')
  AND COALESCE(k.size_label,'')=COALESCE(v.size_label,'')
  AND COALESCE(k.material,'')=COALESCE(v.material,'')
  AND COALESCE(k.length,'')=COALESCE(v.length,'')
  AND UPPER(TRIM(k.color))=v.preferred_color) AS candidate_count,
 (SELECT GROUP_CONCAT(k.id || ':' || CASE WHEN k.is_active=1 THEN 'active' ELSE 'inactive' END, ',')
  FROM catalog_variants k WHERE k.id<>v.sku
  AND k.product_id=v.product_id AND k.stock_position_id IS v.stock_position_id
  AND COALESCE(k.category,'adult')=COALESCE(v.category,'adult')
  AND COALESCE(k.gender,'')=COALESCE(v.gender,'')
  AND COALESCE(k.size_label,'')=COALESCE(v.size_label,'')
  AND COALESCE(k.material,'')=COALESCE(v.material,'')
  AND COALESCE(k.length,'')=COALESCE(v.length,'')
  AND UPPER(TRIM(k.color))=v.preferred_color) AS candidate_ids,
 (SELECT m.created_at FROM inventory_movements m WHERE m.variant_id=v.sku
  ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_movement_at,
 (SELECT c.checked_at FROM inventory_stock_checks c WHERE c.variant_id=v.sku
  ORDER BY c.checked_at DESC,c.id DESC LIMIT 1) AS last_check_at
 FROM bad_variants v LEFT JOIN stock s ON s.variant_id=v.sku
 LEFT JOIN active_res r ON r.variant_id=v.sku
 LEFT JOIN open_orders o ON o.variant_id=v.sku
)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS queried_at_utc,
 product_id,product_name,sku,old_color,preferred_color,stock_position_id,
 category,gender,size_label,material,length,is_active,warehouse,boutique,reserved,
 active_reservation_rows,active_reserved_quantity,open_order_lines,
 candidate_count,candidate_ids,last_movement_at,last_check_at,
 CASE
 WHEN candidate_count>0 THEN 'REVIEW_COLLISION_DO_NOT_MERGE'
 WHEN active_reservation_rows>0 OR open_order_lines>0 THEN 'REVIEW_ORDER_LINKS_KEEP_SKU'
 ELSE 'RENAME_ONLY_CANDIDATE_KEEP_SKU_REVALIDATE'
 END AS preliminary_classification
FROM report
ORDER BY CASE WHEN candidate_count>0 THEN 0
 WHEN active_reservation_rows>0 OR open_order_lines>0 THEN 1 ELSE 2 END,
 product_name,stock_position_id,size_label,sku;
