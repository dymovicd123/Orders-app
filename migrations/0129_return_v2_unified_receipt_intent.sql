-- Experimental staged receipt choice on each mixed Return V2 line.
-- This is an immutable operator intent, NOT evidence that stock was received.
-- The existing returned-item intake service is the only owner of physical +1.
ALTER TABLE return_v2_unified_lines
 ADD COLUMN receipt_intent TEXT NOT NULL DEFAULT 'pending'
 CHECK(receipt_intent IN ('pending','warehouse','boutique','no_stock','not_applicable'));
CREATE INDEX IF NOT EXISTS idx_return_v2_unified_lines_receipt
 ON return_v2_unified_lines(posting_id,action,receipt_intent);
