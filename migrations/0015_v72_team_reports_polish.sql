PRAGMA foreign_keys = ON;

-- Step 13: полировка отчётов и дальнейшая команда.
-- Роль Сымбат должна быть Администратор.
UPDATE managers
SET role = 'Администратор', updated_at = datetime('now')
WHERE name LIKE '%СЫМБАТ%'
   OR name LIKE '%Сымбат%'
   OR name LIKE '%SYMBAT%'
   OR name LIKE '%Symbat%';

CREATE TABLE IF NOT EXISTS team_timesheet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES managers(id),
  work_until TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_date, manager_id)
);

CREATE INDEX IF NOT EXISTS idx_team_timesheet_date ON team_timesheet(work_date);
CREATE INDEX IF NOT EXISTS idx_team_timesheet_manager_date ON team_timesheet(manager_id, work_date);
