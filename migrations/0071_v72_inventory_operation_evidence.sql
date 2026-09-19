-- Stage02 Phase2A: bounded operational evidence for stock discrepancies.
-- This table does NOT represent a physical stock count and does not mutate inventory_stock.
-- It records only the portion of a confirmed outbound operation that could not be explained
-- by the tracked Physical at the moment of the operation.

CREATE TABLE IF NOT EXISTS inventory_operation_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_key TEXT NOT NULL UNIQUE,
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('shipping', 'handover', 'transfer', 'writeoff')),
  operation_reference TEXT NOT NULL,
  tracked_physical_before INTEGER NOT NULL CHECK (tracked_physical_before >= 0),
  confirmed_operation_quantity INTEGER NOT NULL CHECK (confirmed_operation_quantity > 0),
  explained_quantity INTEGER NOT NULL CHECK (explained_quantity >= 0),
  unexplained_quantity INTEGER NOT NULL CHECK (unexplained_quantity > 0),
  confirmed_by TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (explained_quantity + unexplained_quantity = confirmed_operation_quantity)
);

CREATE INDEX IF NOT EXISTS idx_inventory_operation_evidence_source_variant_time
  ON inventory_operation_evidence (inventory_source, variant_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_operation_evidence_operation
  ON inventory_operation_evidence (operation_type, operation_reference, id DESC);
