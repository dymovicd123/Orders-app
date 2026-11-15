-- Final independent capability for the additive Return V2 action journal.
-- Both customer-cancellation actions keep no physical or reserved quantity.
-- No legacy table is altered, renamed or dropped.
CREATE INDEX IF NOT EXISTS idx_return_v2_unified_action_override_item
  ON return_v2_unified_action_overrides(order_item_id);
