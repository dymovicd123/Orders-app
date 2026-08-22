// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText } from './text.ts'

export async function getAppSetting(db: D1Database, key: string, fallback = '') {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').bind(key).first<{ value: string }>();
  return cleanText(row?.value) || fallback;
}


export async function setAppSetting(db: D1Database, key: string, value: string) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, now).run();
  return value;
}


export async function deleteAppSetting(db: D1Database, key: string) {
  await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(key).run();
}
