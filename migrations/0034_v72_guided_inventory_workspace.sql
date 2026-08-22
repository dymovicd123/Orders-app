PRAGMA foreign_keys = ON;

-- Step 90: adult/child is part of a variant's identity.
-- The old unique index did not include category and could reject a valid pair
-- of variants that only differ by adult/child type.
DROP INDEX IF EXISTS idx_catalog_variants_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_variants_unique
  ON catalog_variants(
    product_id,
    COALESCE(category, 'adult'),
    COALESCE(gender, ''),
    COALESCE(color, ''),
    COALESCE(material, ''),
    COALESCE(length, ''),
    COALESCE(size_label, '')
  );

-- Stock rows primarily belong to a catalog variant. The old snapshot-only
-- unique index could make two valid variants conflict when their visible
-- snapshots were identical. For linked rows the stable identity is
-- (source, variant_id); snapshots remain the fallback only for legacy rows.
DROP INDEX IF EXISTS idx_inventory_stock_unique;
DROP INDEX IF EXISTS idx_inventory_stock_variant_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_variant_unique
  ON inventory_stock(inventory_source, variant_id)
  WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_unique
  ON inventory_stock(
    inventory_source,
    product_name_snapshot,
    COALESCE(gender_snapshot, ''),
    COALESCE(color_snapshot, ''),
    COALESCE(material_snapshot, ''),
    COALESCE(length_snapshot, ''),
    COALESCE(size_snapshot, '')
  )
  WHERE variant_id IS NULL;

-- A stable operation header protects manual warehouse actions from an
-- accidental double click or a network retry with the same operation id.
CREATE TABLE IF NOT EXISTS inventory_operations (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_source_type TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  comment TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_status_created
  ON inventory_operations(status, created_at);
