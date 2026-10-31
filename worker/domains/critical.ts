// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { json } from '../core/http.ts'
import { cleanText, toInt } from '../core/text.ts'
import { sha256Base64Url } from './auth.ts'

export type CriticalOperationRow = {
  request_id: string;
  operation_type: string;
  request_fingerprint: string;
  status: 'started' | 'completed';
  step: string;
  target_type: string | null;
  target_id: number | null;
  target_ref: string | null;
  context_json: string | null;
  response_json: string | null;
  lease_token: string | null;
  lease_until_ms: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};


export type CriticalOperationHandle = {
  requestId: string;
  operationType: string;
  fingerprint: string;
  leaseToken: string;
  row: CriticalOperationRow;
  cachedResponse: unknown | null;
};


export class CriticalOperationConflictError extends Error {
  status = 409;
  code = 'critical_operation_conflict';
  // Narrow, read-only facts for operator guidance when an order has recorded handovers.
  details?: unknown;
}


export class CriticalOperationBusyError extends Error {
  status = 409;
  code = 'critical_operation_busy';
}


export function criticalOperationErrorResponse(error: unknown) {
  if (error instanceof CriticalOperationBusyError || error instanceof CriticalOperationConflictError) {
    const details = error instanceof CriticalOperationConflictError
      && error.code === 'order_delete_physical_confirmation_required' ? error.details : undefined;
    return json({ ok: false, code: error.code, message: error.message, ...(details ? { details } : {}) }, { status: error.status });
  }
  return null;
}


export function normalizeCriticalRequestId(value: unknown) {
  const requestId = cleanText(value);
  if (!requestId) return `server-${crypto.randomUUID()}`;
  if (requestId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    throw new Error('Некорректный идентификатор операции. Обновите страницу и повторите действие.');
  }
  return requestId;
}


export function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'requestId') continue;
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    output[key] = stableJsonValue(child);
  }
  return output;
}


export function stableJsonStringify(value: unknown) {
  return JSON.stringify(stableJsonValue(value));
}


export async function criticalOperationFingerprint(operationType: string, payload: unknown) {
  return await sha256Base64Url(`${operationType}\n${stableJsonStringify(payload)}`);
}


export function parseCriticalContext<T = Record<string, unknown>>(row: CriticalOperationRow): T {
  try {
    return row.context_json ? JSON.parse(row.context_json) as T : {} as T;
  } catch {
    return {} as T;
  }
}


export async function readCriticalOperation(db: D1Database, requestId: string) {
  return await db.prepare(
    `SELECT request_id, operation_type, request_fingerprint, status, step, target_type, target_id, target_ref,
            context_json, response_json, lease_token, lease_until_ms, last_error, created_at, updated_at, completed_at
     FROM critical_operations WHERE request_id = ? LIMIT 1`
  ).bind(requestId).first<CriticalOperationRow>();
}


export async function beginCriticalOperation(
  db: D1Database,
  operationType: string,
  requestIdInput: unknown,
  payload: unknown,
  initialContext: Record<string, unknown> = {},
): Promise<CriticalOperationHandle> {
  const requestId = normalizeCriticalRequestId(requestIdInput);
  const fingerprint = await criticalOperationFingerprint(operationType, payload);
  const leaseToken = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const leaseUntil = nowMs + 45_000;

  let row = await readCriticalOperation(db, requestId);
  if (!row) {
    try {
      await db.prepare(
        `INSERT INTO critical_operations (
          request_id, operation_type, request_fingerprint, status, step, context_json,
          lease_token, lease_until_ms, created_at, updated_at
        ) VALUES (?, ?, ?, 'started', 'started', ?, ?, ?, ?, ?)`
      ).bind(
        requestId,
        operationType,
        fingerprint,
        JSON.stringify(initialContext || {}),
        leaseToken,
        leaseUntil,
        nowIso,
        nowIso,
      ).run();
    } catch {
      // A concurrent identical request may have inserted the row first. Re-read and use the
      // normal lease/fingerprint checks below instead of treating the unique race as failure.
    }
    row = await readCriticalOperation(db, requestId);
  }
  if (!row) throw new Error('Не удалось зафиксировать безопасную операцию. Повторите действие.');
  if (row.operation_type !== operationType || row.request_fingerprint !== fingerprint) {
    throw new CriticalOperationConflictError('Этот идентификатор уже использован для другого действия. Обновите страницу и повторите операцию.');
  }
  if (row.status === 'completed') {
    let cachedResponse: unknown = null;
    try { cachedResponse = row.response_json ? JSON.parse(row.response_json) : null; } catch { cachedResponse = null; }
    return { requestId, operationType, fingerprint, leaseToken: '', row, cachedResponse };
  }

  if (row.lease_token !== leaseToken) {
    const claim = await db.prepare(
      `UPDATE critical_operations
       SET lease_token = ?, lease_until_ms = ?, updated_at = ?
       WHERE request_id = ? AND status = 'started'
         AND (lease_token IS NULL OR lease_until_ms <= ?)`
    ).bind(leaseToken, leaseUntil, nowIso, requestId, nowMs).run();
    if (toInt(claim.meta?.changes, 0) <= 0) {
      throw new CriticalOperationBusyError('Эта операция уже выполняется. Подождите несколько секунд и повторите — второй экземпляр не будет создан.');
    }
    row = await readCriticalOperation(db, requestId);
    if (!row) throw new Error('Не удалось перечитать состояние безопасной операции.');
  }

  return { requestId, operationType, fingerprint, leaseToken, row, cachedResponse: null };
}


