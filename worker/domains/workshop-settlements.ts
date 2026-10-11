// Stage04-C: one shared Workshop ledger (ordinary + Kaspi).
// Server-owned debt, payment and reversal logic; no user-supplied balance or date.
import { cleanText } from '../core/text.ts'

export class WorkshopSettlementError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status = 409, code = 'workshop_settlement_conflict') {
    super(message)
    this.name = 'WorkshopSettlementError'
    this.status = status
    this.code = code
  }
}

type SettlementInput = { requestId?: unknown; amount?: unknown; method?: unknown; comment?: unknown }
type ReversalInput = { reason?: unknown }
type PaymentRow = {
  id: number; event_key: string; amount_delta: number; payment_method: string | null;
  comment: string | null; actor_user_id: number | null; related_event_id: number | null;
  event_type: string; business_date: string
}

function validMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000_000) {
    throw new WorkshopSettlementError('Укажите положительную сумму выплаты в целых тенге.', 400, 'invalid_payment_amount')
  }
  return value
}

function validRequestId(value: unknown): string {
  const id = cleanText(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new WorkshopSettlementError('Для безопасной записи выплаты требуется уникальный идентификатор запроса.', 400, 'idempotency_required')
  }
  return id.toLowerCase()
}

function validatedText(value: unknown, label: string, maxLength: number, required: boolean): string {
  const result = cleanText(value)
  if (result.length > maxLength || (required && !result)) {
    throw new WorkshopSettlementError(label, 400, 'invalid_settlement_input')
  }
  return result
}

function requireActor(actorId: number): void {
  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new WorkshopSettlementError('Не удалось определить администратора.', 403, 'admin_required')
  }
}

export async function assertWorkshopSettlementSchema(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('SELECT payment_method FROM workshop_settlement_events LIMIT 1').first()
    const row = await db.prepare('SELECT enabled FROM workshop_settlement_capture_control WHERE id=1').first<{ enabled: number }>()
    if (!row) throw new Error('capture control missing')
    return Number(row.enabled) === 1
  } catch {
    throw new WorkshopSettlementError('Расчёты с цехом ещё не подготовлены. Сообщите администратору.', 503, 'workshop_settlement_schema_not_ready')
  }
}

async function findPaymentByKey(db: D1Database, key: string): Promise<PaymentRow | null> {
  return await db.prepare(
    'SELECT id,event_key,event_type,amount_delta,payment_method,comment,actor_user_id,related_event_id,business_date FROM workshop_settlement_events WHERE event_key=?'
  ).bind(key).first<PaymentRow>()
}

function assertExistingPayment(row: PaymentRow, amount: number, method: string, comment: string, actorId: number) {
  if (row.event_type !== 'payment' || row.amount_delta !== -amount
    || cleanText(row.payment_method) !== method || cleanText(row.comment) !== comment
    || Number(row.actor_user_id) !== actorId) {
    throw new WorkshopSettlementError('Этот идентификатор уже использован для другой выплаты.', 409, 'idempotency_conflict')
  }
}

