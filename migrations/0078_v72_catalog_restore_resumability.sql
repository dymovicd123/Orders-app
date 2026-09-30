PRAGMA foreign_keys = ON;

-- Catalog restore resumability / single in-flight restore per retirement.
-- Branch2 audit run 36703729894 found 0 started restore rows before this invariant.
-- A restore may be retried after interruption, but two concurrent started restores
-- for the same retirement must never create parallel working generations.

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_retirement_restores_single_started
  ON catalog_retirement_restores(retirement_id)
  WHERE status = 'started';

SELECT 'catalog restore resumability invariant ready' AS migration_marker;
