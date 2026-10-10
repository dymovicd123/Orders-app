PRAGMA foreign_keys=ON;
-- A permanent check ONLY on an inactive SKU with an audited consolidation
-- receipt. It never locks staff while an active SKU is being inspected.
CREATE TRIGGER IF NOT EXISTS trg_stock_consolidated_sku_insert
BEFORE INSERT ON inventory_stock
WHEN NEW.variant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM catalog_variant_consolidations c
    JOIN catalog_variants v ON v.id=c.source_variant_id
    WHERE c.source_variant_id=NEW.variant_id AND v.is_active=0
  )
BEGIN SELECT RAISE(ABORT,'Вариант уже объединён. Обновите приход и выберите основной вариант.'); END;

CREATE TRIGGER IF NOT EXISTS trg_stock_consolidated_sku_update
BEFORE UPDATE OF quantity,reserved_quantity ON inventory_stock
WHEN OLD.variant_id IS NOT NULL
  AND (NEW.quantity IS NOT OLD.quantity OR NEW.reserved_quantity IS NOT OLD.reserved_quantity)
  AND EXISTS (
    SELECT 1 FROM catalog_variant_consolidations c
    JOIN catalog_variants v ON v.id=c.source_variant_id
    WHERE c.source_variant_id=OLD.variant_id AND v.is_active=0
  )
BEGIN SELECT RAISE(ABORT,'Остаток объединённого варианта нельзя менять. Выберите основной SKU.'); END;

CREATE TRIGGER IF NOT EXISTS trg_stock_consolidated_sku_reassign
BEFORE UPDATE OF variant_id ON inventory_stock
WHEN NEW.variant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM catalog_variant_consolidations c
    JOIN catalog_variants v ON v.id=c.source_variant_id
    WHERE c.source_variant_id=NEW.variant_id AND v.is_active=0
  )
BEGIN SELECT RAISE(ABORT,'Нельзя назначить складской остаток объединённому варианту.'); END;
