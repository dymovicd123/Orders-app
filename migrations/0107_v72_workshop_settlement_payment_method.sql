-- Stage04-C: store the actual payment method separately from free-form comments.
-- The journal remains immutable; this schema adds NO financial rows or historical backfill.
-- Applied only to the isolated Branch2 D1 after a prerequisite/fingerprint gate.
ALTER TABLE workshop_settlement_events ADD COLUMN payment_method TEXT;
CREATE INDEX IF NOT EXISTS idx_workshop_settlement_payment_events
  ON workshop_settlement_events(event_type, id DESC)
  WHERE event_type IN ('payment','payment_reversal');
