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
  AND LENGTH(TRIM(wi.engraving_text))>0
  -- A legacy order-wide "ready" did NOT prove which of several engravings
  -- was actually completed. Only safely inherit a single engraved line.
  AND (SELECT COUNT(*) FROM order_items sibling
       JOIN watch_order_item_details si ON si.order_item_id=sibling.id
       WHERE sibling.order_id=oi.order_id AND sibling.quantity>0
         AND LENGTH(TRIM(si.engraving_text))>0)=1;

-- Legacy multi-line orders need line-by-line reconfirmation. Rewriting an
-- old aggregate "ready" into an accurate pending status does NOT write
-- stock, shipments, payments, customers, or order items.
UPDATE watch_logistics_jobs AS lj
SET status='engraving',ready_at=NULL,ready_request_id=NULL,updated_at=datetime('now')
WHERE lj.status='ready'
  AND EXISTS (
    SELECT 1 FROM order_items oi
    JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
    LEFT JOIN watch_engraving_item_readiness confirmed
      ON confirmed.order_item_id=oi.id AND confirmed.engraving_text=wi.engraving_text
    WHERE oi.order_id=lj.order_id AND oi.quantity>0
      AND LENGTH(TRIM(wi.engraving_text))>0
      AND confirmed.order_item_id IS NULL
  );

-- Keep immutable item-level audit alongside current readiness state.
ALTER TABLE watch_logistics_events ADD COLUMN order_item_id INTEGER REFERENCES order_items(id);
