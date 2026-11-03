-- Client3: engraving readiness belongs to an exact order item, not the whole order.
-- Existing completed engraving is preserved with the original exact text snapshot.
CREATE TABLE IF NOT EXISTS watch_engraving_item_readiness (
  order_item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
  engraving_text TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  ready_by_user_id INTEGER REFERENCES app_users(id),
  request_id TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_watch_engraving_ready_actor ON watch_engraving_item_readiness(ready_by_user_id,ready_at);
INSERT OR IGNORE INTO watch_engraving_item_readiness
  (order_item_id,engraving_text,ready_at,ready_by_user_id,request_id)
SELECT wi.order_item_id,wi.engraving_text,lj.ready_at,lj.ready_by_user_id,
  'watch-engraving-legacy:'||wi.order_item_id
FROM watch_order_item_details wi
JOIN order_items oi ON oi.id=wi.order_item_id AND oi.quantity>0
JOIN watch_logistics_jobs lj ON lj.order_id=oi.order_id
WHERE lj.status='ready' AND lj.ready_at IS NOT NULL
  AND LENGTH(TRIM(wi.engraving_text))>0;

-- Keep immutable item-level audit alongside current readiness state.
ALTER TABLE watch_logistics_events ADD COLUMN order_item_id INTEGER REFERENCES order_items(id);
