PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

DROP INDEX IF EXISTS idx_managers_active_name;
ALTER TABLE managers RENAME TO managers_step126_old;

CREATE TABLE managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT,
  phone TEXT,
  salary_base INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  color_key TEXT NOT NULL DEFAULT '#2563EB',
  hired_at TEXT,
  dismissed_at TEXT
);

INSERT INTO managers (
  id, name, is_active, created_at, updated_at, role, phone, salary_base, comment,
  color_key, hired_at, dismissed_at
)
SELECT
  old.id,
  old.name,
  old.is_active,
  old.created_at,
  old.updated_at,
  old.role,
  old.phone,
  COALESCE(old.salary_base, 0),
  old.comment,
  CASE ((old.id - 1) % 12)
    WHEN 0 THEN '#2563EB'
    WHEN 1 THEN '#7C3AED'
    WHEN 2 THEN '#0F766E'
    WHEN 3 THEN '#C2410C'
    WHEN 4 THEN '#A21CAF'
    WHEN 5 THEN '#0369A1'
    WHEN 6 THEN '#4338CA'
    WHEN 7 THEN '#B45309'
    WHEN 8 THEN '#BE185D'
    WHEN 9 THEN '#475569'
    WHEN 10 THEN '#0891B2'
    ELSE '#6D28D9'
  END,
  COALESCE(
    (SELECT MIN(o.order_date) FROM orders o WHERE o.manager_id = old.id),
    NULLIF(substr(old.created_at, 1, 10), ''),
    date('now')
  ),
  CASE
    WHEN COALESCE(old.is_active, 1) = 0 THEN COALESCE(NULLIF(substr(old.updated_at, 1, 10), ''), date('now'))
    ELSE NULL
  END
FROM managers_step126_old old;

DROP TABLE managers_step126_old;

CREATE INDEX IF NOT EXISTS idx_managers_active_name ON managers(is_active, name, id);
CREATE INDEX IF NOT EXISTS idx_managers_color ON managers(color_key, id);
CREATE INDEX IF NOT EXISTS idx_managers_hired_at ON managers(hired_at, id);

PRAGMA foreign_keys = ON;
PRAGMA legacy_alter_table = OFF;
