-- Branch2 0068 drift guard. SELECT-only. The full semantic preflight is preserved in run 35116318061.
-- This rechecks that the live Branch2 catalog still has the exact audited shape immediately before mutation.
SELECT 'female' AS intended_scope, 30 AS products
WHERE (SELECT COUNT(*) FROM catalog_products)=50 AND (SELECT COUNT(*) FROM catalog_variants)=613
UNION ALL SELECT 'male',7 WHERE (SELECT COUNT(*) FROM catalog_products)=50 AND (SELECT COUNT(*) FROM catalog_variants)=613
UNION ALL SELECT 'unisex',13 WHERE (SELECT COUNT(*) FROM catalog_products)=50 AND (SELECT COUNT(*) FROM catalog_variants)=613;

SELECT
  v.id AS old_id,
  v.id AS keeper_id,
  v.product_id,
  p.name AS product_name,
  'female' AS intended_scope,
  'ЖЕН' AS target_gender,
  'in_place' AS repair_mode,
  (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id=v.id) AS stock_rows,
  (SELECT COALESCE(SUM(s.quantity),0) FROM inventory_stock s WHERE s.variant_id=v.id) AS stock_qty,
  (SELECT COALESCE(SUM(s.reserved_quantity),0) FROM inventory_stock s WHERE s.variant_id=v.id) AS reserved_qty,
  (SELECT COUNT(*) FROM order_items x WHERE x.variant_id=v.id) AS order_items_refs,
  (SELECT COUNT(*) FROM workshop_tasks x WHERE x.variant_id=v.id) AS workshop_refs,
  (SELECT COUNT(*) FROM inventory_reservations x WHERE x.variant_id=v.id) AS reservation_refs,
  (SELECT COUNT(*) FROM catalog_input_aliases x WHERE x.variant_id=v.id) AS input_alias_refs,
  (SELECT COUNT(*) FROM inventory_lifecycle_events x WHERE x.variant_id=v.id) AS lifecycle_refs,
  (SELECT COUNT(*) FROM inventory_transfer_items x WHERE x.variant_id=v.id) AS transfer_refs,
  (SELECT COUNT(*) FROM inventory_stock_checks x WHERE x.variant_id=v.id) AS stock_check_refs,
  (SELECT COUNT(*) FROM inventory_stocktake_items x WHERE x.variant_id=v.id) AS stocktake_refs
FROM catalog_variants v
JOIN catalog_products p ON p.id=v.product_id
WHERE v.id IN (184,157,428,398,285,340)
  AND v.is_active=1
  AND TRIM(COALESCE(v.gender,''))=''
  AND (
    (v.id=184 AND v.product_id=4  AND p.name='АЙДАР ШАПАН') OR
    (v.id=157 AND v.product_id=6  AND p.name='ТҰМАР ЖИЛЕТ') OR
    (v.id=428 AND v.product_id=9  AND p.name='ҚОРЛАН ЖИЛЕТ') OR
    (v.id=398 AND v.product_id=11 AND p.name='БИКЕШ КӨЙЛЕК') OR
    (v.id=285 AND v.product_id=19 AND p.name='ОРАМАЛ АТЛАС') OR
    (v.id=340 AND v.product_id=20 AND p.name='ОРАМАЛ ҚҰДАҒИ')
  )
ORDER BY v.id;

SELECT 2 AS retire_unused_unisex_blank_candidates
WHERE (SELECT COUNT(*) FROM catalog_products)=50
  AND (SELECT COUNT(*) FROM catalog_variants)=613
  AND (SELECT COUNT(*) FROM catalog_variants WHERE id IN (184,157,428,398,285,340) AND is_active=1 AND TRIM(COALESCE(gender,''))='')=6;
