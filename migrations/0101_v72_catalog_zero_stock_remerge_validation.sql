PRAGMA foreign_keys=ON;
-- Append-only proof for a *zero-stock, no-reservation* re-merge after a
-- completed and validated generation-2 undo. This schema only creates an
-- empty journal: it does not change catalog, customer, stock or finance data.
CREATE TABLE IF NOT EXISTS catalog_variant_zero_stock_remerge_validations (
  generation_event_id INTEGER PRIMARY KEY REFERENCES catalog_variant_merge_generation_events(id),
  root_consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
  source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  target_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  source_stock_rows INTEGER NOT NULL CHECK(source_stock_rows>0),
  stock_fingerprint TEXT NOT NULL CHECK(json_valid(stock_fingerprint)),
  passed INTEGER NOT NULL CHECK(passed=1),
  created_by TEXT NOT NULL CHECK(length(trim(created_by))>0),
  checked_at TEXT NOT NULL CHECK(julianday(checked_at) IS NOT NULL),
  CHECK(source_variant_id<>target_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_zero_stock_remerge_root
 ON catalog_variant_zero_stock_remerge_validations(root_consolidation_id);

-- The proof cannot be forged for a still-active source, an unrelated keeper,
-- a missing completed undo, or a source with nonzero stock or reservations.
CREATE TRIGGER IF NOT EXISTS trg_catalog_zero_stock_remerge_proof
BEFORE INSERT ON catalog_variant_zero_stock_remerge_validations
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM catalog_variant_merge_generation_events e
    JOIN catalog_variant_consolidations c ON c.id=e.root_consolidation_id
    JOIN catalog_variants s ON s.id=e.source_variant_id
    JOIN catalog_variants k ON k.id=e.target_variant_id
    WHERE e.id=NEW.generation_event_id AND e.event_kind='merge'
      AND e.generation=3
      AND c.id=NEW.root_consolidation_id
      AND e.source_variant_id=NEW.source_variant_id
      AND e.target_variant_id=NEW.target_variant_id
      AND s.is_active=0 AND k.is_active=1
      AND s.product_id=c.product_id AND k.product_id=c.product_id
      AND EXISTS(
        SELECT 1 FROM catalog_variant_merge_generation_events undo
        JOIN catalog_variant_zero_stock_undo_validations uv ON uv.generation_event_id=undo.id
        WHERE undo.root_consolidation_id=c.id AND undo.source_variant_id=s.id
          AND undo.generation=2 AND undo.event_kind='undo' AND uv.passed=1
      )
      AND NOT EXISTS(
        SELECT 1 FROM inventory_stock st WHERE st.variant_id=s.id
          AND (st.quantity IS NULL OR st.quantity<>0
            OR st.reserved_quantity IS NULL OR st.reserved_quantity<>0)
      )
      AND NOT EXISTS(
        SELECT 1 FROM inventory_reservations r WHERE r.variant_id=s.id AND r.status='active'
      )
      AND NEW.source_stock_rows=(
        SELECT COUNT(*) FROM inventory_stock st WHERE st.variant_id=s.id
      )
  ) THEN RAISE(ABORT,'Zero-stock re-merge proof failed') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_zero_stock_remerge_immutable_update
BEFORE UPDATE ON catalog_variant_zero_stock_remerge_validations
BEGIN SELECT RAISE(ABORT,'Zero-stock re-merge proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_zero_stock_remerge_immutable_delete
BEFORE DELETE ON catalog_variant_zero_stock_remerge_validations
BEGIN SELECT RAISE(ABORT,'Zero-stock re-merge proof is immutable'); END;
