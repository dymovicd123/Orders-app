-- Stage03-H6H: preserve explicit order pricing generation in compact retained history.
-- Existing retained rows are historical legacy orders; default classification is additive, not financial backfill.

ALTER TABLE retained_order_summaries
  ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'legacy_manual_total'
  CHECK (pricing_mode IN ('legacy_manual_total', 'itemized_v1'));
