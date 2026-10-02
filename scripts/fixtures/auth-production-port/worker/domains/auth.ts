// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { json, readJson } from '../core/http.ts'
import { getAppSetting, setAppSetting } from '../core/settings.ts'
import { cleanText, isEnabledFlag, toInt } from '../core/text.ts'
import type { AuthUser, Env } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'

export function normalizeAccessRole(value: unknown) {
  const text = cleanText(value).toLowerCase();
  return text === 'admin' || text === 'админ' ? 'admin' : 'manager';
}


export function requireAdminAccess(request: Request) {
  if (normalizeAccessRole(request.headers.get('X-Access-Role')) !== 'admin') {
    return json({ ok: false, message: 'Действие доступно только в админ-режиме.' }, { status: 403 });
  }
  return null;
}


export function isDiagnosticsEnabled(env: Env) {
  return isEnabledFlag(env.DIAGNOSTICS_ENABLED);
}


export function normalizeAuthRole(value: unknown): 'admin' | 'manager' {
  return normalizeAccessRole(value);
}


export function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}


export function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}


export function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}


export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}


export const PASSWORD_HASH_ITERATIONS = 12000;

export const MAX_EDGE_PASSWORD_VERIFY_ITERATIONS = 30000;


export async function hashPassword(password: string) {
  const iterations = PASSWORD_HASH_ITERATIONS;
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}


export function passwordHashNeedsEdgeReset(storedHash: string) {
  const parts = cleanText(storedHash).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = toInt(parts[1], 0);
  return iterations > MAX_EDGE_PASSWORD_VERIFY_ITERATIONS;
}


export async function verifyPassword(password: string, storedHash: string) {
  const parts = cleanText(storedHash).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = toInt(parts[1], 0);
  if (!iterations || iterations > MAX_EDGE_PASSWORD_VERIFY_ITERATIONS) return false;
  const salt = fromBase64Url(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  const actual = base64Url(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < actual.length; index += 1) diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0;
}


export function readCookie(request: Request, name: string) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}


