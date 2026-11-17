-- Branch2 barcode stocktake pilot: every physical unit is counted once per stocktake.
-- This ledger does not mutate physical stock, reservations, or shipment records.
CREATE TABLE IF NOT EXISTS inventory_stocktake_unit_scans (
  session_id TEXT NOT NULL REFERENCES inventory_stocktake_sessions(id),
  unit_id TEXT NOT NULL REFERENCES inventory_units(unit_id),
  item_id INTEGER NOT NULL REFERENCES inventory_stocktake_items(id),
  token TEXT NOT NULL REFERENCES inventory_unit_labels(token),
  variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse','boutique')),
  scanned_at TEXT NOT NULL,
  scanned_by TEXT,
  PRIMARY KEY(session_id,unit_id)
);
CREATE INDEX IF NOT EXISTS idx_stocktake_unit_scans_item
  ON inventory_stocktake_unit_scans(session_id,item_id);

-- SQLite triggers keep the scan receipt and the stocktake draft count atomic.
-- A duplicate unique unit scan can never increment the count twice.
CREATE TRIGGER IF NOT EXISTS trg_stocktake_unit_scan_apply
AFTER INSERT ON inventory_stocktake_unit_scans
FOR EACH ROW
BEGIN
  UPDATE inventory_stocktake_items
     SET counted_quantity = COALESCE(counted_quantity,0) + 1,
         counted_at = NEW.scanned_at,
         status = 'counted',
         conflict_quantity = NULL,
         updated_at = NEW.scanned_at
   WHERE id = NEW.item_id
     AND session_id = NEW.session_id
     AND variant_id = NEW.variant_id
     AND inventory_source = NEW.inventory_source
     AND status IN ('pending','counted')
     AND EXISTS (
       SELECT 1 FROM inventory_stocktake_sessions ss
       WHERE ss.id = NEW.session_id
         AND ss.status = 'active'
         AND ss.inventory_source = NEW.inventory_source
     )
     AND EXISTS (
       SELECT 1 FROM inventory_unit_labels l
       JOIN inventory_units u ON u.unit_id=l.unit_id
       JOIN catalog_variants v ON v.id=u.variant_id
       JOIN catalog_products p ON p.id=v.product_id
       JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
       WHERE l.token=NEW.token AND l.unit_id=NEW.unit_id
         AND l.state='active'
         AND u.variant_id=NEW.variant_id
         AND u.inventory_source=NEW.inventory_source
         AND u.unit_status IN ('unverified','on_hand')
         AND u.coverage_status IN ('unlinked','linked')
         AND v.is_active=1 AND p.is_active=1 AND sp.is_active=1
     )
     AND baseline_quantity = COALESCE((
       SELECT s.quantity FROM inventory_stock s
       WHERE s.inventory_source = NEW.inventory_source
         AND s.variant_id = NEW.variant_id
       LIMIT 1
     ),0)
     AND (SELECT COUNT(*) FROM inventory_stock s
          WHERE s.inventory_source=NEW.inventory_source
            AND s.variant_id=NEW.variant_id) <= 1;
  SELECT RAISE(ABORT,'STOCKTAKE_UNIT_SCAN_CONFLICT') WHERE changes() <> 1;
  UPDATE inventory_stocktake_sessions
     SET updated_at=NEW.scanned_at
   WHERE id=NEW.session_id AND status='active';
END;

-- A unit scan is an immutable physical count receipt, not an editable note.
CREATE TRIGGER IF NOT EXISTS trg_stocktake_unit_scan_no_update
BEFORE UPDATE ON inventory_stocktake_unit_scans
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'STOCKTAKE_SCAN_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_stocktake_unit_scan_no_delete
BEFORE DELETE ON inventory_stocktake_unit_scans
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'STOCKTAKE_SCAN_IMMUTABLE'); END;

-- A counted physical label must not later be cancelled as an unused blank label.
CREATE TRIGGER IF NOT EXISTS trg_stocktake_scan_label_revocation_guard
BEFORE UPDATE OF state ON inventory_unit_labels
FOR EACH ROW
WHEN OLD.state='active' AND NEW.state='revoked'
 AND EXISTS (SELECT 1 FROM inventory_stocktake_unit_scans WHERE token=OLD.token)
BEGIN SELECT RAISE(ABORT,'STOCKTAKE_SCAN_LABEL_ALREADY_USED'); END;