export async function postWorkshopSettlementPayment(
  db: D1Database, input: SettlementInput, actorId: number
) {
  requireActor(actorId)
  const amount = validMoney(input.amount)
  const requestId = validRequestId(input.requestId)
  const method = validatedText(input.method, 'Способ выплаты слишком длинный.', 80, false)
  const comment = validatedText(input.comment, 'Комментарий к выплате слишком длинный.', 500, false)
  const eventKey = 'workshop:payment:' + requestId

  const enabled = await assertWorkshopSettlementSchema(db)
  const previous = await findPaymentByKey(db, eventKey)
  if (previous) {
    assertExistingPayment(previous, amount, method, comment, actorId)
    return { ok: true, id: previous.id, replayed: true }
  }
  if (!enabled) {
    throw new WorkshopSettlementError('Запись выплат ещё не включена. Сначала завершите настройку расчётов.', 409, 'settlements_not_active')
  }

  // One atomic conditional INSERT: the balance is read inside the same SQLite
  // write statement, so concurrent requests cannot independently spend it.
  // This is NOT SELECT -> application comparison -> unconditional INSERT.
  await db.prepare(`
    INSERT INTO workshop_settlement_events (
      event_key,event_type,business_date,occurred_at,amount_delta,
      payment_method,comment,actor_user_id
    )
    SELECT ?, 'payment', date('now','+5 hours'),
      strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, ?, ?
    WHERE (SELECT enabled FROM workshop_settlement_capture_control WHERE id=1)=1
      AND (SELECT COALESCE(SUM(amount_delta),0) FROM workshop_settlement_events) >= ?
      AND NOT EXISTS (
        SELECT 1 FROM workshop_settlement_events WHERE event_key=?
      )
  `).bind(eventKey, -amount, method || null, comment || null, actorId, amount, eventKey).run()

  const inserted = await findPaymentByKey(db, eventKey)
  if (inserted) {
    assertExistingPayment(inserted, amount, method, comment, actorId)
    return { ok: true, id: inserted.id, replayed: false }
  }
  // A different request may have won a race or a cutover may have been disabled.
  if (!(await assertWorkshopSettlementSchema(db))) {
    throw new WorkshopSettlementError('Расчёты временно выключены. Обновите страницу.', 409, 'settlements_not_active')
  }
  throw new WorkshopSettlementError('Сумма выплаты больше текущего подтверждённого долга. Обновите расчёты.', 409, 'payment_exceeds_debt')
}

export async function reverseWorkshopSettlementPayment(
  db: D1Database, paymentId: number, input: ReversalInput, actorId: number
) {
  requireActor(actorId)
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
    throw new WorkshopSettlementError('Выплата не найдена.', 404, 'payment_not_found')
  }
  const reason = validatedText(input.reason, 'Для отмены выплаты укажите причину (не менее 5 символов).', 500, true)
  if (reason.length < 5) {
    throw new WorkshopSettlementError('Для отмены выплаты укажите причину (не менее 5 символов).', 400, 'reversal_reason_required')
  }
  await assertWorkshopSettlementSchema(db)
  const key = 'workshop:payment-reversal:' + paymentId

  const existing = await findPaymentByKey(db, key)
  if (existing) {
    if (cleanText(existing.comment) !== reason) {
      throw new WorkshopSettlementError('Эта выплата уже отменена с другой причиной.', 409, 'reversal_conflict')
    }
    return { ok: true, id: existing.id, paymentId, replayed: true }
  }

  await db.prepare(`
    INSERT INTO workshop_settlement_events (
      event_key,event_type,business_date,occurred_at,
      related_event_id,amount_delta,payment_method,comment,actor_user_id
    )
    SELECT ?, 'payment_reversal', date('now','+5 hours'),
      strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      p.id, -p.amount_delta, p.payment_method, ?, ?
    FROM workshop_settlement_events p
    WHERE p.id=? AND p.event_type='payment'
      AND NOT EXISTS (
        SELECT 1 FROM workshop_settlement_events r
        WHERE r.related_event_id=p.id AND r.event_type='payment_reversal'
      )
  `).bind(key, reason, actorId, paymentId).run()

  const written = await findPaymentByKey(db, key)
  if (written) {
    if (cleanText(written.comment) !== reason) {
      throw new WorkshopSettlementError('Эта выплата уже отменена с другой причиной.', 409, 'reversal_conflict')
    }
    return { ok: true, id: written.id, paymentId, replayed: false }
  }
  const payment = await db.prepare(
    "SELECT id FROM workshop_settlement_events WHERE id=? AND event_type='payment'"
  ).bind(paymentId).first<{ id: number }>()
  if (!payment) throw new WorkshopSettlementError('Выплата не найдена.', 404, 'payment_not_found')
  throw new WorkshopSettlementError('Эта выплата уже отменена. Обновите расчёты.', 409, 'already_reversed')
}

function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    || new Date(value + 'T00:00:00Z').toISOString().slice(0,10) !== value) {
    throw new WorkshopSettlementError('Укажите корректную дату.', 400, 'invalid_date')
  }
  return value
}

