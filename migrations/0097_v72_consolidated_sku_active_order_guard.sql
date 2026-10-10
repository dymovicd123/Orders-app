PRAGMA foreign_keys=ON;

-- Prevent a concurrent stale browser/critical operation from attaching a NEW
-- active customer commitment to an already consolidated, inactive SKU.
-- This does NOT lock any active SKU or inventory movement; the order writer
-- resolves the audited source -> keeper lineage before normal saves.
CREATE TRIGGER IF NOT EXISTS trg_order_consolidated_sku_insert
BEFORE INSERT ON order_items
WHEN NEW.variant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM catalog_variant_consolidations c
    JOIN catalog_variants v ON v.id=c.source_variant_id
    JOIN orders o ON o.id=NEW.order_id
    WHERE c.source_variant_id=NEW.variant_id AND v.is_active=0
      AND o.order_status='active'
      AND COALESCE(o.shipping_status,'not_sent')<>'sent'
  )
BEGIN
  SELECT RAISE(ABORT,'Вариант товара объединён. Обновите сохранение заказа.');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_consolidated_sku_reassign
BEFORE UPDATE OF variant_id ON order_items
WHEN NEW.variant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM catalog_variant_consolidations c
    JOIN catalog_variants v ON v.id=c.source_variant_id
    JOIN orders o ON o.id=NEW.order_id
    WHERE c.source_variant_id=NEW.variant_id AND v.is_active=0
      AND o.order_status='active'
      AND COALESCE(o.shipping_status,'not_sent')<>'sent'
  )
BEGIN
  SELECT RAISE(ABORT,'Вариант товара объединён. Повторно выберите действующий вариант.');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_consolidated_sku_reopen
BEFORE UPDATE OF order_status,shipping_status ON orders
WHEN NEW.order_status='active'
  AND COALESCE(NEW.shipping_status,'not_sent')<>'sent'
  AND EXISTS (
    SELECT 1 FROM order_items oi
    JOIN catalog_variant_consolidations c ON c.source_variant_id=oi.variant_id
    JOIN catalog_variants v ON v.id=c.source_variant_id
    WHERE oi.order_id=NEW.id AND COALESCE(oi.quantity,0)>0 AND v.is_active=0
  )
BEGIN
  SELECT RAISE(ABORT,'У заказа есть объединённый исторический вариант. Проверьте состав перед возобновлением.');
END;

CREATE TRIGGER IF NOT EXISTS trg_reservation_consolidated_sku_insert
BEFORE INSERT ON inventory_reservations
WHEN NEW.variant_id IS NOT NULL AND NEW.status='active'
  AND EXISTS (
    SELECT 1 FROM catalog_variant_consolidations c
    JOIN catalog_variants v ON v.id=c.source_variant_id
    WHERE c.source_variant_id=NEW.variant_id AND v.is_active=0
  )
BEGIN
  SELECT RAISE(ABORT,'Резерв на объединённый вариант запрещён. Используйте основной вариант.');
END;

CREATE TRIGGER IF NOT EXISTS trg_reservation_consolidated_sku_reassign
BEFORE UPDATE OF variant_id,status ON inventory_reservations
WHEN NEW.variant_id IS NOT NULL AND NEW.status='active'
  AND EXISTS (
    SELECT 1 FROM catalog_variant_consolidations c
    JOIN catalog_variants v ON v.id=c.source_variant_id
    WHERE c.source_variant_id=NEW.variant_id AND v.is_active=0
  )
BEGIN
  SELECT RAISE(ABORT,'Резерв на объединённый вариант запрещён. Используйте основной вариант.');
END;
