PRAGMA foreign_keys=ON;
-- 0104: append-only proof for undoing an ORIGINAL pure-sum SKU merger whose
-- transferred customer reservations are still active and unmodified.
-- The migration itself creates EMPTY audit tables only; no business writes.
CREATE TABLE IF NOT EXISTS catalog_variant_reserved_undo_locations(
 generation_event_id INTEGER NOT NULL REFERENCES catalog_variant_merge_generation_events(id),
 inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
 source_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
 keeper_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
 keeper_quantity_merged INTEGER NOT NULL CHECK(keeper_quantity_merged>=0),
 keeper_reserved_merged INTEGER NOT NULL CHECK(keeper_reserved_merged>=0),
 source_quantity_restored INTEGER NOT NULL CHECK(source_quantity_restored>=0),
 keeper_quantity_restored INTEGER NOT NULL CHECK(keeper_quantity_restored>=0),
 source_reserved_restored INTEGER NOT NULL CHECK(source_reserved_restored>=0),
 keeper_reserved_restored INTEGER NOT NULL CHECK(keeper_reserved_restored>=0),
 CHECK(source_stock_id<>keeper_stock_id),
 CHECK(source_quantity_restored+keeper_quantity_restored=keeper_quantity_merged),
 CHECK(source_reserved_restored+keeper_reserved_restored=keeper_reserved_merged),
 PRIMARY KEY(generation_event_id,inventory_source)
);
CREATE TABLE IF NOT EXISTS catalog_variant_reserved_undo_reservations(
 generation_event_id INTEGER NOT NULL REFERENCES catalog_variant_merge_generation_events(id),
 reservation_id INTEGER NOT NULL REFERENCES inventory_reservations(id),
 order_id INTEGER NOT NULL REFERENCES orders(id),
 order_item_id INTEGER NOT NULL REFERENCES order_items(id),
 inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
 keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
 PRIMARY KEY(generation_event_id,reservation_id),
 UNIQUE(generation_event_id,order_item_id)
);
CREATE TABLE IF NOT EXISTS catalog_variant_reserved_undo_validations(
 generation_event_id INTEGER PRIMARY KEY REFERENCES catalog_variant_merge_generation_events(id),
 root_consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
 source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
 keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
 validated_locations INTEGER NOT NULL CHECK(validated_locations>0),
 validated_reservations INTEGER NOT NULL CHECK(validated_reservations>0),
 physical_total INTEGER NOT NULL CHECK(physical_total>=0),
 reserve_total INTEGER NOT NULL CHECK(reserve_total>0),
 passed INTEGER NOT NULL CHECK(passed=1),
 checked_by TEXT NOT NULL CHECK(length(trim(checked_by))>0),
 checked_at TEXT NOT NULL CHECK(julianday(checked_at) IS NOT NULL),
 CHECK(source_variant_id<>keeper_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_reserved_undo_root
 ON catalog_variant_reserved_undo_validations(root_consolidation_id);
CREATE TRIGGER IF NOT EXISTS trg_catalog_reserved_undo_proof
BEFORE INSERT ON catalog_variant_reserved_undo_validations
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM catalog_variant_merge_generation_events e
  JOIN catalog_variant_consolidations c ON c.id=e.root_consolidation_id
  JOIN catalog_variants s ON s.id=e.source_variant_id
  JOIN catalog_variants k ON k.id=e.target_variant_id
  WHERE e.id=NEW.generation_event_id AND e.generation=2 AND e.event_kind='undo'
    AND c.id=NEW.root_consolidation_id AND c.source_variant_id=NEW.source_variant_id
    AND c.target_variant_id=NEW.keeper_variant_id
    AND s.is_active=1 AND k.is_active=1
    AND s.product_id=c.product_id AND k.product_id=c.product_id
    AND c.source_reserved_quantity>0
    AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_validations v
      WHERE v.consolidation_id=c.id AND v.passed=1)
    AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_validations v
      WHERE v.consolidation_id=c.id AND v.passed=1)
    AND NEW.validated_locations=(SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
      WHERE l.consolidation_id=c.id)
    AND NEW.validated_locations=(SELECT COUNT(*) FROM catalog_variant_reserved_undo_locations a
      WHERE a.generation_event_id=e.id)
    AND NEW.validated_locations=(SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d
      WHERE d.consolidation_id=c.id)
    AND NEW.validated_reservations=(SELECT COUNT(*) FROM catalog_variant_consolidation_reservation_rows r
      WHERE r.consolidation_id=c.id)
    AND NEW.validated_reservations=(SELECT COUNT(*) FROM catalog_variant_reserved_undo_reservations a
      WHERE a.generation_event_id=e.id)
    AND c.source_reserved_quantity=(SELECT COALESCE(SUM(a.quantity),-1)
      FROM catalog_variant_consolidation_reservation_rows a WHERE a.consolidation_id=c.id)
    AND c.source_reserved_quantity=(SELECT COALESCE(SUM(l.source_reserved_before),-1)
      FROM catalog_variant_consolidation_stock_rows l WHERE l.consolidation_id=c.id)
    AND NEW.physical_total=(SELECT COALESCE(SUM(a.source_quantity_restored+a.keeper_quantity_restored),-1)
      FROM catalog_variant_reserved_undo_locations a WHERE a.generation_event_id=e.id)
    AND NEW.reserve_total=(SELECT COALESCE(SUM(a.source_reserved_restored+a.keeper_reserved_restored),-1)
      FROM catalog_variant_reserved_undo_locations a WHERE a.generation_event_id=e.id)
    AND NOT EXISTS(
      SELECT 1 FROM catalog_variant_consolidation_stock_rows l
      LEFT JOIN catalog_variant_consolidation_stock_decisions d
        ON d.consolidation_id=l.consolidation_id AND d.inventory_source=l.inventory_source
      LEFT JOIN catalog_variant_reserved_undo_locations a
        ON a.generation_event_id=e.id AND a.inventory_source=l.inventory_source
      LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
      LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
      WHERE l.consolidation_id=c.id AND (
        d.inventory_source IS NULL OR a.inventory_source IS NULL
        OR l.target_stock_id_before IS NULL
        OR d.decision_method<>'sum' OR d.adjustment_quantity<>0
        OR d.final_quantity<>l.source_quantity_before+l.target_quantity_before
        OR d.final_quantity<>l.combined_quantity_after
        OR a.source_stock_id<>l.source_stock_id OR a.keeper_stock_id<>l.target_stock_id_before
        OR a.keeper_quantity_merged<>l.combined_quantity_after
        OR a.keeper_reserved_merged<>l.source_reserved_before+l.target_reserved_before
        OR a.source_quantity_restored<>l.source_quantity_before
        OR a.keeper_quantity_restored<>l.target_quantity_before
        OR a.source_reserved_restored<>l.source_reserved_before
        OR a.keeper_reserved_restored<>l.target_reserved_before
        OR ss.id IS NULL OR ks.id IS NULL
        OR ss.variant_id<>s.id OR ks.variant_id<>k.id
        OR ss.inventory_source<>l.inventory_source OR ks.inventory_source<>l.inventory_source
        OR ss.quantity<>a.source_quantity_restored OR ks.quantity<>a.keeper_quantity_restored
        OR ss.reserved_quantity<>a.source_reserved_restored
        OR ks.reserved_quantity<>a.keeper_reserved_restored
        OR (SELECT COALESCE(SUM(rr.quantity),0)
            FROM catalog_variant_reserved_undo_reservations rr
            WHERE rr.generation_event_id=e.id AND rr.inventory_source=l.inventory_source)
           <>l.source_reserved_before
        OR (SELECT COALESCE(SUM(rr.quantity),0)
            FROM inventory_reservations rr
            WHERE rr.status='active' AND rr.variant_id=s.id
              AND rr.inventory_source=l.inventory_source)
           <>l.source_reserved_before
        OR (SELECT COALESCE(SUM(rr.quantity),0)
            FROM inventory_reservations rr
            WHERE rr.status='active' AND rr.variant_id=k.id
              AND rr.inventory_source=l.inventory_source)
           <>l.target_reserved_before
      )
    )
    AND NOT EXISTS(SELECT 1 FROM inventory_stock st
      WHERE st.variant_id IN (s.id,k.id)
        AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
          WHERE l.consolidation_id=c.id AND (
            (st.variant_id=s.id AND st.id=l.source_stock_id)
            OR (st.variant_id=k.id AND st.id=l.target_stock_id_before))))
    AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_rows r
      LEFT JOIN catalog_variant_reserved_undo_reservations a
        ON a.generation_event_id=e.id AND a.reservation_id=r.reservation_id
      LEFT JOIN inventory_reservations now ON now.id=r.reservation_id
      LEFT JOIN order_items oi ON oi.id=r.order_item_id
      LEFT JOIN orders o ON o.id=r.order_id
      WHERE r.consolidation_id=c.id AND (
        a.reservation_id IS NULL OR a.order_id<>r.order_id
        OR a.order_item_id<>r.order_item_id
        OR a.inventory_source<>r.inventory_source OR a.quantity<>r.quantity
        OR a.source_variant_id<>s.id OR a.keeper_variant_id<>k.id
        OR now.id IS NULL OR now.variant_id<>s.id OR now.status<>'active'
        OR now.quantity<>r.quantity OR now.inventory_source<>r.inventory_source
        OR now.order_id<>r.order_id OR now.order_item_id<>r.order_item_id
        OR oi.id IS NULL OR oi.variant_id<>s.id OR oi.order_id<>r.order_id
        OR oi.source_type<>r.inventory_source OR oi.quantity<r.quantity
        OR o.id IS NULL OR o.order_status<>'active'
        OR COALESCE(o.shipping_status,'not_sent')='sent'
        OR EXISTS(SELECT 1 FROM return_items ret WHERE ret.order_item_id=oi.id)
        OR EXISTS(SELECT 1 FROM exchanges ex
          WHERE ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id)
        OR EXISTS(SELECT 1 FROM exchange_items ex WHERE ex.order_item_id=oi.id)
      )
    )
    AND NOT EXISTS(SELECT 1 FROM inventory_reservations r
      WHERE r.status='active' AND r.variant_id=s.id
        AND NOT EXISTS(SELECT 1 FROM catalog_variant_reserved_undo_reservations a
          WHERE a.generation_event_id=e.id AND a.reservation_id=r.id))
  ) THEN RAISE(ABORT,'Reserved SKU undo proof failed') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reserved_undo_location_update
BEFORE UPDATE ON catalog_variant_reserved_undo_locations
BEGIN SELECT RAISE(ABORT,'Reserved undo location audit immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reserved_undo_location_delete
BEFORE DELETE ON catalog_variant_reserved_undo_locations
BEGIN SELECT RAISE(ABORT,'Reserved undo location audit immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reserved_undo_reservation_update
BEFORE UPDATE ON catalog_variant_reserved_undo_reservations
BEGIN SELECT RAISE(ABORT,'Reserved undo reservation audit immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reserved_undo_reservation_delete
BEFORE DELETE ON catalog_variant_reserved_undo_reservations
BEGIN SELECT RAISE(ABORT,'Reserved undo reservation audit immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reserved_undo_validation_update
BEFORE UPDATE ON catalog_variant_reserved_undo_validations
BEGIN SELECT RAISE(ABORT,'Reserved undo proof immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reserved_undo_validation_delete
BEFORE DELETE ON catalog_variant_reserved_undo_validations
BEGIN SELECT RAISE(ABORT,'Reserved undo proof immutable'); END;
