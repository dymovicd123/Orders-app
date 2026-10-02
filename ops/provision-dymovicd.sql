PRAGMA foreign_keys = ON;

INSERT INTO app_users (
  email,
  login,
  password_hash,
  role,
  manager_id,
  display_name,
  is_active,
  must_change_password,
  password_updated_at,
  created_at,
  updated_at
)
SELECT
  'dymovicd@orders.invalid',
  'dymovicd',
  'pbkdf2$30000$cgudu0WS7LWnrggJ1wKTiQ$NDwxAT2m-oF9WRBmBjQZwq29TqAcCNek6vpGbAK5oqI',
  'admin',
  NULL,
  'Системный администратор',
  1,
  1,
  datetime('now'),
  datetime('now'),
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM app_users WHERE lower(login) = 'dymovicd'
);

INSERT INTO auth_audit_log (
  event_type,
  actor_user_id,
  target_user_id,
  actor_login,
  target_login,
  details,
  created_at
)
SELECT
  'auth_user_created',
  NULL,
  id,
  'system-provision',
  login,
  'role=admin; managerId=none; active=yes; temporaryPassword=yes; systemAccount=yes',
  datetime('now')
FROM app_users
WHERE lower(login) = 'dymovicd'
  AND NOT EXISTS (
    SELECT 1
    FROM auth_audit_log
    WHERE event_type = 'auth_user_created'
      AND target_login = 'dymovicd'
      AND actor_login = 'system-provision'
  )
LIMIT 1;
