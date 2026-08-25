-- Finance traceability: support cheap lookup of the immutable money event that belongs to a payment row.
-- Additive/read-only index: no business data is rewritten.
CREATE INDEX IF NOT EXISTS idx_financial_events_source
  ON financial_events(source_type, source_id, id DESC);

PRAGMA optimize;
