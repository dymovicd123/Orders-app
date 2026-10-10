PRAGMA foreign_keys=ON;
-- 0102: append-only evidence for a strictly reversible physical SKU allocation.
-- Schema-only; orders, money and inventory_stock are untouched by this migration.
CREATE TABLE IF NOT EXISTS catalog_variant_positive_undo_stock_rows (
  generation_event_id INTEGER NOT NULL REFERENCES catalog_variant_merge_generation_events(id),
  inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
  source_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  keeper_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  source_quantity_before INTEGER NOT NULL CHECK(source_quantity_before=0),
  keeper_quantity_before INTEGER NOT NULL CHECK(keeper_quantity_before>=0),
  source_quantity_restored INTEGER NOT NULL CHECK(source_quantity_restored>=0),
  keeper_quantity_restored INTEGER NOT NULL CHECK(keeper_quantity_restored>=0),
  CHECK(source_stock_id<>keeper_stock_id),
  CHECK(source_quantity_restored+keeper_quantity_restored=
    source_quantity_before+keeper_quantity_before),
  PRIMARY KEY(generation_event_id,inventory_source)
);
CREATE TABLE IF NOT EXISTS catalog_variant_positive_undo_validations (
  generation_event_id INTEGER PRIMARY KEY REFERENCES catalog_variant_merge_generation_events(id),
  root_consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
  source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  restored_source_quantity INTEGER NOT NULL CHECK(restored_source_quantity>0),
  validated_locations INTEGER NOT NULL CHECK(validated_locations>0),
  passed INTEGER NOT NULL CHECK(passed=1),
  created_by TEXT NOT NULL CHECK(length(trim(created_by))>0),
  checked_at TEXT NOT NULL CHECK(julianday(checked_at) IS NOT NULL),
  CHECK(source_variant_id<>keeper_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_positive_undo_root
  ON catalog_variant_positive_undo_validations(root_consolidation_id);

-- Final proof runs AFTER the generation event, source activation and all stock
-- updates, in the SAME atomic D1 batch. Any absent/mismatched row fails closed.
CREATE TRIGGER IF NOT EXISTS trg_catalog_positive_undo_validate
BEFORE INSERT ON catalog_variant_positive_undo_validations
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM catalog_variant_merge_generation_events e
    JOIN catalog_variant_consolidations c ON c.id=e.root_consolidation_id
    JOIN catalog_variants s ON s.id=e.source_variant_id
    JOIN catalog_variants k ON k.id=e.target_variant_id
    WHERE e.id=NEW.generation_event_id AND e.generation=2 AND e.event_kind='undo'
      AND c.id=NEW.root_consolidation_id AND c.source_variant_id=NEW.source_variant_id
      AND c.target_variant_id=NEW.keeper_variant_id AND e.target_variant_id=k.id
      AND s.is_active=1 AND k.is_active=1
      AND s.product_id=c.product_id AND k.product_id=c.product_id
      AND c.source_physical_quantity>0 AND c.source_reserved_quantity=0
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_validations v
        WHERE v.consolidation_id=c.id AND v.passed=1)
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_validations v
        WHERE v.consolidation_id=c.id AND v.passed=1)
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_rows r
        WHERE r.consolidation_id=c.id)
      AND NEW.restored_source_quantity=c.source_physical_quantity
      AND NEW.validated_locations=(SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
        WHERE l.consolidation_id=c.id)
      AND NEW.validated_locations=(SELECT COUNT(*) FROM catalog_variant_positive_undo_stock_rows a
        WHERE a.generation_event_id=e.id)
      AND c.source_physical_quantity=(SELECT SUM(l.source_quantity_before)
        FROM catalog_variant_consolidation_stock_rows l WHERE l.consolidation_id=c.id)
      AND NOT EXISTS(
        SELECT 1 FROM catalog_variant_consolidation_stock_rows l
        LEFT JOIN catalog_variant_consolidation_stock_decisions d
          ON d.consolidation_id=l.consolidation_id AND d.inventory_source=l.inventory_source
        LEFT JOIN catalog_variant_positive_undo_stock_rows a
          ON a.generation_event_id=e.id AND a.inventory_source=l.inventory_source
        LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
        LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
        WHERE l.consolidation_id=c.id AND (
          d.inventory_source IS NULL OR a.inventory_source IS NULL
          OR d.decision_method<>'sum' OR d.adjustment_quantity<>0
          OR d.final_quantity<>l.source_quantity_before+l.target_quantity_before
          OR l.combined_quantity_after<>d.final_quantity
          OR l.target_stock_id_before IS NULL
          OR l.source_reserved_before<>0 OR l.target_reserved_before<>0
          OR ss.id IS NULL OR ks.id IS NULL
          OR ss.variant_id<>s.id OR ks.variant_id<>k.id
          OR ss.inventory_source<>l.inventory_source OR ks.inventory_source<>l.inventory_source
          OR ss.quantity<>l.source_quantity_before OR ss.reserved_quantity<>0
          OR ks.quantity<>l.target_quantity_before OR ks.reserved_quantity<>0
          OR a.source_stock_id<>ss.id OR a.keeper_stock_id<>ks.id
          OR a.source_quantity_before<>0 OR a.keeper_quantity_before<>l.combined_quantity_after
          OR a.source_quantity_restored<>l.source_quantity_before
          OR a.keeper_quantity_restored<>l.target_quantity_before
        )
      )
      AND NOT EXISTS(SELECT 1 FROM inventory_stock st WHERE st.variant_id IN (s.id,k.id)
        AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
          WHERE l.consolidation_id=c.id AND (
            (st.variant_id=s.id AND st.id=l.source_stock_id)
            OR (st.variant_id=k.id AND st.id=l.target_stock_id_before)
          )))
      AND NOT EXISTS(SELECT 1 FROM inventory_reservations r
        WHERE r.variant_id IN (s.id,k.id) AND r.status='active')
  ) THEN RAISE(ABORT,'Positive-stock undo proof failed') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_positive_undo_row_update
BEFORE UPDATE ON catalog_variant_positive_undo_stock_rows
BEGIN SELECT RAISE(ABORT,'Positive-stock undo audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_positive_undo_row_delete
BEFORE DELETE ON catalog_variant_positive_undo_stock_rows
BEGIN SELECT RAISE(ABORT,'Positive-stock undo audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_positive_undo_validation_update
BEFORE UPDATE ON catalog_variant_positive_undo_validations
BEGIN SELECT RAISE(ABORT,'Positive-stock undo proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_positive_undo_validation_delete
BEFORE DELETE ON catalog_variant_positive_undo_validations
BEGIN SELECT RAISE(ABORT,'Positive-stock undo proof is immutable'); END;
