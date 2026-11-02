-- CLIENT3 ONLY. Manager-to-brand assignments require an immutable audit.
-- Never apply this file to main or branch2.
CREATE TABLE IF NOT EXISTS watch_manager_brand_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id INTEGER NOT NULL REFERENCES managers(id),
  actor_user_id INTEGER NOT NULL REFERENCES app_users(id),
  previous_brands TEXT NOT NULL,
  next_brands TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watch_manager_brand_events_manager
 ON watch_manager_brand_events(manager_id,id);
CREATE TRIGGER IF NOT EXISTS trg_watch_manager_brand_events_no_update
 BEFORE UPDATE ON watch_manager_brand_events BEGIN
 SELECT RAISE(ABORT,'immutable_watch_manager_brand_audit');
END;
CREATE TRIGGER IF NOT EXISTS trg_watch_manager_brand_events_no_delete
 BEFORE DELETE ON watch_manager_brand_events BEGIN
 SELECT RAISE(ABORT,'immutable_watch_manager_brand_audit');
END;
