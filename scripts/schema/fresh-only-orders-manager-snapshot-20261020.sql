-- STRICT FRESH-ONLY schema parity gap. Derived by SELECT-only production schema
-- inspection 2026-10-20 (GH Actions 39465177349). Not for existing D1.
-- Invoker MUST assert empty orders before applying.
ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT;
