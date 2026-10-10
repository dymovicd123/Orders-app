PRAGMA foreign_keys=ON;

-- The original correction is immutable. Undo is a NEW compensating event.
CREATE TABLE IF NOT EXISTS catalog_stock_reconciliation_reversals (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_stock_reconciliation_journal(request_id),
  source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
  source_restored INTEGER NOT NULL CHECK(source_restored>=0),
  keeper_restored INTEGER NOT NULL CHECK(keeper_restored>=0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=12),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_stock_reconciliation_reversal_validations (
  request_id TEXT PRIMARY KEY REFERENCES catalog_stock_reconciliation_reversals(request_id),
  passed INTEGER NOT NULL CHECK(passed=1),
  checked_at TEXT NOT NULL
);
-- A source SKU with at least one unapplied (not undone) correction must not
-- accept NEW operational commitments before its guarded retirement.
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_order_new
BEFORE INSERT ON order_items
WHEN NEW.variant_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM catalog_stock_reconciliation_journal j
  LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
  WHERE j.source_variant_id=NEW.variant_id AND undo.request_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=NEW.variant_id))
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: создайте заказ на основной вариант'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_order_edit
BEFORE UPDATE OF variant_id,order_id,quantity ON order_items
WHEN NEW.variant_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM catalog_stock_reconciliation_journal j
  LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
  WHERE j.source_variant_id=NEW.variant_id AND undo.request_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=NEW.variant_id))
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: нельзя переназначать заказ'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_order_reopen
BEFORE UPDATE OF order_status,shipping_status ON orders
WHEN NEW.order_status='active' AND COALESCE(NEW.shipping_status,'not_sent')<>'sent'
  AND EXISTS (SELECT 1 FROM order_items oi JOIN catalog_stock_reconciliation_journal j
      ON j.source_variant_id=oi.variant_id
    LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
    WHERE oi.order_id=NEW.id AND oi.quantity>0 AND undo.request_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=j.source_variant_id))
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: нельзя возобновить заказ'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_reservation_new
BEFORE INSERT ON inventory_reservations
WHEN NEW.variant_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM catalog_stock_reconciliation_journal j
  LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
  WHERE j.source_variant_id=NEW.variant_id AND undo.request_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=NEW.variant_id))
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: резерв на старый вариант запрещён'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_reservation_edit
BEFORE UPDATE OF variant_id,status ON inventory_reservations
WHEN NEW.variant_id IS NOT NULL AND NEW.status='active' AND EXISTS (
  SELECT 1 FROM catalog_stock_reconciliation_journal j
  LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
  WHERE j.source_variant_id=NEW.variant_id AND undo.request_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=NEW.variant_id))
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: резерв на старый вариант запрещён'); END;
-- Operations changing physical stock of a pending source SKU must either be the
-- guarded correction, its compensated undo, or the guarded SKU consolidation.
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_stock_edit
BEFORE UPDATE OF quantity,reserved_quantity ON inventory_stock
WHEN OLD.variant_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM catalog_stock_reconciliation_journal j
  LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
  WHERE j.source_variant_id=OLD.variant_id AND undo.request_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=OLD.variant_id)
) AND NOT (
  EXISTS (SELECT 1 FROM catalog_stock_reconciliation_journal j
    WHERE j.source_stock_id=OLD.id AND NEW.last_source_ref='catalog-stock-reconcile:'||j.request_id)
  OR EXISTS (SELECT 1 FROM catalog_stock_reconciliation_reversals undo
    JOIN catalog_stock_reconciliation_journal j ON j.request_id=undo.request_id
    WHERE j.source_stock_id=OLD.id AND NEW.last_source_ref='catalog-stock-reconcile-undo:'||j.request_id)
  OR EXISTS (SELECT 1 FROM catalog_variant_consolidations c
    WHERE c.source_variant_id=OLD.variant_id
      AND NEW.last_source_ref='catalog-consolidation:'||c.source_variant_id||'->'||c.target_variant_id)
)
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: склад старого варианта заблокирован'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_stock_new
BEFORE INSERT ON inventory_stock
WHEN NEW.variant_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM catalog_stock_reconciliation_journal j
  LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
  WHERE j.source_variant_id=NEW.variant_id AND undo.request_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=NEW.variant_id))
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: новый приход на старый вариант запрещён'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_reconcile_stock_delete
BEFORE DELETE ON inventory_stock
WHEN OLD.variant_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM catalog_stock_reconciliation_journal j
  LEFT JOIN catalog_stock_reconciliation_reversals undo ON undo.request_id=j.request_id
  WHERE j.source_variant_id=OLD.variant_id AND undo.request_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=OLD.variant_id))
BEGIN SELECT RAISE(ABORT,'SKU ожидает завершения сверки: удаление остатка запрещено'); END;
