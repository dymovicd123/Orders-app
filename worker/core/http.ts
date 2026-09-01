// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, toInt } from './text.ts'

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}


export function jsonByteLength(body: string) {
  return new TextEncoder().encode(body).byteLength;
}


export async function measuredJsonRead(label: string, task: () => Promise<unknown>) {
  const startedAt = Date.now();
  const data = await task();
  const body = JSON.stringify(data);
  console.log(JSON.stringify({
    event: 'heavy_read_metric',
    endpoint: label,
    durationMs: Date.now() - startedAt,
    responseBytes: jsonByteLength(body),
  }));
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}


export async function measuredResponseRead(label: string, task: () => Promise<Response>) {
  const startedAt = Date.now();
  const response = await task();
  console.log(JSON.stringify({
    event: 'heavy_read_metric',
    endpoint: label,
    durationMs: Date.now() - startedAt,
    status: response.status,
    responseBytes: toInt(response.headers.get('Content-Length'), 0) || null,
  }));
  return response;
}


export type PublicApiError = { status: number; message: string; code?: string };


export function publicApiError(error: unknown): PublicApiError {
  const raw = cleanText(error instanceof Error ? error.message : error || 'Unknown error');
  const lower = raw.toLowerCase();
  const explicit = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown } : null;
  const explicitStatus = toInt(explicit?.status, 0);
  const explicitCode = cleanText(explicit?.code) || undefined;

  if (error instanceof SyntaxError || lower.includes('unexpected token') && lower.includes('json')) {
    return { status: 400, message: 'Не удалось прочитать данные запроса. Обновите страницу и повторите действие.' };
  }

  if (lower.includes('foreign key constraint failed') || lower.includes('sqlite_constraint_foreignkey')) {
    return { status: 409, message: 'Операция конфликтует с уже сохранённой историей. Обновите страницу и повторите действие.' };
  }
  if (lower.includes('database is locked') || lower.includes('database busy') || lower.includes('d1_db_busy')) {
    return { status: 503, message: 'База временно занята другой операцией. Повторите действие через несколько секунд.' };
  }

  if (lower.includes("exceeded d1's free tier daily row read limit") || lower.includes('free tier daily row read limit')) {
    return {
      status: 503,
      code: 'd1_daily_read_limit',
      message: 'Cloudflare временно остановил чтение базы из-за дневного лимита. Существующие данные не повреждены; доступ возобновится после сброса лимита.',
    };
  }
  if (lower.includes("exceeded d1's free tier daily row write limit") || lower.includes('free tier daily row write limit')) {
    return {
      status: 503,
      code: 'd1_daily_write_limit',
      message: 'Cloudflare временно остановил запись в базу из-за дневного лимита. Повторите действие после сброса лимита; незавершённая операция не считается сохранённой.',
    };
  }

  const technicalDatabaseError = /\b(d1_error|sqlite_|sql logic error|no such table|no such column|too many sql variables|too many variables|too many terms|constraint failed|syntax error|failed to execute|prepare\(|bindings?\b|database error)\b/i.test(raw);
  if (technicalDatabaseError) {
    return { status: 500, message: 'Не удалось выполнить операцию с данными. Обновите страницу и повторите действие. Если ошибка повторится, сообщите администратору.' };
  }

  if (explicitStatus >= 400 && explicitStatus <= 499) {
    return { status: explicitStatus, message: raw || 'Операция отклонена.', code: explicitCode };
  }

  if (/\b(order|return|exchange|product|item|record) not found\b/i.test(raw) || /(?:^|[.!?]\s*)(?:заказ|возврат|обмен|товар|позиция|ревизия|сотрудник|клиент|складская задача|складское событие)[^.!?]{0,100}\bне найден[аоы]?\b/i.test(lower)) {
    return { status: 404, message: raw };
  }

  if (/\b(required|must be|unsupported|unknown .*kind|greater than zero)\b/i.test(raw)
    || /\b(выберите|укажите|добавьте|введите|некорректн|должен|должна|должно|требуется|хотя бы|не больше \d+|переданы противоречивые данные|повторяется в корректировке)\b/i.test(lower)) {
    return { status: 400, message: raw };
  }

  if (/\b(exceeds|already|conflict|busy)\b/i.test(raw)
    || /\b(уже|нельзя|недостаточно|доступно только|конфликт|разойд|приостанов|остановлен|отменен|отменён|завершен|завершён|архивн|возвращён|возвращен|требует проверки|требует разбора|больше текущего долга)\b/i.test(lower)) {
    return { status: 409, message: raw };
  }

  return {
    status: 500,
    message: 'Не удалось выполнить операцию. Обновите страницу и повторите действие. Если ошибка повторится, сообщите администратору.',
  };
}



export async function readJson<T extends object = Record<string, unknown>>(request: Request): Promise<T> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return {} as T;
  }
  const value: unknown = await request.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError('JSON request body must be an object.');
  }
  return value as T;
}
