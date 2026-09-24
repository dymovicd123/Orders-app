PRAGMA foreign_keys = ON;

-- Stage04-ZAMMLER foundation.
-- Keep ZAMMLER inside the existing order/workshop model:
-- - delivery_type marks the workflow;
-- - workshop urgency keeps the existing urgent semantics;
-- - due time extends the existing editable due date without a second deadline system.

ALTER TABLE order_items ADD COLUMN workshop_due_time TEXT;
ALTER TABLE workshop_tasks ADD COLUMN due_time TEXT;

INSERT INTO reference_values (kind, value, is_active, sort_order, created_at, updated_at)
VALUES ('delivery_type', 'ZAMMLER', 1, 5, datetime('now'), datetime('now'))
ON CONFLICT(kind, value) DO UPDATE SET
  is_active = 1,
  sort_order = excluded.sort_order,
  updated_at = excluded.updated_at;
