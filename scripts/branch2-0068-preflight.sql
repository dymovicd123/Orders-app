-- SELECT-only Branch2 preflight for migration 0068. No writes.
WITH product_scope AS (
  SELECT p.id, p.name,
    CASE
      WHEN UPPER(TRIM(p.name)) IN (
        'БАЯН СҰЛУ ШАПАН','БАЯН СУЛУ ШАПАН','ЕҢЛІК ШАПАН','ЕНЛІК ШАПАН','СӘУКЕЛЕ ШАПАН','САУКЕЛЕ ШАПАН','АЙДАР ШАПАН',
        'БАЯН СҰЛУ ЖИЛЕТ','БАЯН СУЛУ ЖИЛЕТ','ТҰМАР ЖИЛЕТ','ТУМАР ЖИЛЕТ','АЙДАЙ ЖИЛЕТ','ЗЕЙНЕ ЖИЛЕТ','ҚОРЛАН ЖИЛЕТ','КОРЛАН ЖИЛЕТ',
        'АЙНҰРЫМ-АЙ КӨЙЛЕК','АЙНУРЫМ-АЙ КОЙЛЕК','БИКЕШ КӨЙЛЕК','БИКЕШ КОЙЛЕК','КЕРБЕЗ КӨЙЛЕК','КЕРБЕЗ КОЙЛЕК','АРУ КӨЙЛЕК','АРУ КОЙЛЕК',
        'НӘЗІК КӨЙЛЕК','НАЗІК КОЙЛЕК','НӘЗІК КОРСЕТ','НАЗІК КОРСЕТ','АҚ НӘЗІК КОРСЕТ','АК НАЗІК КОРСЕТ','КӨРКЕМ КОРСЕТ','КОРКЕМ КОРСЕТ',
        'ТҰМАР КОРСЕТ','ТУМАР КОРСЕТ','НАЗ КОРСЕТ','ВОРОТНИК','ОРАМАЛ АТЛАС','ОРАМАЛ ҚҰДАҒИ','ОРАМАЛ КУДАГИ','ШЕКЕЛІК АЙНҰРЫМ-АЙ','ШЕКЕЛІК АЙНУРЫМ-АЙ','КӨЙЛЕК','КОЙЛЕК'
      ) THEN 'female'
      WHEN UPPER(TRIM(p.name)) IN ('ҚОЗЫ КӨРПЕШ ШАПАН','КОЗЫ КОРПЕШ ШАПАН','КЕБЕК ШАПАН','АЙДАР БОМБЕР','ҚОЗЫ КӨРПЕШ ЖИЛЕТ','КОЗЫ КОРПЕШ ЖИЛЕТ') THEN 'male'
      WHEN UPPER(TRIM(p.name)) IN ('ДАРА ШАПАН','САРДАР ШАПАН','ҚАЗЫНА ШАПАН','КАЗЫНА ШАПАН','АЛАН БОМБЕР','СӘУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ','БАЙСАЛ ЖИЛЕТ','БАСҚА','БАСКА') THEN 'unisex'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'female'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'male'
      ELSE 'unisex'
    END AS intended_scope
  FROM catalog_products p
)
SELECT intended_scope, COUNT(*) AS products
FROM product_scope
GROUP BY intended_scope
ORDER BY intended_scope;

