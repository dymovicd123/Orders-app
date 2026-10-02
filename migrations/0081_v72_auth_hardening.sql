PRAGMA foreign_keys = ON;

-- Auth R5 hardening:
-- 1) one business employee can have at most one login account;
-- 2) persistent login-attempt throttling survives Worker restarts;
-- 3) security-relevant auth changes get their own audit trail.

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_manager_unique
  ON app_users(manager_id)
  WHERE manager_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_login_throttle (
  key_hash TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at_ms INTEGER NOT NULL,
  blocked_until_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_throttle_updated
  ON auth_login_throttle(updated_at_ms);

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  actor_login TEXT,
  target_login TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_created_at
  ON auth_audit_log(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_target
  ON auth_audit_log(target_user_id, created_at DESC);
