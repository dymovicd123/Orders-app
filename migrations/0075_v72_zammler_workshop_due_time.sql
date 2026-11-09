PRAGMA foreign_keys = ON;

-- CLIENT-ZAMMLER: extend the existing order/workshop model only.
-- The existing Cyrillic ЗАММЛЕР delivery reference is reused and is not seeded here.
-- Due time is an additive editable field alongside the existing Workshop due date.

ALTER TABLE order_items ADD COLUMN workshop_due_time TEXT;
ALTER TABLE workshop_tasks ADD COLUMN due_time TEXT;