export async function refreshCriticalOperation(db: D1Database, handle: CriticalOperationHandle) {
  const row = await readCriticalOperation(db, handle.requestId);
  if (!row) throw new Error('Состояние операции потеряно. Операция остановлена без повторного создания данных.');
  handle.row = row;
  return row;
}


export async function advanceCriticalOperation(
  db: D1Database,
  handle: CriticalOperationHandle,
  step: string,
  options: { targetType?: string | null; targetId?: number | null; targetRef?: string | null; context?: Record<string, unknown> | null } = {},
) {
  const now = new Date().toISOString();
  const leaseUntil = Date.now() + 45_000;
  const contextJson = options.context === undefined ? undefined : JSON.stringify(options.context || {});
  const update = await db.prepare(
    `UPDATE critical_operations
     SET step = ?,
         target_type = CASE WHEN ? = 1 THEN ? ELSE target_type END,
         target_id = CASE WHEN ? = 1 THEN ? ELSE target_id END,
         target_ref = CASE WHEN ? = 1 THEN ? ELSE target_ref END,
         context_json = CASE WHEN ? = 1 THEN ? ELSE context_json END,
         lease_until_ms = ?, updated_at = ?, last_error = NULL
     WHERE request_id = ? AND status = 'started' AND lease_token = ?`
  ).bind(
    step,
    options.targetType !== undefined ? 1 : 0, options.targetType ?? null,
    options.targetId !== undefined ? 1 : 0, options.targetId ?? null,
    options.targetRef !== undefined ? 1 : 0, options.targetRef ?? null,
    options.context !== undefined ? 1 : 0, contextJson ?? null,
    leaseUntil, now, handle.requestId, handle.leaseToken,
  ).run();
  if (toInt(update.meta?.changes, 0) <= 0) throw new CriticalOperationBusyError('Операция была продолжена другим запросом. Обновите страницу и повторите действие.');
  await refreshCriticalOperation(db, handle);
}


export async function completeCriticalOperation(db: D1Database, handle: CriticalOperationHandle, response: unknown) {
  const now = new Date().toISOString();
  const responseJson = JSON.stringify(response ?? null);
  const update = await db.prepare(
    `UPDATE critical_operations
     SET status = 'completed', step = 'completed', response_json = ?, lease_token = NULL, lease_until_ms = 0,
         last_error = NULL, completed_at = ?, updated_at = ?
     WHERE request_id = ? AND status = 'started' AND lease_token = ?`
  ).bind(responseJson, now, now, handle.requestId, handle.leaseToken).run();
  if (toInt(update.meta?.changes, 0) <= 0) {
    const current = await readCriticalOperation(db, handle.requestId);
    if (current?.status !== 'completed') throw new CriticalOperationBusyError('Не удалось завершить безопасную операцию. Повторите действие.');
  }
  await refreshCriticalOperation(db, handle);
}


export async function failCriticalOperation(db: D1Database, handle: CriticalOperationHandle | null, error: unknown) {
  if (!handle?.leaseToken || handle.row.status === 'completed') return;
  const now = new Date().toISOString();
  const message = cleanText(error instanceof Error ? error.message : error).slice(0, 1000);
  try {
    await db.prepare(
      `UPDATE critical_operations
       SET lease_token = NULL, lease_until_ms = 0, last_error = ?, updated_at = ?
       WHERE request_id = ? AND status = 'started' AND lease_token = ?`
    ).bind(message || null, now, handle.requestId, handle.leaseToken).run();
  } catch {
    // The business error remains the important one. A failed diagnostic unlock write must not mask it.
  }
}


export async function criticalOperationEntityId(db: D1Database, requestId: string, entityType: string, entityKey: string) {
  const row = await db.prepare(
    `SELECT entity_id FROM critical_operation_entities
     WHERE request_id = ? AND entity_type = ? AND entity_key = ? LIMIT 1`
  ).bind(requestId, entityType, entityKey).first<{ entity_id: number }>();
  return toInt(row?.entity_id, 0) || null;
}


