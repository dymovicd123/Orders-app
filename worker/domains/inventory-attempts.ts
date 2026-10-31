// Stage 4.2B. Supplemental audit of HTTP attempts; ONLY committed movement and
// physical check tables establish a change in inventory. Never fabricate stock.
import { cleanText, toInt } from '../core/text.ts'

export type WarehouseAttemptOutcome = 'rejected' | 'uncertain' | 'replayed'
export type WarehouseAttemptKind = 'arrival' | 'manual_set' | 'writeoff' | 'transfer'
type Target = { source: unknown; variantId: unknown }

export async function recordWarehouseOperationAttempt(db: D1Database, event: {
  requestId: unknown; kind: WarehouseAttemptKind; outcome: WarehouseAttemptOutcome;
  reasonCode: string; message: string; actorId?: number; actor?: string;
  targets: Target[];
}) {
  // Exact source + canonical variant only. Invalid/unspecified SKU is kept for
  // request-level diagnostics with NULL variant; never as another SKU's history.
  const unique = new Map<string, { source: string | null; variantId: number | null }>()
  for (const target of event.targets.slice(0, 200)) {
    const source = cleanText(target.source)
    if (source !== 'warehouse' && source !== 'boutique') continue
    const id = Math.max(0, toInt(target.variantId, 0))
    const variantId = id || null
    unique.set(source + ':' + (variantId || 'unresolved'), { source, variantId })
  }
  if (!unique.size) unique.set('unknown', { source: null, variantId: null })
  const targets = JSON.stringify([...unique.values()])
  const now = new Date().toISOString()
  const key = crypto.randomUUID()
  // One single SQLite statement creates all source+SKU projections of this
  // HTTP attempt. A request that addresses both transfer sites appears in each
  // exact-SKU history, but cannot be mistaken for two physical movements.
  await db.prepare(
    `INSERT INTO inventory_operation_attempts (
       attempt_key,request_id,operation_type,outcome,inventory_source,variant_id,
       reason_code,reason_message,actor_user_id,actor_label,recorded_at
     )
     SELECT ?, ?, ?, ?, json_extract(value, '$.source'),
       json_extract(value, '$.variantId'), ?, ?, ?, ?, ?
     FROM json_each(?)`
  ).bind(key, cleanText(event.requestId) || null, event.kind, event.outcome,
    cleanText(event.reasonCode).slice(0, 90),
    cleanText(event.message).slice(0, 420),
    Math.max(0, toInt(event.actorId, 0)) || null,
    cleanText(event.actor).slice(0, 160) || null,
    now, targets).run()
}

export async function safelyRecordWarehouseAttempt(db: D1Database, event: Parameters<typeof recordWarehouseOperationAttempt>[1]) {
  try { await recordWarehouseOperationAttempt(db, event) }
  catch (error) {
    // Audit failure must not turn a verified committed stock movement into a
    // false HTTP failure. Report a separate server diagnostic, never fake evidence.
    console.error(JSON.stringify({ event: 'warehouse_attempt_audit_unavailable',
      operation: event.kind, requestId: cleanText(event.requestId),
      message: cleanText(error instanceof Error ? error.message : error).slice(0,250) }))
  }
}

export async function listWarehouseOperationAttempts(db: D1Database, url: URL) {
  const source = cleanText(url.searchParams.get('source'))
  const variantId = Math.max(0, toInt(url.searchParams.get('variantId'), 0))
  if (!['warehouse','boutique'].includes(source) || !variantId)
    return { ok: false, code: 'exact_sku_required', message: 'Выберите один вариант и источник для просмотра попыток.', attempts: [] }
  const beforeId = Math.max(0, toInt(url.searchParams.get('beforeId'), 0))
  const result = await db.prepare(
    `SELECT id, request_id, operation_type, outcome, inventory_source, variant_id,
            reason_code, reason_message, actor_user_id, actor_label, recorded_at
     FROM inventory_operation_attempts
     WHERE inventory_source = ? AND variant_id = ?
       AND (? = 0 OR id < ?)
     ORDER BY id DESC LIMIT 31`
  ).bind(source, variantId, beforeId, beforeId).all<Record<string, unknown>>()
  const rows = result.results || []
  const page = rows.slice(0, 30)
  return {
    ok: true, hasMore: rows.length > 30,
    nextBeforeId: page.length ? toInt(page[page.length - 1].id, 0) : null,
    attempts: page.map(row => ({
      id: toInt(row.id, 0), requestId: cleanText(row.request_id),
      operationType: cleanText(row.operation_type), outcome: cleanText(row.outcome),
      source: cleanText(row.inventory_source), variantId: toInt(row.variant_id, 0),
      reasonCode: cleanText(row.reason_code), reasonMessage: cleanText(row.reason_message),
      actorUserId: Math.max(0, toInt(row.actor_user_id, 0)) || null,
      actor: cleanText(row.actor_label) || null, recordedAt: cleanText(row.recorded_at),
    })),
  }
}
