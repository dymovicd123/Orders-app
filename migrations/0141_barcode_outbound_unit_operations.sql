-- Branch2: only explicitly scanned physical labels follow an existing warehouse operation.
-- This ledger does not update inventory_stock; the existing operation does so atomically.
CREATE TABLE IF NOT EXISTS inventory_outbound_unit_scans (
  operation_id TEXT NOT NULL,
  unit_id TEXT NOT NULL REFERENCES inventory_units(unit_id),
  token TEXT NOT NULL REFERENCES inventory_unit_labels(token),
  variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('transfer','writeoff')),
  from_source TEXT NOT NULL CHECK (from_source IN ('warehouse','boutique')),
  to_source TEXT NOT NULL CHECK (to_source IN ('warehouse','boutique','none')),
  from_status TEXT NOT NULL CHECK (from_status IN ('unverified','on_hand')),
  from_coverage TEXT NOT NULL CHECK (from_coverage IN ('unlinked','linked')),
  actor TEXT,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY(operation_id,unit_id),
  CHECK ((operation_type='transfer' AND to_source IN ('warehouse','boutique') AND to_source<>from_source)
      OR (operation_type='writeoff' AND to_source='none'))
);
CREATE INDEX IF NOT EXISTS idx_outbound_unit_scan_unit
  ON inventory_outbound_unit_scans(unit_id,occurred_at);

CREATE TRIGGER IF NOT EXISTS trg_outbound_unit_scan_guard
BEFORE INSERT ON inventory_outbound_unit_scans FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT,'BARCODE_OUTBOUND_STALE_OR_INVALID_UNIT')
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_unit_labels l
    JOIN inventory_units u ON u.unit_id=l.unit_id
    JOIN catalog_variants v ON v.id=u.variant_id
    JOIN catalog_products p ON p.id=v.product_id
    JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
    WHERE l.token=NEW.token AND l.state='active' AND l.unit_id=NEW.unit_id
      AND u.variant_id=NEW.variant_id
      AND u.inventory_source=NEW.from_source
      AND u.unit_status=NEW.from_status AND u.coverage_status=NEW.from_coverage
      AND u.unit_status IN ('unverified','on_hand')
      AND u.coverage_status IN ('unlinked','linked')
      AND v.is_active=1 AND p.is_active=1 AND sp.is_active=1
  );
  SELECT RAISE(ABORT,'BARCODE_OUTBOUND_STOCKTAKE_ACTIVE')
  WHERE EXISTS (
    SELECT 1 FROM inventory_stocktake_unit_scans s
    JOIN inventory_stocktake_sessions ss ON ss.id=s.session_id
    WHERE s.unit_id=NEW.unit_id AND ss.status='active'
  );
  SELECT RAISE(ABORT,'BARCODE_OUTBOUND_DOCUMENT_NOT_FOUND')
  WHERE NOT (
    (NEW.operation_type='transfer' AND EXISTS (
      SELECT 1 FROM inventory_transfer_documents d
      JOIN inventory_transfer_items i ON i.transfer_id=d.id
      WHERE d.request_id=NEW.operation_id
        AND d.from_source=NEW.from_source AND d.to_source=NEW.to_source
        AND i.variant_id=NEW.variant_id AND i.quantity>0
    )) OR
    (NEW.operation_type='writeoff' AND EXISTS (
      SELECT 1 FROM inventory_operations o
      JOIN inventory_movements m ON m.reference_id=o.operation_id
      WHERE o.operation_id=NEW.operation_id AND o.operation_type='writeoff'
        AND o.source_type=NEW.from_source AND o.status='completed'
        AND m.reference_type='manual' AND m.inventory_source=NEW.from_source
        AND m.movement_type='writeoff' AND m.variant_id=NEW.variant_id
        AND m.quantity_delta<0
    ))
  );
  SELECT RAISE(ABORT,'BARCODE_OUTBOUND_EXCEEDS_OPERATION_QUANTITY')
  WHERE (SELECT COUNT(*) FROM inventory_outbound_unit_scans t
         WHERE t.operation_id=NEW.operation_id AND t.variant_id=NEW.variant_id) >=
        (CASE WHEN NEW.operation_type='transfer' THEN
          (SELECT COALESCE(SUM(i.quantity),0) FROM inventory_transfer_documents d
           JOIN inventory_transfer_items i ON i.transfer_id=d.id
           WHERE d.request_id=NEW.operation_id AND i.variant_id=NEW.variant_id)
        ELSE
          (SELECT COALESCE(-SUM(m.quantity_delta),0) FROM inventory_movements m
           WHERE m.reference_type='manual' AND m.reference_id=NEW.operation_id
             AND m.inventory_source=NEW.from_source AND m.variant_id=NEW.variant_id
             AND m.movement_type='writeoff')
        END);
END;

CREATE TRIGGER IF NOT EXISTS trg_outbound_unit_scan_apply
AFTER INSERT ON inventory_outbound_unit_scans FOR EACH ROW
BEGIN
  UPDATE inventory_units
  SET unit_status=CASE WHEN NEW.operation_type='transfer' THEN 'on_hand' ELSE 'not_stock' END,
      coverage_status=CASE WHEN NEW.operation_type='transfer' THEN 'linked' ELSE 'excluded' END,
      inventory_source=NEW.to_source,
      version=version+1,
      updated_at=NEW.occurred_at
  WHERE unit_id=NEW.unit_id AND variant_id=NEW.variant_id
    AND inventory_source=NEW.from_source
    AND unit_status=NEW.from_status AND coverage_status=NEW.from_coverage;
  SELECT RAISE(ABORT,'BARCODE_OUTBOUND_UPDATE_FAILED') WHERE changes()<>1;
  INSERT INTO inventory_unit_events
    (event_id,unit_id,operation_key,action_type,reference_type,reference_id,
     from_status,to_status,from_source,to_source,actor,created_at)
  VALUES
    (lower(hex(randomblob(16))),NEW.unit_id,
     'barcode-operation:'||NEW.operation_id||':'||NEW.unit_id,
     CASE WHEN NEW.operation_type='transfer' THEN 'transfer' ELSE 'writeoff' END,
     CASE WHEN NEW.operation_type='transfer' THEN 'inventory_transfer' ELSE 'inventory_operation' END,
     NEW.operation_id,NEW.from_status,
     CASE WHEN NEW.operation_type='transfer' THEN 'on_hand' ELSE 'not_stock' END,
     NEW.from_source,NEW.to_source,NEW.actor,NEW.occurred_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_outbound_unit_scan_immutable_update
BEFORE UPDATE ON inventory_outbound_unit_scans FOR EACH ROW
BEGIN SELECT RAISE(ABORT,'BARCODE_OUTBOUND_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_outbound_unit_scan_immutable_delete
BEFORE DELETE ON inventory_outbound_unit_scans FOR EACH ROW
BEGIN SELECT RAISE(ABORT,'BARCODE_OUTBOUND_IMMUTABLE'); END;
