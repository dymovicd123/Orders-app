CREATE TABLE IF NOT EXISTS inventory_units (
  unit_id TEXT PRIMARY KEY,
  original_variant_id INTEGER REFERENCES catalog_variants(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('arrival','existing_stock','workshop','return','exchange','manual_review')),
  origin_ref TEXT,
  inventory_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (inventory_source IN ('warehouse','boutique','workshop','customer','unknown','none')),
  unit_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (unit_status IN ('unverified','on_hand','workshop_received','issued','return_pending','needs_review','not_stock','retired')),
  coverage_status TEXT NOT NULL DEFAULT 'unlinked'
    CHECK (coverage_status IN ('unlinked','linked','unknown','excluded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (unit_status <> 'on_hand'
    OR (variant_id IS NOT NULL AND inventory_source IN ('warehouse','boutique') AND coverage_status = 'linked')),
  CHECK (unit_status <> 'workshop_received' OR inventory_source = 'workshop')
);
CREATE INDEX IF NOT EXISTS idx_inventory_units_current
  ON inventory_units(variant_id,inventory_source,unit_status,coverage_status);
CREATE INDEX IF NOT EXISTS idx_inventory_units_origin
  ON inventory_units(origin_kind,origin_ref);
CREATE TABLE IF NOT EXISTS inventory_unit_labels (
  token TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES inventory_units(unit_id),
  label_version INTEGER NOT NULL CHECK (label_version >= 1),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  created_at TEXT NOT NULL,
  created_by TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  UNIQUE (unit_id,label_version),
  CHECK (state <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unit_labels_one_active
  ON inventory_unit_labels(unit_id) WHERE state='active';
CREATE INDEX IF NOT EXISTS idx_inventory_unit_labels_unit
  ON inventory_unit_labels(unit_id,label_version DESC);
CREATE TABLE IF NOT EXISTS inventory_unit_events (
  event_id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES inventory_units(unit_id),
  operation_key TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  order_item_id INTEGER,
  from_status TEXT,
  to_status TEXT,
  from_source TEXT,
  to_source TEXT,
  actor TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_unit
  ON inventory_unit_events(unit_id,created_at,event_id);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_operation
  ON inventory_unit_events(reference_type,reference_id);
CREATE TABLE IF NOT EXISTS barcode_print_batches (
  batch_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','opened','cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_opened_at TEXT,
  open_attempts INTEGER NOT NULL DEFAULT 0 CHECK (open_attempts >= 0)
);
CREATE TABLE IF NOT EXISTS barcode_print_batch_labels (
  batch_id TEXT NOT NULL REFERENCES barcode_print_batches(batch_id),
  label_token TEXT NOT NULL REFERENCES inventory_unit_labels(token),
  PRIMARY KEY (batch_id,label_token)
);
