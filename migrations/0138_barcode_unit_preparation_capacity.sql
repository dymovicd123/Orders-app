CREATE INDEX IF NOT EXISTS idx_barcode_units_prepared_location
ON inventory_units(variant_id, inventory_source, unit_status, coverage_status);

CREATE INDEX IF NOT EXISTS idx_barcode_units_preparation_request
ON inventory_units(origin_kind, origin_ref, unit_id);

CREATE TRIGGER IF NOT EXISTS trg_barcode_prepared_unit_capacity
BEFORE INSERT ON inventory_units
FOR EACH ROW
WHEN NEW.origin_kind = 'existing_stock'
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_PREPARATION_REQUIRES_UNVERIFIED')
  WHERE NEW.unit_status <> 'unverified'
    OR NEW.coverage_status <> 'unlinked'
    OR NEW.original_variant_id IS NULL
    OR NEW.original_variant_id IS NOT NEW.variant_id
    OR NEW.origin_ref IS NULL
    OR LENGTH(TRIM(NEW.origin_ref)) < 8;

  SELECT RAISE(ABORT, 'BARCODE_PREPARATION_WRONG_SOURCE')
  WHERE NEW.inventory_source NOT IN ('warehouse','boutique');

  SELECT RAISE(ABORT, 'BARCODE_PREPARATION_SKU_INACTIVE')
  WHERE NOT EXISTS (
    SELECT 1 FROM catalog_variants v
    JOIN catalog_products p ON p.id=v.product_id
    JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
    WHERE v.id=NEW.variant_id
      AND v.is_active=1 AND p.is_active=1 AND sp.is_active=1
  );

  SELECT RAISE(ABORT, 'BARCODE_PREPARATION_CAPACITY_EXCEEDED')
  WHERE (
    SELECT COUNT(*) FROM inventory_stock s
    WHERE s.variant_id=NEW.variant_id
      AND s.inventory_source=NEW.inventory_source
  ) <> 1
  OR COALESCE((
    SELECT s.quantity FROM inventory_stock s
    WHERE s.variant_id=NEW.variant_id
      AND s.inventory_source=NEW.inventory_source
    LIMIT 1
  ),0) <= (
    SELECT COUNT(*) FROM inventory_units u
    WHERE u.variant_id=NEW.variant_id
      AND u.inventory_source=NEW.inventory_source
      AND u.coverage_status <> 'excluded'
      AND u.unit_status NOT IN ('issued','not_stock','retired')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_barcode_prepared_batch_cancel_integrity
BEFORE UPDATE OF state ON barcode_print_batches
FOR EACH ROW
WHEN OLD.purpose = 'existing_stock'
  AND OLD.state = 'prepared'
  AND NEW.state = 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'BARCODE_CANCELLATION_UNIT_ALREADY_USED')
  WHERE NOT EXISTS (
    SELECT 1 FROM barcode_print_batch_labels bl WHERE bl.batch_id=OLD.batch_id
  ) OR EXISTS (
    SELECT 1 FROM barcode_print_batch_labels bl
    JOIN inventory_unit_labels l ON l.token=bl.label_token
    JOIN inventory_units u ON u.unit_id=l.unit_id
    WHERE bl.batch_id=OLD.batch_id
      AND (u.unit_status <> 'unverified'
        OR u.coverage_status <> 'unlinked'
        OR l.state <> 'active')
  );
END;
