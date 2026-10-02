PRAGMA foreign_keys = ON;

-- Auth R1: introduce a dedicated case-insensitive login identity.
-- Existing legacy email-backed rows, if any, remain dormant until a login is explicitly assigned.
ALTER TABLE app_users ADD COLUMN login TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_login_nocase
  ON app_users(lower(login))
  WHERE login IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_manager_id
  ON app_users(manager_id);