// Lightweight first-screen request: no 90-day aggregation or paginated full journal.
export async function readWorkshopSettlementSummary(db: D1Database) {
  const enabled = await assertWorkshopSettlementSchema(db)
  const [totals, latest] = await Promise.all([
    db.prepare(`
      SELECT COALESCE(SUM(amount_delta),0) AS balance,
        COALESCE(SUM(CASE WHEN business_date=date('now','+5 hours')
          AND event_type='completion' THEN amount_delta ELSE 0 END),0) AS completedToday,
        COALESCE(SUM(CASE WHEN business_date=date('now','+5 hours')
          AND event_type='price_adjustment' THEN amount_delta ELSE 0 END),0) AS pricedToday,
        COALESCE(SUM(CASE WHEN business_date=date('now','+5 hours')
          AND event_type='completion_reversal' THEN amount_delta ELSE 0 END),0) AS revertedToday,
        COALESCE(SUM(CASE WHEN business_date=date('now','+5 hours')
          AND event_type='payment' THEN -amount_delta ELSE 0 END),0) AS paidToday,
        COALESCE(SUM(CASE WHEN business_date=date('now','+5 hours')
          AND event_type='payment_reversal' THEN amount_delta ELSE 0 END),0) AS reversedToday,
        (SELECT COUNT(*) FROM workshop_settlement_events c
          WHERE c.event_type='completion' AND c.amount_delta IS NULL
            AND NOT EXISTS (SELECT 1 FROM workshop_settlement_events r
              WHERE r.related_event_id=c.id AND r.event_type='completion_reversal')
            AND NOT EXISTS (SELECT 1 FROM workshop_settlement_events a
              WHERE a.related_event_id=c.id AND a.event_type='price_adjustment')
        ) AS unresolvedPrices
      FROM workshop_settlement_events
    `).first<Record<string,number>>(),
    db.prepare(`
      SELECT id,event_type,business_date,product_name_snapshot,quantity,unit_cost,
             amount_delta,payment_method,comment
      FROM workshop_settlement_events ORDER BY id DESC LIMIT 6
    `).all<Record<string,unknown>>(),
  ])
  const balance=Number(totals?.balance||0)
  return {
    ok:true, captureEnabled:enabled,
    confirmedDebt:Math.max(0,balance), correctionCredit:Math.max(0,-balance),
    unresolvedPrices:Number(totals?.unresolvedPrices||0),
    today:{
      completed:Number(totals?.completedToday||0),
      costConfirmed:Number(totals?.pricedToday||0),
      completionCorrections:Number(totals?.revertedToday||0),
      paid:Number(totals?.paidToday||0),
      paymentCorrections:Number(totals?.reversedToday||0),
    },
    recent:latest.results||[],
  }
}