export function makeSessionCookie(request: Request, token: string, maxAgeSeconds: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `orders_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}



export const SIMPLE_ADMIN_COOKIE = 'orders_admin_mode';

export const SIMPLE_ADMIN_PASSWORD_HASH_SETTING = 'admin_mode_password_hash';


export function makeSimpleCookie(request: Request, name: string, value: string, maxAgeSeconds: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}


export function getAdminModeLogin(env: Env) {
  return cleanText(env.ADMIN_MODE_LOGIN || 'admin').toLowerCase() || 'admin';
}


export function getAdminModePassword(env: Env) {
  return cleanText(env.ADMIN_MODE_PASSWORD || 'admin') || 'admin';
}


export async function hasSimpleAdminMode(request: Request, env: Env) {
  const token = readCookie(request, SIMPLE_ADMIN_COOKIE);
  const secret = cleanText(env.ADMIN_MODE_SESSION_SECRET);
  if (!token || secret.length < 32) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return false;
    const expiresAt = Number(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + (60 * 60 * 12) + 60) return false;
    const payload = parts.slice(0, 3).join('.');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(parts[3]),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}


export async function makeSimpleAccessUser(request: Request, env: Env): Promise<AuthUser> {
  const isAdminMode = await hasSimpleAdminMode(request, env);
  return {
    id: 0,
    email: isAdminMode ? 'admin' : 'manager',
    role: isAdminMode ? 'admin' : 'manager',
    managerId: null,
    managerName: null,
    displayName: isAdminMode ? 'Админ режим' : 'Рабочий режим',
    mustChangePassword: false,
  };
}


export async function handleSimpleAdminStatus(env: Env, request: Request) {
  const user = await makeSimpleAccessUser(request, env);
  return json({ ok: true, isAdmin: user.role === 'admin', role: user.role, user: authUserPayload(user) });
}


export async function verifySimpleAdminPassword(db: D1Database, env: Env, password: string) {
  const storedHash = await getAppSetting(db, SIMPLE_ADMIN_PASSWORD_HASH_SETTING, '');
  if (storedHash) {
    if (passwordHashNeedsEdgeReset(storedHash)) return false;
    return verifyPassword(password, storedHash);
  }
  const storedPasswordRequired = (await getAppSetting(db, 'require_stored_admin_password', '0')) === '1';
  if (storedPasswordRequired) return false;
  return password === getAdminModePassword(env);
}


export async function handleSimpleAdminLogin(db: D1Database, env: Env, request: Request) {
  const input = await readJson<{ login?: unknown; password?: unknown }>(request);
  const login = cleanText(input.login).toLowerCase();
  const password = cleanText(input.password);
  if (login !== getAdminModeLogin(env) || !(await verifySimpleAdminPassword(db, env, password))) {
    return json({ ok: false, message: 'Неверный логин или пароль админ-режима.' }, { status: 401 });
  }
  const secret = cleanText(env.ADMIN_MODE_SESSION_SECRET);
  if (secret.length < 32) {
    return json({ ok: false, message: 'Админ-режим временно недоступен: не настроена защита сессии.' }, { status: 503 });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + (60 * 60 * 12);
  const payload = `v1.${expiresAt}.${randomToken(16)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
  const response = json({ ok: true, isAdmin: true, role: 'admin', user: authUserPayload({
    id: 0,
    email: 'admin',
    role: 'admin',
    managerId: null,
    managerName: null,
    displayName: 'Админ режим',
    mustChangePassword: false,
  }) });
  response.headers.append('Set-Cookie', makeSimpleCookie(request, SIMPLE_ADMIN_COOKIE, `${payload}.${signature}`, 60 * 60 * 12));
  return response;
}


export function handleSimpleAdminLogout(request: Request) {
  const response = json({ ok: true, isAdmin: false, role: 'manager' });
  response.headers.append('Set-Cookie', makeSimpleCookie(request, SIMPLE_ADMIN_COOKIE, '', 0));
  return response;
}


export async function handleSimpleAdminPasswordChange(db: D1Database, env: Env, request: Request) {
  const input = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
  const currentPassword = cleanText(input.currentPassword);
  const newPassword = cleanText(input.newPassword);
  if (!currentPassword) return json({ ok: false, message: 'Введите текущий пароль.' }, { status: 400 });
  if (newPassword.length < 8) return json({ ok: false, message: 'Новый пароль должен быть не короче 8 символов.' }, { status: 400 });
  if (currentPassword === newPassword) return json({ ok: false, message: 'Новый пароль должен отличаться от текущего.' }, { status: 400 });
  if (!(await verifySimpleAdminPassword(db, env, currentPassword))) {
    return json({ ok: false, message: 'Текущий пароль указан неверно.' }, { status: 401 });
  }

  await setAppSetting(db, SIMPLE_ADMIN_PASSWORD_HASH_SETTING, await hashPassword(newPassword));
  await writeActivityLog(db, {
    eventType: 'admin_password_changed',
    entityType: 'access',
    title: 'Изменён пароль админ-режима',
  });
  return json({ ok: true, message: 'Пароль админ-режима изменён.' });
}


export async function ensureTableColumn(db: D1Database, table: string, column: string, definition: string) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const exists = (info.results || []).some((row) => cleanText(row.name).toLowerCase() === column.toLowerCase());
  if (!exists) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  }
}


export async function ensureAuthSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
      manager_id INTEGER REFERENCES managers(id) ON DELETE SET NULL,
      display_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_updated_at TEXT,
      disabled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users(role, is_active)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_app_sessions_token ON app_sessions(token_hash)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id)'),
  ]);
  await ensureTableColumn(db, 'app_users', 'must_change_password', 'must_change_password INTEGER NOT NULL DEFAULT 0');
  await ensureTableColumn(db, 'app_users', 'password_updated_at', 'password_updated_at TEXT');
  await ensureTableColumn(db, 'app_users', 'disabled_at', 'disabled_at TEXT');
}


