-- Stage04-B: status-transition capture. Dormant by default; never backfills old jobs.
CREATE TABLE IF NOT EXISTS workshop_settlement_capture_control (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  activated_at TEXT,
  CHECK (enabled = 0 OR activated_at IS NOT NULL)
);
INSERT OR IGNORE INTO workshop_settlement_capture_control(id, enabled) VALUES (1, 0);

-- Trigger runs within the same SQLite/D1 transaction as the actual status update,
-- covering the individual PATCH, bulk PATCH and any other status-update entry points.
CREATE TRIGGER IF NOT EXISTS trg_workshop_settlement_completion
AFTER UPDATE OF status ON workshop_tasks
WHEN OLD.status NOT IN ('done','ready') AND NEW.status IN ('done','ready')
 AND COALESCE((SELECT enabled FROM workshop_settlement_capture_control WHERE id=1), 0) = 1
BEGIN
  INSERT INTO workshop_settlement_events (
    event_key, event_type, business_date, occurred_at, workshop_task_id, order_id,
    external_order_id, product_name_snapshot, details_snapshot, quantity, unit_cost, amount_delta
  ) VALUES (
    'workshop:completion:' || NEW.id || ':' ||
      (SELECT COALESCE(MAX(id),0) + 1 FROM workshop_settlement_events
       WHERE workshop_task_id=NEW.id AND event_type='completion'),
    'completion', strftime('%Y-%m-%d','now','+5 hours'),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    NEW.id, NEW.order_id, NEW.external_order_id, NEW.product_name_snapshot,
    json_object('gender',NEW.gender_snapshot,'color',NEW.color_snapshot,
                'material',NEW.material_snapshot,'length',NEW.length_snapshot,
                'size',NEW.size_snapshot),
    NEW.quantity, NULL, NULL
  );
END;

-- Reversal still works if capture is turned off after an event was previously posted.
-- Historic tasks without an event do not get artificial reversals.
CREATE TRIGGER IF NOT EXISTS trg_workshop_settlement_completion_reversal
AFTER UPDATE OF status ON workshop_tasks
WHEN OLD.status IN ('done','ready') AND NEW.status NOT IN ('done','ready')
BEGIN
  INSERT INTO workshop_settlement_events (
    event_key,event_type,business_date,occurred_at,workshop_task_id,order_id,
    external_order_id,product_name_snapshot,related_event_id,amount_delta
  )
  SELECT 'workshop:completion-reversal:' || c.id, 'completion_reversal',
    strftime('%Y-%m-%d','now','+5 hours'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    NEW.id, NEW.order_id, NEW.external_order_id, NEW.product_name_snapshot,
    c.id,
    CASE WHEN c.amount_delta IS NULL AND NOT EXISTS (
      SELECT 1 FROM workshop_settlement_events a
      WHERE a.related_event_id=c.id AND a.event_type='price_adjustment'
    ) THEN NULL
    ELSE -(COALESCE(c.amount_delta,0) + COALESCE((
      SELECT SUM(a.amount_delta) FROM workshop_settlement_events a
      WHERE a.related_event_id=c.id AND a.event_type='price_adjustment'
    ),0)) END
  FROM workshop_settlement_events c
  WHERE c.workshop_task_id=NEW.id AND c.event_type='completion'
    AND NOT EXISTS (
      SELECT 1 FROM workshop_settlement_events r
      WHERE r.related_event_id=c.id AND r.event_type='completion_reversal'
    )
  ORDER BY c.id DESC LIMIT 1;
END;
