// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText } from './text.ts'

export function mapSqlRows<T = any>(result: D1Result<T>) {
  return (result.results || []) as T[];
}


export function chunksOf<T>(items: T[], size = 40) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}


export function sqlQuestionMarks(count: number) {
  return Array.from({ length: count }, () => '?').join(', ');
}


export async function readTableColumnSet(db: D1Database, tableName: string) {
  const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const info = await db.prepare(`PRAGMA table_info(${safeTableName})`).all<{ name: string }>();
  return new Set((info.results || []).map(row => cleanText((row as any).name).toLowerCase()));
}


export async function bindInChunks<T extends Record<string, unknown>>(
  db: D1Database,
  sqlPrefix: string,
  values: Array<string | number>,
  sqlSuffix = '',
  chunkSize = 80,
) {
  const results: T[] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db.prepare(`${sqlPrefix}${placeholders}${sqlSuffix}`).bind(...chunk).all<T>();
    results.push(...(result.results || []));
  }
  return results;
}
