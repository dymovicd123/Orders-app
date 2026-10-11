-- Stage04-B3: only isolated Branch2 TEST D1; repair future exact legacy SKU pricing.
-- The existing completion trigger is replaced atomically by D1 batch migration.
-- No event, inventory, order, payment or status backfill. Capture state unchanged.
-- A missing variant pointer can price only if one active Catalog variant exactly
-- matches all five frozen execution fields AND the linked order item product.
-- Multiple candidates, absent product link, wrong order, or unknown cost stay NULL.
-- Prerequisites: migrations 0083, 0084, 0106, 0107.


DROP TRIGGER IF EXISTS trg_workshop_settlement_completion;

CREATE TRIGGER trg_workshop_settlement_completion
AFTER UPDATE OF status ON workshop_tasks
WHEN OLD.status NOT IN ('done','ready') AND NEW.status IN ('done','ready')
 AND COALESCE((SELECT enabled FROM workshop_settlement_capture_control WHERE id=1), 0) = 1
BEGIN
  INSERT INTO workshop_settlement_events (
    event_key, event_type, business_date, occurred_at, workshop_task_id,
    order_id, order_item_id, external_order_id, product_name_snapshot,
    details_snapshot, quantity, unit_cost, amount_delta
  )
  SELECT
    'workshop:completion:' || NEW.id || ':' ||
      (SELECT COALESCE(MAX(id),0) + 1 FROM workshop_settlement_events
       WHERE workshop_task_id=NEW.id AND event_type='completion'),
    'completion', strftime('%Y-%m-%d','now','+5 hours'),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    NEW.id, NEW.order_id, NEW.order_item_id, NEW.external_order_id,
    NEW.product_name_snapshot,
    json_object('gender',NEW.gender_snapshot,'color',NEW.color_snapshot,
                'material',NEW.material_snapshot,'length',NEW.length_snapshot,
                'size',NEW.size_snapshot),
    NEW.quantity,
    resolved.unit_cost,
    CASE WHEN resolved.unit_cost IS NULL THEN NULL
         ELSE resolved.unit_cost * NEW.quantity END
  FROM (
    SELECT
      CASE
        -- A stale/mismatched direct order-item pointer must never silently
        -- borrow a price from a different order, product or variant.
        WHEN NEW.order_item_id IS NOT NULL AND oi.id IS NULL THEN NULL
        WHEN NEW.variant_id IS NOT NULL AND oi.variant_id IS NOT NULL
          AND NEW.variant_id <> oi.variant_id THEN NULL
        WHEN NEW.product_id IS NOT NULL AND NEW.product_id <> cv.product_id THEN NULL
        WHEN oi.product_id IS NOT NULL AND oi.product_id <> cv.product_id THEN NULL
        WHEN cv.id IS NULL OR cv.stock_position_id IS NULL THEN NULL
        ELSE ep.cost_price
      END AS unit_cost
    FROM (SELECT 1) AS singleton
    LEFT JOIN order_items oi
      ON oi.id = NEW.order_item_id AND oi.order_id = NEW.order_id
    LEFT JOIN catalog_variants cv ON cv.id = COALESCE(
      oi.variant_id, NEW.variant_id,
      (
        SELECT CASE WHEN COUNT(*)=1 THEN MAX(v2.id) ELSE NULL END
        FROM catalog_variants v2
        WHERE NEW.order_item_id IS NOT NULL AND oi.id=NEW.order_item_id
          AND oi.order_id=NEW.order_id AND oi.product_id IS NOT NULL
          AND oi.variant_id IS NULL AND NEW.variant_id IS NULL
          AND v2.product_id=oi.product_id
          AND v2.is_active=1 AND v2.stock_position_id IS NOT NULL
          AND UPPER(TRIM(COALESCE(v2.gender,'')))=UPPER(TRIM(COALESCE(NEW.gender_snapshot,'')))
          AND UPPER(TRIM(COALESCE(v2.color,'')))=UPPER(TRIM(COALESCE(NEW.color_snapshot,'')))
          AND UPPER(TRIM(COALESCE(v2.material,'')))=UPPER(TRIM(COALESCE(NEW.material_snapshot,'')))
          AND UPPER(TRIM(COALESCE(v2.length,'')))=UPPER(TRIM(COALESCE(NEW.length_snapshot,'')))
          AND UPPER(TRIM(COALESCE(v2.size_label,'')))=UPPER(TRIM(COALESCE(NEW.size_snapshot,'')))
      )
    )
    LEFT JOIN catalog_execution_prices ep
      ON ep.stock_position_id = cv.stock_position_id
     AND ep.category = cv.category
  ) AS resolved;
END;
