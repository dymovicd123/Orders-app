PRAGMA foreign_keys=ON;
-- Schema-first proof for manually counted redistribution of an already
-- physically corrected SKU merge. Creates only EMPTY append-only journals.
CREATE TABLE IF NOT EXISTS catalog_variant_counted_undo_locations (
  generation_event_id INTEGER NOT NULL REFERENCES catalog_variant_merge_generation_events(id),
  inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
  source_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  keeper_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  source_quantity_before INTEGER NOT NULL CHECK(source_quantity_before=0),
  keeper_quantity_before INTEGER NOT NULL CHECK(keeper_quantity_before>=0),
  confirmed_source_quantity INTEGER NOT NULL CHECK(confirmed_source_quantity>=0),
  confirmed_keeper_quantity INTEGER NOT NULL CHECK(confirmed_keeper_quantity>=0),
  physical_count_confirmed INTEGER NOT NULL CHECK(physical_count_confirmed=1),
  CHECK(source_stock_id<>keeper_stock_id),
  CHECK(confirmed_source_quantity+confirmed_keeper_quantity=
        source_quantity_before+keeper_quantity_before),
  PRIMARY KEY(generation_event_id,inventory_source)
);
CREATE TABLE IF NOT EXISTS catalog_variant_counted_undo_validations (
  generation_event_id INTEGER PRIMARY KEY REFERENCES catalog_variant_merge_generation_events(id),
  root_consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
  source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  validated_locations INTEGER NOT NULL CHECK(validated_locations>0),
  confirmed_total INTEGER NOT NULL CHECK(confirmed_total>=0),
  passed INTEGER NOT NULL CHECK(passed=1),
  checked_by TEXT NOT NULL CHECK(length(trim(checked_by))>0),
  checked_at TEXT NOT NULL CHECK(julianday(checked_at) IS NOT NULL),
  CHECK(source_variant_id<>keeper_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_counted_undo_root
 ON catalog_variant_counted_undo_validations(root_consolidation_id);
CREATE TRIGGER IF NOT EXISTS trg_catalog_counted_undo_proof
BEFORE INSERT ON catalog_variant_counted_undo_validations
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM catalog_variant_merge_generation_events e
    JOIN catalog_variant_consolidations c ON c.id=e.root_consolidation_id
    JOIN catalog_variants s ON s.id=e.source_variant_id
    JOIN catalog_variants k ON k.id=e.target_variant_id
    WHERE e.id=NEW.generation_event_id AND e.generation=2 AND e.event_kind='undo'
      AND c.id=NEW.root_consolidation_id
      AND c.source_variant_id=NEW.source_variant_id
      AND c.target_variant_id=NEW.keeper_variant_id
      AND s.is_active=1 AND k.is_active=1 AND s.product_id=c.product_id
      AND k.product_id=c.product_id
      AND c.source_reserved_quantity=0
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_rows r
        WHERE r.consolidation_id=c.id)
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_validations v
        WHERE v.consolidation_id=c.id AND v.passed=1)
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_validations v
        WHERE v.consolidation_id=c.id AND v.passed=1)
      AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
        WHERE l.consolidation_id=c.id)>0
      AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
        WHERE l.consolidation_id=c.id)=NEW.validated_locations
      AND (SELECT COUNT(*) FROM catalog_variant_counted_undo_locations a
        WHERE a.generation_event_id=e.id)=NEW.validated_locations
      AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d
        WHERE d.consolidation_id=c.id)=NEW.validated_locations
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_decisions d
        WHERE d.consolidation_id=c.id
          AND (d.decision_method<>'sum' OR d.adjustment_quantity<>0))
      AND (SELECT COALESCE(SUM(a.confirmed_source_quantity+a.confirmed_keeper_quantity),-1)
        FROM catalog_variant_counted_undo_locations a
        WHERE a.generation_event_id=e.id)=NEW.confirmed_total
      AND NOT EXISTS(
        SELECT 1 FROM catalog_variant_consolidation_stock_rows l
        LEFT JOIN catalog_variant_consolidation_stock_decisions d
          ON d.consolidation_id=l.consolidation_id
          AND d.inventory_source=l.inventory_source
        LEFT JOIN catalog_variant_counted_undo_locations a
          ON a.generation_event_id=e.id AND a.inventory_source=l.inventory_source
        LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
        LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
        WHERE l.consolidation_id=c.id AND (
          d.inventory_source IS NULL OR a.inventory_source IS NULL
          OR l.target_stock_id_before IS NULL
          OR d.final_quantity<>l.combined_quantity_after
          OR d.adjustment_quantity<>d.final_quantity-l.source_quantity_before-l.target_quantity_before
          OR l.source_reserved_before<>0 OR l.target_reserved_before<>0
          OR ss.id IS NULL OR ks.id IS NULL
          OR ss.variant_id<>s.id OR ks.variant_id<>k.id
          OR ss.inventory_source<>l.inventory_source OR ks.inventory_source<>l.inventory_source
          OR a.source_stock_id<>ss.id OR a.keeper_stock_id<>ks.id
          OR a.source_quantity_before<>0
          OR a.keeper_quantity_before<>l.combined_quantity_after
          OR ss.quantity<>a.confirmed_source_quantity OR ss.reserved_quantity<>0
          OR ks.quantity<>a.confirmed_keeper_quantity OR ks.reserved_quantity<>0
        )
      )
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_counted_undo_locations a
        WHERE a.generation_event_id=e.id
          AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
            WHERE l.consolidation_id=c.id AND l.inventory_source=a.inventory_source))
      AND NOT EXISTS(SELECT 1 FROM inventory_stock st
        WHERE st.variant_id IN (s.id,k.id)
          AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
            WHERE l.consolidation_id=c.id
              AND ((st.variant_id=s.id AND st.id=l.source_stock_id)
                OR (st.variant_id=k.id AND st.id=l.target_stock_id_before))))
      AND NOT EXISTS(SELECT 1 FROM inventory_reservations r
        WHERE r.variant_id IN (s.id,k.id) AND r.status='active')
  ) THEN RAISE(ABORT,'Counted SKU undo proof failed') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_counted_undo_location_immutable_update
BEFORE UPDATE ON catalog_variant_counted_undo_locations
BEGIN SELECT RAISE(ABORT,'Counted undo locations immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_counted_undo_location_immutable_delete
BEFORE DELETE ON catalog_variant_counted_undo_locations
BEGIN SELECT RAISE(ABORT,'Counted undo locations immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_counted_undo_validation_immutable_update
BEFORE UPDATE ON catalog_variant_counted_undo_validations
BEGIN SELECT RAISE(ABORT,'Counted undo validations immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_counted_undo_validation_immutable_delete
BEFORE DELETE ON catalog_variant_counted_undo_validations
BEGIN SELECT RAISE(ABORT,'Counted undo validations immutable'); END;