WITH product_scope AS (
  SELECT p.id, p.name,
    CASE
      WHEN UPPER(TRIM(p.name)) IN (
        'БАЯН СҰЛУ ШАПАН','БАЯН СУЛУ ШАПАН','ЕҢЛІК ШАПАН','ЕНЛІК ШАПАН','СӘУКЕЛЕ ШАПАН','САУКЕЛЕ ШАПАН','АЙДАР ШАПАН',
        'БАЯН СҰЛУ ЖИЛЕТ','БАЯН СУЛУ ЖИЛЕТ','ТҰМАР ЖИЛЕТ','ТУМАР ЖИЛЕТ','АЙДАЙ ЖИЛЕТ','ЗЕЙНЕ ЖИЛЕТ','ҚОРЛАН ЖИЛЕТ','КОРЛАН ЖИЛЕТ',
        'АЙНҰРЫМ-АЙ КӨЙЛЕК','АЙНУРЫМ-АЙ КОЙЛЕК','БИКЕШ КӨЙЛЕК','БИКЕШ КОЙЛЕК','КЕРБЕЗ КӨЙЛЕК','КЕРБЕЗ КОЙЛЕК','АРУ КӨЙЛЕК','АРУ КОЙЛЕК',
        'НӘЗІК КӨЙЛЕК','НАЗІК КОЙЛЕК','НӘЗІК КОРСЕТ','НАЗІК КОРСЕТ','АҚ НӘЗІК КОРСЕТ','АК НАЗІК КОРСЕТ','КӨРКЕМ КОРСЕТ','КОРКЕМ КОРСЕТ',
        'ТҰМАР КОРСЕТ','ТУМАР КОРСЕТ','НАЗ КОРСЕТ','ВОРОТНИК','ОРАМАЛ АТЛАС','ОРАМАЛ ҚҰДАҒИ','ОРАМАЛ КУДАГИ','ШЕКЕЛІК АЙНҰРЫМ-АЙ','ШЕКЕЛІК АЙНУРЫМ-АЙ','КӨЙЛЕК','КОЙЛЕК'
      ) THEN 'female'
      WHEN UPPER(TRIM(p.name)) IN ('ҚОЗЫ КӨРПЕШ ШАПАН','КОЗЫ КОРПЕШ ШАПАН','КЕБЕК ШАПАН','АЙДАР БОМБЕР','ҚОЗЫ КӨРПЕШ ЖИЛЕТ','КОЗЫ КОРПЕШ ЖИЛЕТ') THEN 'male'
      WHEN UPPER(TRIM(p.name)) IN ('ДАРА ШАПАН','САРДАР ШАПАН','ҚАЗЫНА ШАПАН','КАЗЫНА ШАПАН','АЛАН БОМБЕР','СӘУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ','БАЙСАЛ ЖИЛЕТ','БАСҚА','БАСКА') THEN 'unisex'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'female'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'male'
      ELSE 'unisex'
    END AS intended_scope
  FROM catalog_products p
), gender_map AS (
  SELECT v.id AS old_id, v.product_id, ps.name AS product_name, ps.intended_scope,
    CASE ps.intended_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END AS target_gender,
    COALESCE(
      (SELECT MIN(target.id) FROM catalog_variants target
       WHERE target.product_id=v.product_id
         AND COALESCE(target.stock_position_id,-1)=COALESCE(v.stock_position_id,-1)
         AND COALESCE(target.category,'adult')=COALESCE(v.category,'adult')
         AND UPPER(TRIM(COALESCE(target.color,'')))=UPPER(TRIM(COALESCE(v.color,'')))
         AND TRIM(COALESCE(target.size_label,''))=TRIM(COALESCE(v.size_label,''))
         AND target.is_active=1
         AND UPPER(TRIM(COALESCE(target.gender,'')))=CASE ps.intended_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END),
      (SELECT MIN(target.id) FROM catalog_variants target
       WHERE target.product_id=v.product_id
         AND COALESCE(target.stock_position_id,-1)=COALESCE(v.stock_position_id,-1)
         AND COALESCE(target.category,'adult')=COALESCE(v.category,'adult')
         AND UPPER(TRIM(COALESCE(target.color,'')))=UPPER(TRIM(COALESCE(v.color,'')))
         AND TRIM(COALESCE(target.size_label,''))=TRIM(COALESCE(v.size_label,''))
         AND target.is_active=1
         AND TRIM(COALESCE(target.gender,''))=''),
      v.id
    ) AS keeper_id
  FROM catalog_variants v
  JOIN product_scope ps ON ps.id=v.product_id
  WHERE v.is_active=1 AND ps.intended_scope IN ('female','male') AND TRIM(COALESCE(v.gender,''))=''
)
SELECT
  old_id, keeper_id, product_id, product_name, intended_scope, target_gender,
  CASE WHEN old_id=keeper_id THEN 'in_place' ELSE 'merge' END AS repair_mode,
  (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id IN (gender_map.old_id, gender_map.keeper_id)) AS stock_rows,
  (SELECT COALESCE(SUM(s.quantity),0) FROM inventory_stock s WHERE s.variant_id IN (gender_map.old_id, gender_map.keeper_id)) AS stock_qty,
  (SELECT COALESCE(SUM(s.reserved_quantity),0) FROM inventory_stock s WHERE s.variant_id IN (gender_map.old_id, gender_map.keeper_id)) AS reserved_qty,
  (SELECT COUNT(*) FROM order_items x WHERE x.variant_id=gender_map.old_id) AS order_items_refs,
  (SELECT COUNT(*) FROM workshop_tasks x WHERE x.variant_id=gender_map.old_id) AS workshop_refs,
  (SELECT COUNT(*) FROM inventory_reservations x WHERE x.variant_id=gender_map.old_id) AS reservation_refs,
  (SELECT COUNT(*) FROM catalog_input_aliases x WHERE x.variant_id=gender_map.old_id) AS input_alias_refs,
  (SELECT COUNT(*) FROM inventory_lifecycle_events x WHERE x.variant_id=gender_map.old_id) AS lifecycle_refs,
  (SELECT COUNT(*) FROM inventory_transfer_items x WHERE x.variant_id=gender_map.old_id) AS transfer_refs,
  (SELECT COUNT(*) FROM inventory_stock_checks x WHERE x.variant_id=gender_map.old_id) AS stock_check_refs,
  (SELECT COUNT(*) FROM inventory_stocktake_items x WHERE x.variant_id=gender_map.old_id) AS stocktake_refs
