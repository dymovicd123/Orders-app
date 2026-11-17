-- Branch2-only: shared SKU scan events are distinct physical attempts, not unique items.
-- Each event has a unique request ID to stop network retries from counting twice.
-- Manual editing of the resulting total remains fully allowed.
-- No inventory_stock, reservations, orders or individual unit status is changed.
CREATE TABLE IF NOT EXISTS inventory_stocktake_sku_scans (
  session_id TEXT NOT NULL REFERENCES inventory_stocktake_sessions(id),
  request_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES inventory_stocktake_items(id),
  variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse','boutique')),
  scanned_at TEXT NOT NULL,
  scanned_by TEXT,
  PRIMARY KEY (session_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_stocktake_sku_scans_item
  ON inventory_stocktake_sku_scans(session_id,item_id);

CREATE TRIGGER IF NOT EXISTS trg_stocktake_sku_scan_apply
AFTER INSERT ON inventory_stocktake_sku_scans
FOR EACH ROW
BEGIN
  UPDATE inventory_stocktake_items
     SET counted_quantity = COALESCE(counted_quantity,0)+1,
         counted_at = NEW.scanned_at,
         status = 'counted',
         conflict_quantity = NULL,
         updated_at = NEW.scanned_at
   WHERE id=NEW.item_id
     AND session_id=NEW.session_id
     AND variant_id=NEW.variant_id
     AND inventory_source=NEW.inventory_source
     AND status IN ('pending','counted')
     AND EXISTS (
       SELECT 1 FROM inventory_stocktake_sessions ss
        WHERE ss.id=NEW.session_id
          AND ss.status='active'
          AND ss.inventory_source=NEW.inventory_source
     )
     AND EXISTS (
       SELECT 1 FROM catalog_variants v
       JOIN catalog_products p ON p.id=v.product_id
       LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
        WHERE v.id=NEW.variant_id
          AND v.is_active=1 AND p.is_active=1
          AND (sp.id IS NULL OR sp.is_active=1)
     )
     AND baseline_quantity=COALESCE((
       SELECT s.quantity FROM inventory_stock s
        WHERE s.inventory_source=NEW.inventory_source
          AND s.variant_id=NEW.variant_id LIMIT 1
     ),0)
     AND (SELECT COUNT(*) FROM inventory_stock s
       WHERE s.inventory_source=NEW.inventory_source
         AND s.variant_id=NEW.variant_id) <= 1;
  SELECT RAISE(ABORT,'STOCKTAKE_SKU_SCAN_CONFLICT') WHERE changes()<>1;
  UPDATE inventory_stocktake_sessions
     SET updated_at=NEW.scanned_at
   WHERE id=NEW.session_id AND status='active';
END;

CREATE TRIGGER IF NOT EXISTS trg_stocktake_sku_scan_no_update
BEFORE UPDATE ON inventory_stocktake_sku_scans
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'STOCKTAKE_SKU_SCAN_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_stocktake_sku_scan_no_delete
BEFORE DELETE ON inventory_stocktake_sku_scans
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'STOCKTAKE_SKU_SCAN_IMMUTABLE'); END;
