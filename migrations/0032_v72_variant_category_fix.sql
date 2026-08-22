-- Step 45: adult/child is a variant-level characteristic, not a base-product category.
-- Backfill legacy/default adult variants that are actually child ages.
UPDATE catalog_variants
SET category = 'child', updated_at = datetime('now')
WHERE is_active = 1
  AND (
    TRIM(COALESCE(size_label, '')) IN ('1','2','3','4','5','6','7','8','9','10','11','12')
    OR TRIM(COALESCE(size_label, '')) LIKE '1-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '2-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '3-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '4-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '5-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '6-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '7-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '8-%'
    OR TRIM(COALESCE(size_label, '')) LIKE '9-%'
    OR LOWER(TRIM(COALESCE(size_label, ''))) LIKE '%лет%'
    OR LOWER(TRIM(COALESCE(size_label, ''))) LIKE '%год%'
    OR LOWER(TRIM(COALESCE(gender, ''))) LIKE '%дет%'
  );

UPDATE catalog_variants
SET category = 'adult', updated_at = datetime('now')
WHERE is_active = 1
  AND TRIM(COALESCE(size_label, '')) IN ('38','40','42','44','46','48','50','52','54','56','58','60','62','64','66','68','70');

CREATE INDEX IF NOT EXISTS idx_catalog_variants_variant_category_v72
  ON catalog_variants(product_id, category, is_active, sort_order);
