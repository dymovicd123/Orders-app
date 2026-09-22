PRAGMA foreign_keys = ON;

-- Stage03-B: current commercial prices for the confirmed pricing scope.
--
-- Confirmed business dimensions:
--   product + material + length + adult/child.
--
-- catalog_stock_positions is the canonical execution identity
-- (product + material + length) since migration 0048.
-- Audience category remains on the exact catalog combination, therefore
-- current prices are stored per execution + category.
--
-- Gender, color and exact size/child age are intentionally NOT encoded here:
-- their effect on price is still awaiting client confirmation.
--
-- No backfill is performed. Historical order_items.unit_price is a transaction
-- price and must not be reinterpreted as the current catalog price.
-- No historical cost is invented from current mutable cost either.

CREATE TABLE IF NOT EXISTS catalog_execution_prices (
  stock_position_id INTEGER NOT NULL
    REFERENCES catalog_stock_positions(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('adult', 'child')),
  cost_price INTEGER
    CHECK (cost_price IS NULL OR cost_price >= 0),
  sale_price INTEGER
    CHECK (sale_price IS NULL OR sale_price >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (stock_position_id, category)
);

SELECT 'stage03-b catalog execution prices schema ready' AS migration_marker;
