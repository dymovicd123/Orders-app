PRAGMA foreign_keys = ON;

-- Step 22: простая модель доступа: только Админ и Менеджер.
-- Администратор/administrator/admin приводятся к роли "Админ".
-- Все остальные рабочие роли приводятся к "Менеджер", чтобы не усложнять систему.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE managers
SET role = 'Админ', updated_at = datetime('now')
WHERE UPPER(COALESCE(role, '')) LIKE '%АДМИН%'
   OR UPPER(COALESCE(role, '')) LIKE '%ADMIN%'
   OR UPPER(COALESCE(name, '')) LIKE '%СЫМБАТ%';

UPDATE managers
SET role = 'Менеджер', updated_at = datetime('now')
WHERE COALESCE(role, '') = ''
   OR role NOT IN ('Админ', 'Менеджер');

INSERT INTO app_settings (key, value, updated_at)
VALUES ('access_model', 'admin_manager_v1', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
