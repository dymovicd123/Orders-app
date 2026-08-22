PRAGMA foreign_keys = ON;

-- Step 62: усиление авторизации.
-- Новые сотрудники создаются с временным паролем и должны сменить его при первом входе.
ALTER TABLE app_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_users ADD COLUMN password_updated_at TEXT;
ALTER TABLE app_users ADD COLUMN disabled_at TEXT;
