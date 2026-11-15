-- Additive semantic journal for workshop and unreserved customer cancellations.
-- Existing return_v2_unified_lines CHECK is left UNCHANGED. Rebuilding that
-- table is unsafe on historical Branch2 D1 with deep catalog triggers.
-- A semantic override is inserted only together with the immutable Return
-- posting, and is keyed by the same posting + exact order item.
CREATE TABLE IF NOT EXISTS return_v2_unified_action_overrides (
  posting_id INTEGER NOT NULL REFERENCES return_v2_unified_postings(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  semantic_action TEXT NOT NULL CHECK(semantic_action IN (
    'cancel_workshop_obligation','cancel_unreserved_obligation'
  )),
  PRIMARY KEY(posting_id,order_item_id)
);