export async function countAuthUsers(db: D1Database) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM app_users').first<{ count: number }>();
  return toInt(row?.count, 0);
}


export function publicAuthPath(pathname: string) {
  return pathname === '/api/admin-mode/status'
    || pathname === '/api/admin-mode/login'
    || pathname === '/api/admin-mode/logout'
    || pathname === '/api/auth/status'
    || pathname === '/api/auth/logout'
    || pathname === '/api/health';
}


export function authUserPayload(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    managerId: user.managerId,
    managerName: user.managerName,
    displayName: user.displayName,
    mustChangePassword: user.mustChangePassword,
  };
}




export async function countActiveAdmins(db: D1Database) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin' AND is_active = 1").first<{ count: number }>();
  return toInt(row?.count, 0);
}


export async function ensureCanRemoveAdminRights(db: D1Database, targetUserId: number, message = 'Нельзя убрать последнего активного администратора.') {
  const existing = await db.prepare('SELECT id, role, is_active FROM app_users WHERE id = ?').bind(targetUserId).first<any>();
  if (!existing) return json({ ok: false, message: 'Пользователь не найден.' }, { status: 404 });
  const isActiveAdmin = normalizeAuthRole(existing.role) === 'admin' && toInt(existing.is_active, 0) === 1;
  if (!isActiveAdmin) return null;
  const activeAdmins = await countActiveAdmins(db);
  if (activeAdmins <= 1) return json({ ok: false, message }, { status: 409 });
  return null;
}


export async function ensureManagerExists(db: D1Database, managerId: number | null) {
  if (!managerId) return null;
  const row = await db.prepare('SELECT id FROM managers WHERE id = ? AND is_active = 1').bind(managerId).first<{ id: number }>();
  if (!row) return json({ ok: false, message: 'Выбранный сотрудник не найден или отключён.' }, { status: 400 });
  return null;
}


export function permissionDenied(message = 'Недостаточно прав для действия.') {
  return json({ ok: false, message }, { status: 403 });
}


export function requireAdminUser(user: AuthUser | null, message = 'Действие доступно только администратору.') {
  if (!user || user.role !== 'admin') return permissionDenied(message);
  return null;
}


