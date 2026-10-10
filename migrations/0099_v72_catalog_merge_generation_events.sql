PRAGMA foreign_keys=ON;

-- Append-only second-and-later generations. The UNIQUE(source_variant_id)
-- on the historical 0090 receipt is never weakened or bypassed by deleting it.
-- Generation 1 remains in catalog_variant_consolidations without backfill.
CREATE TABLE IF NOT EXISTS catalog_variant_merge_generation_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 root_consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
 source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
 target_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
 generation INTEGER NOT NULL CHECK(generation>=2),
 event_kind TEXT NOT NULL CHECK(event_kind IN ('undo','merge')),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=12 AND length(reason)<=500),
 created_by TEXT NOT NULL CHECK(length(trim(created_by))>0),
 created_at TEXT NOT NULL CHECK(length(trim(created_at))>0),
 UNIQUE(source_variant_id,generation),
 CHECK(source_variant_id<>target_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_merge_generation_root
 ON catalog_variant_merge_generation_events(root_consolidation_id,generation DESC);

-- Prevent skipping generations, wrong roots, non-alternating events, and
-- accidental cross-product re-merge. These triggers do NOT lock an active SKU;
-- they validate only an administrative append to the lifecycle journal.
CREATE TRIGGER IF NOT EXISTS trg_catalog_merge_generation_verify
BEFORE INSERT ON catalog_variant_merge_generation_events
BEGIN
 SELECT CASE WHEN julianday(NEW.created_at) IS NULL
   THEN RAISE(ABORT,'Invalid merge generation timestamp') END;
 SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM catalog_variant_consolidations c
   JOIN catalog_variants s ON s.id=NEW.source_variant_id
   JOIN catalog_variants t ON t.id=NEW.target_variant_id
   WHERE c.id=NEW.root_consolidation_id
     AND c.source_variant_id=NEW.source_variant_id
     AND c.product_id=s.product_id AND s.product_id=t.product_id
 ) THEN RAISE(ABORT,'Merge generation must preserve original product and source') END;
 SELECT CASE WHEN NEW.generation<>COALESCE((
   SELECT MAX(e.generation) FROM catalog_variant_merge_generation_events e
   WHERE e.source_variant_id=NEW.source_variant_id
 ),1)+1
 THEN RAISE(ABORT,'Merge generation must follow previous event') END;
 SELECT CASE WHEN NEW.event_kind <> CASE
    WHEN COALESCE((SELECT e.event_kind
       FROM catalog_variant_merge_generation_events e
       WHERE e.source_variant_id=NEW.source_variant_id
       ORDER BY e.generation DESC LIMIT 1),'merge')='merge'
    THEN 'undo' ELSE 'merge' END
 THEN RAISE(ABORT,'Merge and undo events must alternate') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_merge_generation_immutable_update
BEFORE UPDATE ON catalog_variant_merge_generation_events
BEGIN SELECT RAISE(ABORT,'Merge generation audit cannot be modified'); END;
CREATE TRIGGER IF NOT EXISTS trg_catalog_merge_generation_immutable_delete
BEFORE DELETE ON catalog_variant_merge_generation_events
BEGIN SELECT RAISE(ABORT,'Merge generation audit cannot be deleted'); END;

-- A READ-ONLY projection for future compensated undo and re-merge writers.
-- It does not affect existing orders/arrivals/SKU writes until those callsites
-- are migrated under their own schema-first deployment and full acceptance.
CREATE VIEW IF NOT EXISTS catalog_variant_effective_merge_lineage AS
SELECT c.source_variant_id,
       COALESCE(latest.target_variant_id,c.target_variant_id) AS target_variant_id,
       c.product_id, c.id AS root_consolidation_id,
       COALESCE(latest.generation,1) AS generation,
       COALESCE(latest.created_at,c.created_at) AS last_changed_at
FROM catalog_variant_consolidations c
JOIN catalog_variants source ON source.id=c.source_variant_id AND source.is_active=0
LEFT JOIN catalog_variant_merge_generation_events latest ON latest.id=(
  SELECT e.id FROM catalog_variant_merge_generation_events e
  WHERE e.source_variant_id=c.source_variant_id
  ORDER BY e.generation DESC LIMIT 1
)
WHERE latest.id IS NULL OR latest.event_kind='merge';
