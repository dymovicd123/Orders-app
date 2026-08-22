-- Step 44: Import / cleanup control panel

CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  title TEXT,
  details TEXT,
  stats_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_runs_created_at ON import_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_import_runs_type_status ON import_runs(run_type, status);