export async function readWorkshopSettlementLedger(db: D1Database, url: URL) {
  const enabled = await assertWorkshopSettlementSchema(db)
  const today = new Date(Date.now() + 5 * 3600000).toISOString().slice(0,10)
  const end = validDate(url.searchParams.get('to') || today)
  const startDefault = new Date(Date.parse(end + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0,10)
  const start = validDate(url.searchParams.get('from') || startDefault)
  const range = (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000
  if (range < 0 || range > 89) {
    throw new WorkshopSettlementError('Выберите период не более 90 дней.', 400, 'invalid_period')
  }
  const scope = url.searchParams.get('scope') || 'all'
  if (!['all','work'].includes(scope)) {
    throw new WorkshopSettlementError('Некорректный тип истории.',400,'invalid_history_scope')
  }
  const beforeRaw = url.searchParams.get('beforeId')
  const beforeId = beforeRaw === null ? Number.MAX_SAFE_INTEGER : Number(beforeRaw)
  if (!Number.isSafeInteger(beforeId) || beforeId <= 0) {
    throw new WorkshopSettlementError('Некорректная страница истории.', 400, 'invalid_cursor')
  }

  const [total, opening, daily, history, todaySummary] = await Promise.all([
    db.prepare(`
      SELECT COALESCE(SUM(amount_delta),0) AS balance,
        COALESCE(SUM(CASE WHEN event_type IN ('completion','price_adjustment') THEN amount_delta ELSE 0 END),0) AS charged,
        COALESCE(SUM(CASE WHEN event_type='payment' THEN -amount_delta ELSE 0 END),0) AS paid,
        COALESCE(SUM(CASE WHEN event_type='payment_reversal' THEN amount_delta ELSE 0 END),0) AS paymentsReversed,
        (SELECT COUNT(*) FROM workshop_settlement_events c
         WHERE c.event_type='completion' AND c.amount_delta IS NULL
           AND NOT EXISTS(SELECT 1 FROM workshop_settlement_events r
             WHERE r.event_type='completion_reversal' AND r.related_event_id=c.id)
           AND NOT EXISTS(SELECT 1 FROM workshop_settlement_events a
             WHERE a.event_type='price_adjustment' AND a.related_event_id=c.id)
        ) AS unresolvedPrices
      FROM workshop_settlement_events
    `).first<Record<string, number>>(),
    db.prepare('SELECT COALESCE(SUM(amount_delta),0) AS balance FROM workshop_settlement_events WHERE business_date < ?')
      .bind(start).first<{ balance: number }>(),
    db.prepare(`
      SELECT business_date AS date,
        COALESCE(SUM(CASE WHEN event_type='completion' THEN amount_delta ELSE 0 END),0) AS completed,
        COALESCE(SUM(CASE WHEN event_type='price_adjustment' THEN amount_delta ELSE 0 END),0) AS costConfirmed,
        COALESCE(SUM(CASE WHEN event_type='completion_reversal' THEN amount_delta ELSE 0 END),0) AS completionCorrections,
        COALESCE(SUM(CASE WHEN event_type='payment' THEN -amount_delta ELSE 0 END),0) AS paid,
        COALESCE(SUM(CASE WHEN event_type='payment_reversal' THEN amount_delta ELSE 0 END),0) AS paymentCorrections,
        COALESCE(SUM(amount_delta),0) AS netChange,
        SUM(CASE WHEN event_type='completion' AND amount_delta IS NULL THEN 1 ELSE 0 END) AS unpricedNewCount
      FROM workshop_settlement_events WHERE business_date BETWEEN ? AND ?
      GROUP BY business_date ORDER BY business_date DESC
    `).bind(start,end).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT id,event_type,business_date,occurred_at,workshop_task_id,order_item_id,
        external_order_id,product_name_snapshot,quantity,unit_cost,amount_delta,
        payment_method,comment,actor_user_id,related_event_id,
        EXISTS(SELECT 1 FROM workshop_settlement_events r
          WHERE r.event_type='payment_reversal' AND r.related_event_id=e.id) AS isReversed
      FROM workshop_settlement_events e
      WHERE business_date BETWEEN ? AND ? AND id < ?
        AND (?='all' OR event_type IN ('completion','completion_reversal','price_adjustment'))
      ORDER BY id DESC LIMIT 51
    `).bind(start,end,beforeId,scope).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN event_type IN ('completion','price_adjustment')
          THEN amount_delta ELSE 0 END),0) AS completed,
        COALESCE(SUM(CASE WHEN event_type='completion_reversal'
          THEN amount_delta ELSE 0 END),0) AS completionCorrections,
        COALESCE(SUM(CASE WHEN event_type='payment'
          THEN -amount_delta ELSE 0 END),0) AS paid,
        COALESCE(SUM(CASE WHEN event_type='payment_reversal'
          THEN amount_delta ELSE 0 END),0) AS paymentCorrections
      FROM workshop_settlement_events WHERE business_date=date('now','+5 hours')
    `).first<Record<string,number>>(),
  ])
  const events = history.results || []
  const balance = Number(total?.balance || 0)
  return {
    ok: true, captureEnabled: enabled,
    balance, confirmedDebt: Math.max(0,balance),
    correctionCredit: Math.max(0,-balance),
    charged: Number(total?.charged || 0),
    paid: Number(total?.paid || 0),
    paymentsReversed: Number(total?.paymentsReversed || 0),
    unresolvedPrices: Number(total?.unresolvedPrices || 0),
    today: { completed: Number(todaySummary?.completed || 0),
      completionCorrections: Number(todaySummary?.completionCorrections || 0),
      paid: Number(todaySummary?.paid || 0),
      paymentCorrections: Number(todaySummary?.paymentCorrections || 0) },
    range: { from: start, to: end, openingBalance: Number(opening?.balance || 0) },
    days: daily.results || [],
    events: events.slice(0,50),
    hasMore: events.length > 50,
    nextBeforeId: events.length > 50 ? Number(events[49].id) : null,
  }
}