// D1 batch is atomic, but an INSERT that changes zero rows does not fail.
// Gate the *business row itself* on the current lease AND missing entity key,
// so a late owner or a concurrent duplicate cannot commit an unmapped row.
export function prepareCriticalMappedInsert(
  db: D1Database,
  sql: string,
  values: unknown[],
  handle: CriticalOperationHandle | null | undefined,
  entityType: string,
  entityKey: string,
): D1PreparedStatement {
  if (!handle) return db.prepare(sql).bind(...values);
  if (!handle.leaseToken) throw new CriticalOperationBusyError('Операция уже завершена.');
  const match = /\bVALUES\s*\(([\s?,]+)\)\s*$/i.exec(sql);
  if (!match || (match[1].match(/\?/g) || []).length !== values.length) {
    throw new Error('Критическая вставка должна иметь точное соответствие параметров.');
  }
  const guardedSql = sql.slice(0, match.index) + `SELECT ${match[1]}
    WHERE EXISTS (
      SELECT 1 FROM critical_operations
      WHERE request_id = ? AND status = 'started' AND lease_token = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM critical_operation_entities
      WHERE request_id = ? AND entity_type = ? AND entity_key = ?
    )`;
  return db.prepare(guardedSql).bind(
    ...values, handle.requestId, handle.leaseToken, handle.requestId, entityType, entityKey,
  );
}


export async function insertCriticalMappedEntity(
  db: D1Database,
  handle: CriticalOperationHandle,
  entityType: string,
  entityKey: string,
  insertStatement: D1PreparedStatement,
) {
  const existing = await criticalOperationEntityId(db, handle.requestId, entityType, entityKey);
  if (existing) return { id: existing, created: false };
  const now = new Date().toISOString();
  const [insertResult, mapResult] = await db.batch([
    insertStatement,
    db.prepare(
      `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
       SELECT ?, ?, ?, last_insert_rowid(), ?
       WHERE changes() = 1
         AND EXISTS (
           SELECT 1 FROM critical_operations
           WHERE request_id = ? AND status = 'started' AND lease_token = ?
         )`
    ).bind(handle.requestId, entityType, entityKey, now, handle.requestId, handle.leaseToken),
  ]);
  const inserted = toInt(insertResult.meta?.changes, 0);
  const mapped = toInt(mapResult.meta?.changes, 0);
  // Native D1 metadata includes trigger side effects: one direct INSERT can
  // report changes=4. The preceding SQL changes()=1 in the mapping INSERT
  // already proves exactly one direct row was inserted in this same batch.
  if (inserted >= 1 && mapped === 1) {
    const id = toInt(insertResult.meta?.last_row_id, 0);
    if (!id) throw new Error(`Не удалось безопасно определить ${entityType}.`);
    return { id, created: true };
  }
  // A missing row due to a concurrent duplicate is safe ONLY when there is
  // an established mapping; never fall back to last_insert_rowid() after
  // a zero-row insert (it may be from a previous, unrelated statement).
  if (inserted === 0 && mapped === 0) {
    const existingId = await criticalOperationEntityId(db, handle.requestId, entityType, entityKey);
    if (existingId) return { id: existingId, created: false };
    throw new CriticalOperationBusyError('Действие было перехвачено другим запросом. Обновите страницу и повторите.');
  }
  throw new Error(`Не согласованы запись и привязка ${entityType}; требуется проверка операции.`);
}


export async function updateCriticalOperationTargetFromLastInsert(
  db: D1Database,
  handle: CriticalOperationHandle,
  targetType: string,
  targetRef: string | null,
  insertStatement: D1PreparedStatement,
  nextStep: string,
) {
  const now = new Date().toISOString();
  const leaseUntil = Date.now() + 45_000;
  const [insertResult, updateResult] = await db.batch([
    insertStatement,
    db.prepare(
      `UPDATE critical_operations
       SET target_type = ?, target_id = last_insert_rowid(), target_ref = ?, step = ?, lease_until_ms = ?, updated_at = ?, last_error = NULL
       WHERE request_id = ? AND status = 'started' AND lease_token = ? AND step = 'validated' AND changes() = 1`
    ).bind(targetType, targetRef, nextStep, leaseUntil, now, handle.requestId, handle.leaseToken),
  ]);
  // D1 meta.changes includes auxiliary trigger changes (1 order INSERT may report 4).
  // SQLite changes() inside this SAME batch is the precise direct-row count and
  // guards the lease update against a zero-row/multiple-row business INSERT.
  if (toInt(insertResult.meta?.changes, 0) < 1 || toInt(updateResult.meta?.changes, 0) !== 1) {
    throw new CriticalOperationBusyError('Сохранение заказа было перехвачено другим запросом. Обновите страницу и повторите действие.');
  }
  const id = toInt(insertResult.meta?.last_row_id, 0);
  await refreshCriticalOperation(db, handle);
  const targetId = toInt(handle.row.target_id, 0);
  if (!id || !targetId || targetId !== id || handle.row.step !== nextStep || handle.row.target_type !== targetType || handle.row.target_ref !== targetRef) {
    throw new CriticalOperationBusyError('Сохранение заказа потеряло подтверждение записи. Повторите действие после обновления.');
  }
  if (targetType === 'order') {
    const proof = await db.prepare(
      'SELECT id FROM orders WHERE id = ? AND external_id = ? LIMIT 1'
    ).bind(targetId, targetRef).first<{ id: number }>();
    if (toInt(proof?.id, 0) !== targetId) throw new CriticalOperationBusyError('Связь нового заказа с безопасной операцией не подтверждена.');
  }
  return targetId;
}
