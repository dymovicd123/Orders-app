CREATE INDEX IF NOT EXISTS idx_inventory_units_original_variant ON inventory_units(original_variant_id);

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_variant_deactivation
BEFORE UPDATE OF is_active ON catalog_variants
FOR EACH ROW
WHEN OLD.is_active = 1 AND NEW.is_active IS NOT 1
  AND EXISTS (
    SELECT 1 FROM inventory_units u
    WHERE u.variant_id = OLD.id
      AND (u.unit_status <> 'retired' OR u.coverage_status <> 'excluded')
  )
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_VARIANT_IN_USE');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_product_deactivation
BEFORE UPDATE OF is_active ON catalog_products
FOR EACH ROW
WHEN OLD.is_active = 1 AND NEW.is_active IS NOT 1
  AND EXISTS (
    SELECT 1 FROM inventory_units u
    JOIN catalog_variants v ON v.id = u.variant_id
    WHERE v.product_id = OLD.id
      AND (u.unit_status <> 'retired' OR u.coverage_status <> 'excluded')
  )
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_PRODUCT_IN_USE');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_execution_deactivation
BEFORE UPDATE OF is_active ON catalog_stock_positions
FOR EACH ROW
WHEN OLD.is_active = 1 AND NEW.is_active IS NOT 1
  AND EXISTS (
    SELECT 1 FROM inventory_units u
    JOIN catalog_variants v ON v.id = u.variant_id
    WHERE v.stock_position_id = OLD.id
      AND (u.unit_status <> 'retired' OR u.coverage_status <> 'excluded')
  )
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_EXECUTION_IN_USE');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_variant_identity
BEFORE UPDATE OF product_id, stock_position_id, category, gender, color, material, length, size_label
ON catalog_variants
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM inventory_units u
    WHERE u.variant_id = OLD.id OR u.original_variant_id = OLD.id
  ) AND (
    NEW.product_id IS NOT OLD.product_id
    OR NEW.stock_position_id IS NOT OLD.stock_position_id
    OR NEW.category IS NOT OLD.category
    OR NEW.gender IS NOT OLD.gender
    OR NEW.color IS NOT OLD.color
    OR NEW.material IS NOT OLD.material
    OR NEW.length IS NOT OLD.length
    OR NEW.size_label IS NOT OLD.size_label
  )
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_VARIANT_IDENTITY_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_variant_delete
BEFORE DELETE ON catalog_variants
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM inventory_units u
  WHERE u.variant_id = OLD.id OR u.original_variant_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_VARIANT_HISTORY');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_original_identity
BEFORE UPDATE OF original_variant_id, unit_id ON inventory_units
FOR EACH ROW
WHEN NEW.unit_id IS NOT OLD.unit_id
  OR (OLD.original_variant_id IS NOT NULL
      AND NEW.original_variant_id IS NOT OLD.original_variant_id)
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_ORIGIN_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_on_hand_insert
BEFORE INSERT ON inventory_units
FOR EACH ROW
WHEN NEW.unit_status = 'on_hand'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_variants v
    JOIN catalog_products p ON p.id = v.product_id
    JOIN catalog_stock_positions sp ON sp.id = v.stock_position_id
    WHERE v.id = NEW.variant_id
      AND v.is_active = 1 AND p.is_active = 1 AND sp.is_active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_ON_HAND_SKU_INACTIVE');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_on_hand_update
BEFORE UPDATE OF variant_id, unit_status, inventory_source, coverage_status ON inventory_units
FOR EACH ROW
WHEN NEW.unit_status = 'on_hand'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_variants v
    JOIN catalog_products p ON p.id = v.product_id
    JOIN catalog_stock_positions sp ON sp.id = v.stock_position_id
    WHERE v.id = NEW.variant_id
      AND v.is_active = 1 AND p.is_active = 1 AND sp.is_active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_ON_HAND_SKU_INACTIVE');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_label_revoked_immutable
BEFORE UPDATE ON inventory_unit_labels
FOR EACH ROW
WHEN OLD.state = 'revoked'
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_LABEL_REVOKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_label_identity_immutable
BEFORE UPDATE OF token, unit_id, label_version ON inventory_unit_labels
FOR EACH ROW
WHEN NEW.token IS NOT OLD.token
  OR NEW.unit_id IS NOT OLD.unit_id
  OR NEW.label_version IS NOT OLD.label_version
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_LABEL_IDENTITY');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_event_update
BEFORE UPDATE ON inventory_unit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_EVENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_unit_event_delete
BEFORE DELETE ON inventory_unit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_UNIT_EVENT_IMMUTABLE');
END;
