PRAGMA foreign_keys = ON;

-- Step 11: перенос старых рабочих модулей: команда, лиды, Call Centre, планы.
-- Колонки менеджеров используются как облегчённая таблица сотрудников.
ALTER TABLE managers ADD COLUMN role TEXT;
ALTER TABLE managers ADD COLUMN phone TEXT;
ALTER TABLE managers ADD COLUMN salary_base INTEGER NOT NULL DEFAULT 0;
ALTER TABLE managers ADD COLUMN comment TEXT;

CREATE TABLE IF NOT EXISTS lead_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_date TEXT NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES managers(id),
  accepted_count INTEGER NOT NULL DEFAULT 0,
  bad_count INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lead_date, manager_id)
);

CREATE TABLE IF NOT EXISTS call_centre_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date TEXT NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES managers(id),
  accepted_leads INTEGER NOT NULL DEFAULT 0,
  calls_made INTEGER NOT NULL DEFAULT 0,
  calls_accepted INTEGER NOT NULL DEFAULT 0,
  fake_count INTEGER NOT NULL DEFAULT 0,
  refusal_count INTEGER NOT NULL DEFAULT 0,
  potential_count INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (record_date, manager_id)
);

CREATE TABLE IF NOT EXISTS department_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  planned_amount INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_lead_records_date_manager ON lead_records(lead_date, manager_id);
CREATE INDEX IF NOT EXISTS idx_call_centre_records_date_manager ON call_centre_records(record_date, manager_id);
CREATE INDEX IF NOT EXISTS idx_department_plans_period ON department_plans(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_managers_active_name ON managers(is_active, name);