FROM gender_map
ORDER BY product_id, old_id;

WITH product_scope AS (
  SELECT p.id,
    CASE
      WHEN UPPER(TRIM(p.name)) IN (
        'БАЯН СҰЛУ ШАПАН','БАЯН СУЛУ ШАПАН','ЕҢЛІК ШАПАН','ЕНЛІК ШАПАН','СӘУКЕЛЕ ШАПАН','САУКЕЛЕ ШАПАН','АЙДАР ШАПАН',
        'БАЯН СҰЛУ ЖИЛЕТ','БАЯН СУЛУ ЖИЛЕТ','ТҰМАР ЖИЛЕТ','ТУМАР ЖИЛЕТ','АЙДАЙ ЖИЛЕТ','ЗЕЙНЕ ЖИЛЕТ','ҚОРЛАН ЖИЛЕТ','КОРЛАН ЖИЛЕТ',
        'АЙНҰРЫМ-АЙ КӨЙЛЕК','АЙНУРЫМ-АЙ КОЙЛЕК','БИКЕШ КӨЙЛЕК','БИКЕШ КОЙЛЕК','КЕРБЕЗ КӨЙЛЕК','КЕРБЕЗ КОЙЛЕК','АРУ КӨЙЛЕК','АРУ КОЙЛЕК',
        'НӘЗІК КӨЙЛЕК','НАЗІК КОЙЛЕК','НӘЗІК КОРСЕТ','НАЗІК КОРСЕТ','АҚ НӘЗІК КОРСЕТ','АК НАЗІК КОРСЕТ','КӨРКЕМ КОРСЕТ','КОРКЕМ КОРСЕТ',
        'ТҰМАР КОРСЕТ','ТУМАР КОРСЕТ','НАЗ КОРСЕТ','ВОРОТНИК','ОРАМАЛ АТЛАС','ОРАМАЛ ҚҰДАҒИ','ОРАМАЛ КУДАГИ','ШЕКЕЛІК АЙНҰРЫМ-АЙ','ШЕКЕЛІК АЙНУРЫМ-АЙ','КӨЙЛЕК','КОЙЛЕК'
      ) THEN 'female'
      WHEN UPPER(TRIM(p.name)) IN ('ҚОЗЫ КӨРПЕШ ШАПАН','КОЗЫ КОРПЕШ ШАПАН','КЕБЕК ШАПАН','АЙДАР БОМБЕР','ҚОЗЫ КӨРПЕШ ЖИЛЕТ','КОЗЫ КОРПЕШ ЖИЛЕТ') THEN 'male'
      WHEN UPPER(TRIM(p.name)) IN ('ДАРА ШАПАН','САРДАР ШАПАН','ҚАЗЫНА ШАПАН','КАЗЫНА ШАПАН','АЛАН БОМБЕР','СӘУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ','БАЙСАЛ ЖИЛЕТ','БАСҚА','БАСКА') THEN 'unisex'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'female'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'male'
      ELSE 'unisex'
    END AS intended_scope
  FROM catalog_products p
)
SELECT COUNT(*) AS retire_unused_unisex_blank_candidates
FROM catalog_variants v
JOIN product_scope p ON p.id=v.product_id
WHERE v.is_active=1 AND p.intended_scope='unisex' AND TRIM(COALESCE(v.gender,''))=''
  AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id=v.id AND (COALESCE(s.quantity,0)<>0 OR COALESCE(s.reserved_quantity,0)<>0))
  AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_movements im WHERE im.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir WHERE ir.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events le WHERE le.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items ti WHERE ti.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks sc WHERE sc.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items si WHERE si.variant_id=v.id);
