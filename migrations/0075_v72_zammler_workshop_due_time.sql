PRAGMA foreign_keys = ON;

-- Stage04-ZAMMLER foundation.
-- Keep the existing order/workshop model.
-- Delivery references already live in reference_values and must not be duplicated here.
-- Due time only extends the existing editable urgent due date.

ALTER TABLE order_items ADD COLUMN workshop_due_time TEXT;
ALTER TABLE workshop_tasks ADD COLUMN due_time TEXT;