export async function getCurrentAuthUser(db: D1Database, request: Request): Promise<AuthUser | null> {
  const token = readCookie(request, 'orders_session');
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT u.id, u.email, u.role, u.manager_id, u.display_name, u.is_active, COALESCE(u.must_change_password, 0) AS must_change_password, m.name AS manager_name
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    LEFT JOIN managers m ON m.id = u.manager_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1
    LIMIT 1
  `).bind(tokenHash, now).first<any>();
  if (!row) return null;
  await db.prepare('UPDATE app_sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  return {
    id: toInt(row.id, 0),
    email: cleanText(row.email),
    role: normalizeAuthRole(row.role),
    managerId: row.manager_id === null || row.manager_id === undefined ? null : toInt(row.manager_id, 0),
    managerName: cleanText(row.manager_name) || null,
    displayName: cleanText(row.display_name) || cleanText(row.manager_name) || cleanText(row.email),
    mustChangePassword: Boolean(toInt(row.must_change_password, 0)),
  };
}


export async function createSession(db: D1Database, userId: number) {
  const token = randomToken();
  const tokenHash = await sha256Base64Url(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  await db.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').bind(now).run();
  await db.prepare('INSERT INTO app_sessions (user_id, token_hash, expires_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .bind(userId, tokenHash, expiresAt, now).run();
  return token;
}


export async function handleAuthStatus(db: D1Database, request: Request) {
  const [userCount, user] = await Promise.all([countAuthUsers(db), getCurrentAuthUser(db, request)]);
  return json({ ok: true, hasUsers: userCount > 0, user: user ? authUserPayload(user) : null });
}


export async function handleAuthSetup(db: D1Database, request: Request) {
  const userCount = await countAuthUsers(db);
  if (userCount > 0) return json({ ok: false, message: 'Первый администратор уже создан.' }, { status: 409 });
  const input = await readJson<{ email?: unknown; password?: unknown; displayName?: unknown }>(request);
  const email = cleanText(input.email).toLowerCase();
  const password = cleanText(input.password);
  const displayName = cleanText(input.displayName) || 'Администратор';
  if (!email.includes('@')) return json({ ok: false, message: 'Укажите почту администратора.' }, { status: 400 });
  if (password.length < 8) return json({ ok: false, message: 'Пароль должен быть не короче 8 символов.' }, { status: 400 });
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const result = await db.prepare('INSERT INTO app_users (email, password_hash, role, display_name, is_active, must_change_password, password_updated_at) VALUES (?, ?, ?, ?, 1, 0, ?)')
    .bind(email, passwordHash, 'admin', displayName, now).run();
  const userId = toInt((result.meta as any)?.last_row_id, 0);
  const token = await createSession(db, userId);
  const response = json({ ok: true, user: { id: userId, email, role: 'admin', managerId: null, managerName: null, displayName, mustChangePassword: false } }, { status: 201 });
  response.headers.append('Set-Cookie', makeSessionCookie(request, token, 60 * 60 * 24 * 14));
  return response;
}


export async function handleAuthLogin(db: D1Database, request: Request) {
  const input = await readJson<{ email?: unknown; password?: unknown }>(request);
  const email = cleanText(input.email).toLowerCase();
  const password = cleanText(input.password);
  const row = await db.prepare(`
    SELECT u.id, u.email, u.password_hash, u.role, u.manager_id, u.display_name, u.is_active, COALESCE(u.must_change_password, 0) AS must_change_password, m.name AS manager_name
    FROM app_users u
    LEFT JOIN managers m ON m.id = u.manager_id
    WHERE lower(u.email) = lower(?)
    LIMIT 1
  `).bind(email).first<any>();
  if (!row || !toInt(row.is_active, 0)) {
    return json({ ok: false, message: 'Неверная почта или пароль.' }, { status: 401 });
  }
  if (passwordHashNeedsEdgeReset(cleanText(row.password_hash))) {
    return json({ ok: false, message: 'Этот пароль был создан локально со слишком тяжёлым хэшем. Сбросьте пароль администратора через scripts\reset-prod-admin-password.cmd и войдите заново.', code: 'PASSWORD_HASH_NEEDS_RESET' }, { status: 409 });
  }
  if (!(await verifyPassword(password, cleanText(row.password_hash)))) {
    return json({ ok: false, message: 'Неверная почта или пароль.' }, { status: 401 });
  }
  const now = new Date().toISOString();
  await db.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?').bind(now, toInt(row.id, 0)).run();
  const token = await createSession(db, toInt(row.id, 0));
  const user: AuthUser = {
    id: toInt(row.id, 0),
    email: cleanText(row.email),
    role: normalizeAuthRole(row.role),
    managerId: row.manager_id === null || row.manager_id === undefined ? null : toInt(row.manager_id, 0),
    managerName: cleanText(row.manager_name) || null,
    displayName: cleanText(row.display_name) || cleanText(row.manager_name) || cleanText(row.email),
    mustChangePassword: Boolean(toInt(row.must_change_password, 0)),
  };
  const response = json({ ok: true, user: authUserPayload(user) });
  response.headers.append('Set-Cookie', makeSessionCookie(request, token, 60 * 60 * 24 * 14));
  return response;
}


export async function handleAuthLogout(db: D1Database, request: Request) {
  const token = readCookie(request, 'orders_session');
  if (token) {
    const tokenHash = await sha256Base64Url(token);
    await db.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  const response = json({ ok: true });
  response.headers.append('Set-Cookie', makeSessionCookie(request, '', 0));
  return response;
}


export async function listAuthUsers(db: D1Database) {
  const rows = await db.prepare(`
    SELECT u.id, u.email, u.role, u.manager_id, u.display_name, u.is_active, COALESCE(u.must_change_password, 0) AS must_change_password, u.created_at, u.last_login_at, m.name AS manager_name
    FROM app_users u
    LEFT JOIN managers m ON m.id = u.manager_id
    ORDER BY u.role = 'admin' DESC, lower(u.email)
  `).all<any>();
  return {
    ok: true,
    items: (rows.results || []).map((row) => ({
      id: toInt(row.id, 0),
      email: cleanText(row.email),
      role: normalizeAuthRole(row.role),
      managerId: row.manager_id === null || row.manager_id === undefined ? null : toInt(row.manager_id, 0),
      managerName: cleanText(row.manager_name),
      displayName: cleanText(row.display_name),
      isActive: Boolean(toInt(row.is_active, 0)),
      mustChangePassword: Boolean(toInt(row.must_change_password, 0)),
      createdAt: cleanText(row.created_at),
      lastLoginAt: cleanText(row.last_login_at),
    })),
  };
}


export async function createAuthUser(db: D1Database, request: Request) {
  const input = await readJson<{ email?: unknown; password?: unknown; role?: unknown; managerId?: unknown; displayName?: unknown; isActive?: unknown }>(request);
  const email = cleanText(input.email).toLowerCase();
  const password = cleanText(input.password);
  const role = normalizeAuthRole(input.role || 'manager');
  const managerId = toInt(input.managerId, 0) || null;
  const managerError = await ensureManagerExists(db, managerId);
  if (managerError) return managerError;
  const displayName = cleanText(input.displayName);
  const isActive = input.isActive === false ? 0 : 1;
  if (!email.includes('@')) return json({ ok: false, message: 'Укажите почту пользователя.' }, { status: 400 });
  if (password.length < 8) return json({ ok: false, message: 'Пароль должен быть не короче 8 символов.' }, { status: 400 });
  const passwordHash = await hashPassword(password);
  try {
    const now = new Date().toISOString();
    const result = await db.prepare('INSERT INTO app_users (email, password_hash, role, manager_id, display_name, is_active, must_change_password, password_updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .bind(email, passwordHash, role, managerId, displayName, isActive, now).run();
    return json({ ok: true, id: toInt((result.meta as any)?.last_row_id, 0) }, { status: 201 });
  } catch (error) {
    return json({ ok: false, message: 'Пользователь с такой почтой уже существует.' }, { status: 409 });
  }
}


export async function updateAuthUser(db: D1Database, userId: number, request: Request, currentUser: AuthUser) {
  const input = await readJson<{ email?: unknown; password?: unknown; role?: unknown; managerId?: unknown; displayName?: unknown; isActive?: unknown; mustChangePassword?: unknown }>(request);
  const existing = await db.prepare('SELECT id, email, role, is_active FROM app_users WHERE id = ?').bind(userId).first<any>();
  if (!existing) return json({ ok: false, message: 'Пользователь не найден.' }, { status: 404 });
  const now = new Date().toISOString();
  const patches: string[] = [];
  const values: unknown[] = [];
  const existingRole = normalizeAuthRole(existing.role);
  const existingActive = toInt(existing.is_active, 0) === 1;
  const nextRole = input.role !== undefined ? normalizeAuthRole(input.role) : existingRole;
  const nextActive = input.isActive !== undefined ? input.isActive !== false : existingActive;
  if (existingRole === 'admin' && existingActive && (nextRole !== 'admin' || !nextActive)) {
    const lastAdminDenied = await ensureCanRemoveAdminRights(db, userId);
    if (lastAdminDenied) return lastAdminDenied;
  }
  if (input.email !== undefined) {
    const email = cleanText(input.email).toLowerCase();
    if (!email.includes('@')) return json({ ok: false, message: 'Укажите корректную почту.' }, { status: 400 });
    patches.push('email = ?');
    values.push(email);
  }
  if (input.password !== undefined && cleanText(input.password)) {
    const password = cleanText(input.password);
    if (password.length < 8) return json({ ok: false, message: 'Пароль должен быть не короче 8 символов.' }, { status: 400 });
    patches.push('password_hash = ?');
    values.push(await hashPassword(password));
    patches.push('password_updated_at = ?');
    values.push(now);
    patches.push('must_change_password = ?');
    values.push(currentUser.id === userId ? 0 : 1);
  }
  if (input.role !== undefined) {
    patches.push('role = ?');
    values.push(nextRole);
  }
  if (input.managerId !== undefined) {
    const managerId = toInt(input.managerId, 0) || null;
    const managerError = await ensureManagerExists(db, managerId);
    if (managerError) return managerError;
    patches.push('manager_id = ?');
    values.push(managerId);
  }
  if (input.displayName !== undefined) {
    patches.push('display_name = ?');
    values.push(cleanText(input.displayName));
  }
  if (input.isActive !== undefined) {
    const nextActive = input.isActive === false ? 0 : 1;
    if (currentUser.id === userId && nextActive === 0) return json({ ok: false, message: 'Нельзя отключить свой текущий аккаунт.' }, { status: 400 });
    patches.push('is_active = ?');
    values.push(nextActive);
    patches.push('disabled_at = ?');
    values.push(nextActive ? null : now);
  }
  if (input.mustChangePassword !== undefined && currentUser.id !== userId) {
    patches.push('must_change_password = ?');
    values.push(input.mustChangePassword === false ? 0 : 1);
  }
  if (!patches.length) return json({ ok: true, id: userId });
  patches.push('updated_at = ?');
  values.push(now);
  values.push(userId);
  await db.prepare(`UPDATE app_users SET ${patches.join(', ')} WHERE id = ?`).bind(...values).run();
  if (input.password !== undefined || input.isActive === false) {
    await db.prepare('DELETE FROM app_sessions WHERE user_id = ? AND user_id <> ?').bind(userId, currentUser.id).run();
  }
  return json({ ok: true, id: userId });
}


export async function handleAuthChangePassword(db: D1Database, request: Request, currentUser: AuthUser) {
  const input = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
  const currentPassword = cleanText(input.currentPassword);
  const newPassword = cleanText(input.newPassword);
  if (newPassword.length < 8) return json({ ok: false, message: 'Новый пароль должен быть не короче 8 символов.' }, { status: 400 });
  if (currentPassword === newPassword) return json({ ok: false, message: 'Новый пароль должен отличаться от текущего.' }, { status: 400 });
  const row = await db.prepare('SELECT id, password_hash FROM app_users WHERE id = ? AND is_active = 1').bind(currentUser.id).first<any>();
  if (!row || !(await verifyPassword(currentPassword, cleanText(row.password_hash)))) {
    return json({ ok: false, message: 'Текущий пароль указан неверно.' }, { status: 401 });
  }
  const now = new Date().toISOString();
  await db.prepare('UPDATE app_users SET password_hash = ?, must_change_password = 0, password_updated_at = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(newPassword), now, now, currentUser.id).run();
  await db.prepare('DELETE FROM app_sessions WHERE user_id = ? AND token_hash <> ?')
    .bind(currentUser.id, await sha256Base64Url(readCookie(request, 'orders_session'))).run();
  const updatedUser = { ...currentUser, mustChangePassword: false };
  return json({ ok: true, user: authUserPayload(updatedUser), message: 'Пароль изменён.' });
}


export async function deleteAuthUser(db: D1Database, userId: number, currentUser: AuthUser) {
  if (currentUser.id === userId) return json({ ok: false, message: 'Нельзя удалить свой текущий аккаунт.' }, { status: 400 });
  const lastAdminDenied = await ensureCanRemoveAdminRights(db, userId, 'Нельзя удалить последнего активного администратора.');
  if (lastAdminDenied) return lastAdminDenied;
  await db.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM app_users WHERE id = ?').bind(userId).run();
  return json({ ok: true, id: userId });
}


export function withAuthenticatedHeaders(request: Request, user: AuthUser) {
  const headers = new Headers(request.headers);
  const actor = user.displayName || user.email;
  headers.set('X-Access-Role', user.role);
  headers.set('X-Access-Email', user.email);
  headers.set('X-Access-User', actor);
  headers.set('X-Archive-Actor', actor);
  return new Request(request, { headers });
}
