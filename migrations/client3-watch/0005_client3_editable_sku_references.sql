-- Third tenant ONLY. All SKU rows and historical FKs remain untouched.
-- Main's reference editing stores ordinary text including embedded spaces.

CREATE TABLE watch_reference_values_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'movements','bracelets','dials','leatherColors','paymentMethods','deliveryMethods'
  )),
  value TEXT NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 80),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind,value COLLATE NOCASE)
);
INSERT INTO watch_reference_values_v5(id,kind,value,is_active,created_at)
SELECT id,kind,value,is_active,created_at FROM watch_reference_values;
DROP TABLE watch_reference_values;
ALTER TABLE watch_reference_values_v5 RENAME TO watch_reference_values;
CREATE INDEX IF NOT EXISTS idx_watch_ref_kind_active
  ON watch_reference_values(kind,is_active,value);

INSERT OR IGNORE INTO watch_reference_values(kind,value) VALUES
 ('movements','quartz'),('movements','mechanical'),
 ('bracelets','steel'),('bracelets','leather'),('bracelets','rubber'),
 ('dials','black'),('dials','white'),('dials','silver'),('dials','gold'),
 ('dials','green'),('dials','orange'),('dials','brown'),('dials','multicolor');

-- D1 ALWAYS enforces existing order-item FKs. Never rebuild/drop watch_variants:
-- an implicit DROP may irreversibly invalidate already-sold watch SKU links.
-- Add flexible attributes instead. Old enum columns remain legal legacy anchors.
ALTER TABLE watch_variants ADD COLUMN custom_movement TEXT;
ALTER TABLE watch_variants ADD COLUMN custom_bracelet_material TEXT;
ALTER TABLE watch_variants ADD COLUMN custom_dial_color TEXT;
ALTER TABLE watch_variants ADD COLUMN custom_bracelet_color TEXT;

-- Expression-based UNIQUE key guarantees that display identity, not an internal
-- compatibility anchor, remains unique across both old and new SKUs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_effective_sku_v5
ON watch_variants(
 watch_product_id,gender,
 COALESCE(custom_movement,movement),
 COALESCE(custom_bracelet_material,bracelet_material),
 COALESCE(custom_dial_color,dial_color),
 COALESCE(custom_bracelet_color,bracelet_color)
);

-- Aborts the entire transaction rather than partially retiring a group if
-- concurrent physical/order activity begins after its preview.
CREATE TRIGGER trg_watch_variant_safe_remove_v5
BEFORE UPDATE OF is_active ON watch_variants
WHEN OLD.is_active=1 AND NEW.is_active=0 AND OLD.catalog_variant_id IS NOT NULL
AND (
 EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id=OLD.catalog_variant_id
   AND (COALESCE(s.quantity,0)<>0 OR COALESCE(s.reserved_quantity,0)<>0))
 OR EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.variant_id=OLD.catalog_variant_id
   AND r.status='active' AND COALESCE(r.quantity,0)<>0)
 OR EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
   WHERE oi.variant_id=OLD.catalog_variant_id AND oi.quantity>0
   AND o.order_status='active' AND o.shipping_status<>'sent')
 OR EXISTS(SELECT 1 FROM inventory_lifecycle_events e WHERE e.variant_id=OLD.catalog_variant_id
   AND e.status='pending')
 OR EXISTS(SELECT 1 FROM inventory_stocktake_items i
   JOIN inventory_stocktake_sessions ss ON ss.id=i.session_id
   WHERE i.variant_id=OLD.catalog_variant_id AND ss.status='active')
)
BEGIN SELECT RAISE(ABORT,'watch_variant_in_use'); END;
