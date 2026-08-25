// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { mapSqlRows } from '../core/sql.ts'
import { cleanText, normalizeDate, toInt, upperText } from '../core/text.ts'
import type { AuthUser } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import { randomToken } from './auth.ts'

export function kazakhstanBusinessDate(now = new Date()) {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}


export function normalizeCashRequestId(value: unknown) {
  const normalized = cleanText(value).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 120);
  return normalized.length >= 8 ? normalized : '';
}


export async function getCashRegisterState(db: D1Database) {
  const today = kazakhstanBusinessDate();
  const [settings, cycleRow] = await Promise.all([
    db.prepare(
      `SELECT id, opening_amount, initialized_at, auto_tracking_enabled, activated_at, updated_at
       FROM cash_register_settings WHERE id = 1`
    ).first<any>(),
    db.prepare(
      `SELECT id, occurred_at
       FROM cash_register_entries
       WHERE entry_type = 'ledger_reset'
       ORDER BY id DESC
       LIMIT 1`
    ).first<any>(),
  ]);

  const cycleStartId = Math.max(0, toInt(cycleRow?.id, 0));
  const [totals, entriesResult, archiveRow] = await Promise.all([
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS current_balance,
         COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
         COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out,
         COALESCE(SUM(CASE WHEN business_date = ? AND direction = 'in' THEN amount ELSE 0 END), 0) AS today_in,
         COALESCE(SUM(CASE WHEN business_date = ? AND direction = 'out' THEN amount ELSE 0 END), 0) AS today_out
       FROM cash_register_entries
       WHERE id > ?`
    ).bind(today, today, cycleStartId).first<any>(),
    db.prepare(
      `SELECT e.id, e.occurred_at, e.business_date, e.direction, e.amount, e.entry_type, e.source_type,
              e.source_id, e.source_key, e.order_id, e.external_order_id, e.payment_method,
              e.comment, e.created_by, e.created_at,
              CASE WHEN e.source_type = 'manual' AND NOT EXISTS (
                SELECT 1 FROM cash_register_entries rev WHERE rev.source_key = 'manual-reversal:' || e.id
              ) THEN 1 ELSE 0 END AS reversible,
              CASE WHEN e.source_type = 'manual' AND EXISTS (
                SELECT 1 FROM cash_register_entries rev WHERE rev.source_key = 'manual-reversal:' || e.id
              ) THEN 1 ELSE 0 END AS reversed
       FROM cash_register_entries e
       WHERE e.id > ?
       ORDER BY e.id DESC
       LIMIT 400`
    ).bind(cycleStartId).all<any>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM cash_register_entries WHERE id <= ?`
    ).bind(cycleStartId).first<any>(),
  ]);

  const currentBalance = Number(totals?.current_balance || 0);
  let runningBalance = currentBalance;
  const entries = mapSqlRows(entriesResult).map((row: any) => {
    const amount = Number(row.amount || 0);
    const entry = {
      id: Number(row.id || 0),
      occurredAt: cleanText(row.occurred_at),
      businessDate: cleanText(row.business_date),
      direction: cleanText(row.direction) === 'out' ? 'out' : 'in',
      amount,
      entryType: cleanText(row.entry_type),
      sourceType: cleanText(row.source_type),
      sourceId: cleanText(row.source_id) || null,
      orderId: row.order_id == null ? null : Number(row.order_id || 0) || null,
      externalOrderId: cleanText(row.external_order_id) || null,
      paymentMethod: cleanText(row.payment_method) || null,
      comment: cleanText(row.comment) || null,
      createdBy: cleanText(row.created_by) || null,
      createdAt: cleanText(row.created_at),
      balanceAfter: runningBalance,
      reversible: toInt(row.reversible, 0) === 1,
      reversed: toInt(row.reversed, 0) === 1,
    };
    runningBalance += entry.direction === 'in' ? -amount : amount;
    return entry;
  });

  return {
    ok: true,
    initialized: Boolean(cleanText(settings?.initialized_at)),
    autoTrackingEnabled: Boolean(toInt(settings?.auto_tracking_enabled, 0)),
    initializedAt: cleanText(settings?.initialized_at) || null,
    activatedAt: cleanText(settings?.activated_at) || null,
    openingAmount: Number(settings?.opening_amount || 0),
    currentBalance,
    totalIn: Number(totals?.total_in || 0),
    totalOut: Number(totals?.total_out || 0),
    todayIn: Number(totals?.today_in || 0),
    todayOut: Number(totals?.today_out || 0),
    archivedEntriesCount: Number(archiveRow?.count || 0),
    currentCycleStartedAt: cleanText(cycleRow?.occurred_at) || null,
    entries,
  };
}


export async function setupCashRegister(db: D1Database, input: { amount?: number }, actor?: AuthUser | null) {
  const existing = await db.prepare('SELECT initialized_at FROM cash_register_settings WHERE id = 1').first<any>();
  if (cleanText(existing?.initialized_at)) {
    throw new Error('Касса уже настроена. Для изменения суммы используйте «Сверку фактического остатка».');
  }
  const amount = Math.max(0, Math.trunc(Number(input.amount || 0)));
  const timestamp = new Date().toISOString();
  const businessDate = kazakhstanBusinessDate();
  const createdBy = cleanText(actor?.displayName || actor?.email) || 'Пользователь';

  await db.batch([
    db.prepare(
      `INSERT INTO cash_register_settings (
         id, opening_amount, initialized_at, auto_tracking_enabled, activated_at, updated_at
       ) VALUES (1, ?, ?, 0, NULL, ?)`
    ).bind(amount, timestamp, timestamp),
    db.prepare(
      `INSERT INTO cash_register_entries (
         occurred_at, business_date, direction, amount, entry_type,
         source_type, source_id, source_key, order_id, external_order_id,
         payment_method, comment, created_by, created_at
       ) VALUES (?, ?, 'in', ?, 'opening', 'opening', '1', 'opening:1', NULL, NULL, NULL, ?, ?, ?)`
    ).bind(timestamp, businessDate, amount, 'Начальный фактический остаток наличных', createdBy, timestamp),
  ]);

  await writeActivityLog(db, {
    eventType: 'cash_register_initialized', entityType: 'cash_register',
    title: 'Установлен начальный остаток наличных', details: `Начальный остаток: ${amount}`, amount, createdAt: timestamp,
  });
  return getCashRegisterState(db);
}


export async function setCashAutoTracking(db: D1Database, enabled: boolean, actor?: AuthUser | null) {
  const settings = await db.prepare(
    'SELECT initialized_at, auto_tracking_enabled FROM cash_register_settings WHERE id = 1'
  ).first<any>();
  if (!cleanText(settings?.initialized_at)) throw new Error('Сначала установите фактический остаток наличных.');
  const target = enabled ? 1 : 0;
  if (toInt(settings?.auto_tracking_enabled, 0) === target) return getCashRegisterState(db);

  const timestamp = new Date().toISOString();
  await db.prepare(
    `UPDATE cash_register_settings
     SET auto_tracking_enabled = ?,
         activated_at = CASE
           WHEN ? = 1 AND COALESCE(NULLIF(TRIM(activated_at), ''), '') = '' THEN ?
           ELSE activated_at
         END,
         updated_at = ?
     WHERE id = 1`
  ).bind(target, target, timestamp, timestamp).run();
  await writeActivityLog(db, {
    eventType: enabled ? 'cash_register_auto_tracking_enabled' : 'cash_register_auto_tracking_paused',
    entityType: 'cash_register',
    title: enabled ? 'Включён автоучёт наличных' : 'Автоучёт наличных остановлен',
    details: `${enabled ? 'Включил' : 'Остановил'}: ${cleanText(actor?.displayName || actor?.email) || 'Пользователь'}`,
    createdAt: timestamp,
  });
  return getCashRegisterState(db);
}


export async function activateCashRegister(db: D1Database, actor?: AuthUser | null) {
  return setCashAutoTracking(db, true, actor);
}


export async function addManualCashRegisterMovement(
  db: D1Database,
  input: { direction?: unknown; amount?: number; comment?: string; requestId?: unknown },
  actor?: AuthUser | null,
) {
  const state = await getCashRegisterState(db);
  if (!state.initialized) throw new Error('Сначала установите начальный остаток наличных.');
  const direction = cleanText(input.direction).toLowerCase() === 'in' ? 'in' : cleanText(input.direction).toLowerCase() === 'out' ? 'out' : '';
  const amount = Math.max(0, Math.trunc(Number(input.amount || 0)));
  const comment = cleanText(input.comment);
  if (!direction) throw new Error('Выберите: внесение или выдача наличных.');
  if (amount <= 0) throw new Error('Укажите сумму больше нуля.');
  if (!comment) throw new Error('Комментарий обязателен: укажите, откуда пришли или куда ушли деньги.');
  if (direction === 'out' && amount > state.currentBalance) throw new Error(`Нельзя выдать ${amount}: в кассе по учёту ${state.currentBalance}.`);

  const timestamp = new Date().toISOString();
  const businessDate = kazakhstanBusinessDate();
  const createdBy = cleanText(actor?.displayName || actor?.email) || 'Пользователь';
  const requestId = normalizeCashRequestId(input.requestId) || `server-${Date.now()}-${randomToken(8)}`;
  const sourceKey = `manual:${requestId}`;
  const insertResult = await db.prepare(
    `INSERT OR IGNORE INTO cash_register_entries (
       occurred_at, business_date, direction, amount, entry_type,
       source_type, source_id, source_key, order_id, external_order_id,
       payment_method, comment, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, 'manual', NULL, ?, NULL, NULL, NULL, ?, ?, ?)`
  ).bind(timestamp, businessDate, direction, amount, direction === 'in' ? 'manual_in' : 'manual_out', sourceKey, comment, createdBy, timestamp).run();

  if (toInt((insertResult.meta as any)?.changes, 0) > 0) {
    await writeActivityLog(db, {
      eventType: direction === 'in' ? 'cash_manual_in' : 'cash_manual_out', entityType: 'cash_register',
      title: direction === 'in' ? 'Ручное внесение наличных' : 'Ручная выдача наличных', details: comment, amount, createdAt: timestamp,
    });
  }
  return getCashRegisterState(db);
}


export async function reconcileCashRegister(
  db: D1Database,
  input: { amount?: number; comment?: string; requestId?: unknown },
  actor?: AuthUser | null,
) {
  const state = await getCashRegisterState(db);
  if (!state.initialized) throw new Error('Сначала установите начальный остаток наличных.');
  const target = Math.max(0, Math.trunc(Number(input.amount || 0)));
  const comment = cleanText(input.comment);
  if (!comment) throw new Error('Для сверки остатка обязательно укажите причину.');
  const delta = target - state.currentBalance;
  if (delta === 0) return state;
  const direction = delta > 0 ? 'in' : 'out';
  const amount = Math.abs(delta);
  const timestamp = new Date().toISOString();
  const requestId = normalizeCashRequestId(input.requestId) || `server-${Date.now()}-${randomToken(8)}`;
  const createdBy = cleanText(actor?.displayName || actor?.email) || 'Пользователь';
  const insertResult = await db.prepare(
    `INSERT OR IGNORE INTO cash_register_entries (
       occurred_at, business_date, direction, amount, entry_type,
       source_type, source_id, source_key, order_id, external_order_id,
       payment_method, comment, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, 'reconcile', NULL, ?, NULL, NULL, NULL, ?, ?, ?)`
  ).bind(timestamp, kazakhstanBusinessDate(), direction, amount, direction === 'in' ? 'balance_adjustment_in' : 'balance_adjustment_out', `reconcile:${requestId}`, comment, createdBy, timestamp).run();
  if (toInt((insertResult.meta as any)?.changes, 0) > 0) {
    await writeActivityLog(db, {
      eventType: 'cash_register_reconciled', entityType: 'cash_register', title: 'Сверен фактический остаток наличных',
      details: `${comment}; было ${state.currentBalance}, стало ${target}`, amount, createdAt: timestamp,
    });
  }
  return getCashRegisterState(db);
}


export async function reverseManualCashRegisterMovement(db: D1Database, entryId: number, actor?: AuthUser | null) {
  const original = await db.prepare(
    `SELECT id, direction, amount, comment, source_type
     FROM cash_register_entries WHERE id = ?`
  ).bind(entryId).first<any>();
  if (!original || cleanText(original.source_type) !== 'manual') throw new Error('Можно отменить только ручное внесение или выдачу.');
  const sourceKey = `manual-reversal:${entryId}`;
  const existing = await db.prepare('SELECT id FROM cash_register_entries WHERE source_key = ?').bind(sourceKey).first<any>();
  if (existing) return getCashRegisterState(db);
  const timestamp = new Date().toISOString();
  const direction = cleanText(original.direction) === 'out' ? 'in' : 'out';
  const createdBy = cleanText(actor?.displayName || actor?.email) || 'Пользователь';
  const comment = `Отмена ручной операции: ${cleanText(original.comment) || `#${entryId}`}`;
  await db.prepare(
    `INSERT INTO cash_register_entries (
       occurred_at, business_date, direction, amount, entry_type,
       source_type, source_id, source_key, order_id, external_order_id,
       payment_method, comment, created_by, created_at
     ) VALUES (?, ?, ?, ?, 'manual_reversal', 'manual_reversal', ?, ?, NULL, NULL, NULL, ?, ?, ?)`
  ).bind(timestamp, kazakhstanBusinessDate(), direction, Math.max(0, toInt(original.amount, 0)), String(entryId), sourceKey, comment, createdBy, timestamp).run();
  await writeActivityLog(db, {
    eventType: 'cash_manual_reversed', entityType: 'cash_register', entityId: entryId,
    title: 'Отменена ручная операция кассы', details: comment, amount: Math.max(0, toInt(original.amount, 0)), createdAt: timestamp,
  });
  return getCashRegisterState(db);
}


export async function resetCashRegisterCycle(db: D1Database, input: { comment?: string }, actor?: AuthUser | null) {
  const state = await getCashRegisterState(db);
  if (!state.initialized) throw new Error('Касса ещё не настроена.');
  const comment = cleanText(input.comment);
  if (!comment) throw new Error('Укажите причину начала нового цикла.');
  const timestamp = new Date().toISOString();
  const createdBy = cleanText(actor?.displayName || actor?.email) || 'Администратор';
  const sourceKey = `reset:${Date.now()}:${randomToken(8)}`;
  await db.batch([
    db.prepare(
      `UPDATE cash_register_settings
       SET opening_amount = 0, auto_tracking_enabled = 0, activated_at = NULL, updated_at = ?
       WHERE id = 1`
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO cash_register_entries (
         occurred_at, business_date, direction, amount, entry_type,
         source_type, source_id, source_key, order_id, external_order_id,
         payment_method, comment, created_by, created_at
       ) VALUES (?, ?, 'in', 0, 'ledger_reset', 'system', NULL, ?, NULL, NULL, NULL, ?, ?, ?)`
    ).bind(timestamp, kazakhstanBusinessDate(), sourceKey, comment, createdBy, timestamp),
  ]);
  await writeActivityLog(db, {
    eventType: 'cash_register_cycle_reset', entityType: 'cash_register', title: 'Начат новый цикл учёта наличных',
    details: `${comment}; предыдущий расчётный остаток ${state.currentBalance}`, createdAt: timestamp,
  });
  return getCashRegisterState(db);
}



export async function listCashRegisterCycles(db: D1Database, url: URL) {
  const limit = Math.min(30, Math.max(5, toInt(url.searchParams.get('limit'), 12)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const result = await db.prepare(
    `WITH reset_bounds AS (
       SELECT id, occurred_at, business_date, comment, created_by,
              LAG(id, 1, 0) OVER (ORDER BY id) AS previous_reset_id
       FROM cash_register_entries
       WHERE entry_type = 'ledger_reset'
     ), page AS (
       SELECT * FROM reset_bounds ORDER BY id DESC LIMIT ? OFFSET ?
     )
     SELECT p.id, p.occurred_at, p.business_date, p.comment, p.created_by, p.previous_reset_id,
            MIN(e.occurred_at) AS started_at, MAX(e.occurred_at) AS last_entry_at, COUNT(e.id) AS entry_count,
            COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE 0 END), 0) AS total_in,
            COALESCE(SUM(CASE WHEN e.direction = 'out' THEN e.amount ELSE 0 END), 0) AS total_out,
            COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END), 0) AS closing_balance
     FROM page p
     LEFT JOIN cash_register_entries e ON e.id > p.previous_reset_id AND e.id < p.id
     GROUP BY p.id, p.occurred_at, p.business_date, p.comment, p.created_by, p.previous_reset_id
     ORDER BY p.id DESC`
  ).bind(limit + 1, offset).all<Record<string, unknown>>();
  const rawRows = result.results || [];
  const page = rawRows.slice(0, limit);
  return {
    ok: true,
    cycles: page.map(row => ({
      id: toInt(row.id, 0),
      startedAt: cleanText(row.started_at) || null,
      closedAt: cleanText(row.occurred_at),
      closedBusinessDate: cleanText(row.business_date),
      closedBy: cleanText(row.created_by) || null,
      closeComment: cleanText(row.comment) || null,
      entryCount: Math.max(0, toInt(row.entry_count, 0)),
      totalIn: Number(row.total_in || 0),
      totalOut: Number(row.total_out || 0),
      closingBalance: Number(row.closing_balance || 0),
    })),
    hasMore: rawRows.length > limit,
    offset,
    limit,
  };
}



export function moneyHistoryOperationLabel(eventType: string, relatedType: string, reason: string) {
  if (eventType === 'order_payment') return reason === 'order_edit_new' ? 'Исправленная оплата' : 'Оплата заказа';
  if (eventType === 'debt_close') return reason === 'order_edit_new' ? 'Исправленное закрытие долга' : 'Закрытие долга';
  if (eventType === 'order_extra') return reason === 'order_edit_new' ? 'Исправленное закрытие долга (старый тип)' : 'Закрытие долга (старый тип)';
  if (eventType === 'exchange_extra') return 'Доплата по обмену';
  if (eventType === 'order_refund') return 'Возврат клиенту';
  if (eventType === 'exchange_refund') return 'Возврат по обмену';
  if (eventType === 'refund_reversal') return relatedType === 'exchange_refund' ? 'Отмена возврата по обмену' : 'Отмена возврата';
  if (eventType === 'payment_reversal') {
    if (relatedType === 'exchange_extra') return 'Отмена доплаты по обмену';
    if (relatedType === 'debt_close') return 'Исправление закрытия долга';
    if (reason === 'order_delete') return 'Оплата снята при удалении заказа';
    return 'Исправление оплаты';
  }
  return 'Денежная операция';
}


export async function listFinancialHistory(db: D1Database, url: URL) {
  const limit = Math.min(100, Math.max(20, toInt(url.searchParams.get('limit'), 50)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const query = upperText(url.searchParams.get('q'));
  const dateFromRaw = cleanText(url.searchParams.get('dateFrom'));
  const dateToRaw = cleanText(url.searchParams.get('dateTo'));
  const dateFrom = dateFromRaw ? normalizeDate(dateFromRaw) : '';
  const dateTo = dateToRaw ? normalizeDate(dateToRaw) : '';
  const legacyType = cleanText(url.searchParams.get('type')).toLowerCase();
  const flow = cleanText(url.searchParams.get('flow')).toLowerCase()
    || (legacyType === 'in' || legacyType === 'out' ? legacyType : 'all');
  const operation = cleanText(url.searchParams.get('operation')).toLowerCase()
    || (legacyType === 'refund' || legacyType === 'correction' ? legacyType : 'all');
  const trace = cleanText(url.searchParams.get('trace')).toLowerCase() || 'all';
  const currentMonthStart = `${kazakhstanBusinessDate().slice(0, 7)}-01`;
  const includeLegacy = cleanText(url.searchParams.get('includeLegacy')) === '1'
    && Boolean(dateFrom)
    && dateFrom < currentMonthStart;
  const where: string[] = [];
  const bindings: unknown[] = [];
  const legacySql = `(fe.is_backfill = 1 OR COALESCE(fe.reason, '') = 'baseline')`;
  const backdatedCreateInfoSql = `(
    fe.event_type = 'order_payment'
    AND o.id IS NOT NULL
    AND fe.event_date > o.order_date
    AND COALESCE(fe.reason, '') = 'order_create'
    AND substr(COALESCE(o.created_at, ''), 1, 10) = fe.event_date
    AND substr(COALESCE(fe.event_at, ''), 1, 10) = fe.event_date
  )`;
  const reviewSql = `(
    NOT ${legacySql}
    AND fe.event_type = 'order_payment'
    AND o.id IS NOT NULL
    AND (
      fe.event_date < o.order_date
      OR (fe.event_date > o.order_date AND NOT ${backdatedCreateInfoSql})
    )
  )`;
  const infoSql = `(
    ${legacySql}
    OR fe.event_type IN ('payment_reversal', 'refund_reversal')
    OR (fe.event_type = 'order_payment' AND o.id IS NULL)
    OR ${backdatedCreateInfoSql}
  )`;

  if (dateFrom) { where.push('fe.event_date >= ?'); bindings.push(dateFrom); }
  if (dateTo) { where.push('fe.event_date <= ?'); bindings.push(dateTo); }
  if (!includeLegacy) where.push(`NOT ${legacySql}`);
  if (query) {
    where.push(`(
      INSTR(UPPER(COALESCE(fe.external_order_id, '')), ?) > 0 OR
      INSTR(UPPER(COALESCE(fe.payment_method, '')), ?) > 0 OR
      INSTR(UPPER(COALESCE(fe.comment, '')), ?) > 0 OR
      INSTR(UPPER(COALESCE(fe.reason, '')), ?) > 0 OR
      INSTR(UPPER(COALESCE(fe.event_type, '')), ?) > 0
    )`);
    bindings.push(query, query, query, query, query);
  }
  if (flow === 'in') where.push('fe.amount_delta > 0');
  else if (flow === 'out') where.push('fe.amount_delta < 0');

  if (operation === 'order_payment') where.push("fe.event_type = 'order_payment'");
  else if (operation === 'debt_close' || operation === 'order_extra') where.push("fe.event_type IN ('debt_close', 'order_extra')");
  else if (operation === 'exchange_extra') where.push("fe.event_type = 'exchange_extra'");
  else if (operation === 'refund') where.push("fe.event_type IN ('order_refund', 'exchange_refund')");
  else if (operation === 'correction') where.push("fe.event_type IN ('payment_reversal', 'refund_reversal')");

  if (trace === 'review') where.push(reviewSql);
  else if (trace === 'info') where.push(`(${infoSql} AND NOT ${legacySql})`);
  else if (trace === 'legacy') where.push(legacySql);
  else if (trace === 'normal') where.push(`(NOT ${reviewSql} AND NOT ${infoSql})`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rowsResult, summary] = await Promise.all([
    db.prepare(
      `SELECT fe.id, fe.order_id, fe.external_order_id, fe.event_date, fe.event_at, fe.event_type,
              COALESCE(fe.related_type, '') AS related_type, fe.amount_delta,
              COALESCE(fe.payment_method, '') AS payment_method,
              COALESCE(fe.reason, '') AS reason, COALESCE(fe.comment, '') AS comment,
              fe.is_backfill, COALESCE(fe.created_at, '') AS event_recorded_at,
              COALESCE(fe.source_type, '') AS source_type, fe.source_id,
              COALESCE(fe.source_ref, '') AS source_ref,
              COALESCE(o.order_date, '') AS order_date,
              COALESCE(o.created_at, '') AS order_created_at,
              COALESCE(m.name, o.manager_snapshot_name, '') AS manager_name,
              COALESCE(m.color_key, '#475569') AS manager_color
       FROM financial_events fe
       LEFT JOIN orders o ON o.id = fe.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       ${whereSql}
       ORDER BY fe.event_at DESC, fe.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...bindings, limit + 1, offset).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN fe.amount_delta > 0 THEN fe.amount_delta ELSE 0 END), 0) AS total_in,
              COALESCE(SUM(CASE WHEN fe.amount_delta < 0 THEN -fe.amount_delta ELSE 0 END), 0) AS total_out,
              COALESCE(SUM(fe.amount_delta), 0) AS net
       FROM financial_events fe
       LEFT JOIN orders o ON o.id = fe.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       ${whereSql}`
    ).bind(...bindings).first<Record<string, unknown>>(),
  ]);

  const financeDateOffset = (left: string, right: string) => {
    const leftDate = /^\d{4}-\d{2}-\d{2}$/.test(left) ? Date.parse(`${left}T00:00:00.000Z`) : Number.NaN;
    const rightDate = /^\d{4}-\d{2}-\d{2}$/.test(right) ? Date.parse(`${right}T00:00:00.000Z`) : Number.NaN;
    return Number.isFinite(leftDate) && Number.isFinite(rightDate) ? Math.round((leftDate - rightDate) / 86_400_000) : 0;
  };
  const rawRows = rowsResult.results || [];
  const rows = rawRows.slice(0, limit).map((row) => {
    const eventType = cleanText(row.event_type);
    const relatedType = cleanText(row.related_type);
    const reason = cleanText(row.reason);
    const eventDate = cleanText(row.event_date);
    const eventAt = cleanText(row.event_at);
    const orderDate = cleanText(row.order_date);
    const orderCreatedAt = cleanText(row.order_created_at);
    const orderCreatedDate = orderCreatedAt.slice(0, 10);
    const isBackfill = toInt(row.is_backfill, 0) === 1;
    const isLegacy = isBackfill || reason === 'baseline';
    const dateRelation = !orderDate ? 'unknown' : eventDate < orderDate ? 'before_order' : eventDate > orderDate ? 'after_order' : 'same_day';
    const provenBackdatedCreate = eventType === 'order_payment'
      && dateRelation === 'after_order'
      && reason === 'order_create'
      && orderCreatedDate === eventDate
      && eventAt.slice(0, 10) === eventDate;

    let traceCode = eventType || 'money_event';
    let traceSeverity: 'normal' | 'info' | 'review' = 'normal';
    let traceTitle = moneyHistoryOperationLabel(eventType, relatedType, reason);
    let traceExplanation = 'Операция имеет явный тип и относится к выбранной дате.';
    if (isLegacy) {
      traceCode = 'legacy_baseline';
      traceSeverity = 'info';
      traceTitle = 'Историческая базовая запись';
      traceExplanation = 'Сохранено доказуемое состояние старой операции, но первоначальное действие пользователя по этой истории восстановить нельзя.';
    } else if (eventType === 'payment_reversal' || eventType === 'refund_reversal') {
      traceCode = 'correction';
      traceSeverity = 'info';
      traceTitle = moneyHistoryOperationLabel(eventType, relatedType, reason);
      traceExplanation = 'Это отдельная отмена или исправление. Исходная денежная операция не стирается из истории.';
    } else if (eventType === 'order_payment' && !orderDate) {
      traceCode = 'order_context_missing';
      traceSeverity = 'info';
      traceTitle = 'Заказ уже недоступен в подробной истории';
      traceExplanation = 'Денежное событие сохранено, но подробная карточка исходного заказа сейчас недоступна.';
    } else if (eventType === 'order_payment' && dateRelation === 'before_order') {
      traceCode = 'primary_before_order';
      traceSeverity = 'review';
      traceTitle = 'Оплата раньше даты заказа';
      traceExplanation = 'Первичная оплата датирована раньше бизнес-даты заказа. Это требует проверки.';
    } else if (eventType === 'order_payment' && provenBackdatedCreate) {
      traceCode = 'backdated_order_entry';
      traceSeverity = 'info';
      traceTitle = 'Заказ введён позже своей бизнес-даты';
      traceExplanation = 'Заказ был внесён в систему позже указанной даты, а денежная запись появилась при его вводе.';
    } else if (eventType === 'order_payment' && dateRelation === 'after_order') {
      traceCode = 'primary_recorded_later';
      traceSeverity = 'review';
      traceTitle = 'Первичная оплата имеет более позднюю дату';
      traceExplanation = 'Строка хранится как первичная оплата, хотя её дата позже даты заказа. Нужно проверить смысл операции.';
    } else if (eventType === 'debt_close') {
      traceCode = 'debt_close';
      traceTitle = 'Закрытие долга';
      traceExplanation = 'Отдельная оплата долга после создания заказа — нормальная денежная операция.';
    } else if (eventType === 'order_extra') {
      traceCode = 'legacy_order_extra';
      traceSeverity = 'info';
      traceTitle = 'Закрытие долга (старый тип)';
      traceExplanation = 'Это старая техническая классификация. В текущей модели отдельной доплаты по обычному заказу нет; такая последующая оплата относится к закрытию долга.';
    } else if (eventType === 'exchange_extra') {
      traceCode = 'exchange_extra';
      traceTitle = 'Доплата по обмену';
      traceExplanation = 'Доплата связана с обменом и учитывается по дате операции.';
    } else if (eventType === 'order_refund' || eventType === 'exchange_refund') {
      traceCode = eventType;
      traceTitle = moneyHistoryOperationLabel(eventType, relatedType, reason);
      traceExplanation = 'Возврат денег учитывается по дате фактической операции возврата.';
    }

    return {
      id: toInt(row.id, 0),
      orderId: toInt(row.order_id, 0) || null,
      externalOrderId: cleanText(row.external_order_id),
      orderDate: orderDate || null,
      orderCreatedAt: orderCreatedAt || null,
      eventDate,
      eventAt,
      eventRecordedAt: cleanText(row.event_recorded_at) || null,
      eventType,
      relatedType: relatedType || null,
      operationLabel: moneyHistoryOperationLabel(eventType, relatedType, reason),
      amountDelta: Number(row.amount_delta || 0),
      paymentMethod: cleanText(row.payment_method) || null,
      manager: cleanText(row.manager_name) || null,
      managerColor: cleanText(row.manager_color) || null,
      reason: reason || null,
      comment: cleanText(row.comment) || null,
      isBackfill,
      sourceType: cleanText(row.source_type) || null,
      sourceId: row.source_id == null ? null : toInt(row.source_id, 0) || null,
      sourceRef: cleanText(row.source_ref) || null,
      dateRelation,
      dateOffsetDays: orderDate ? financeDateOffset(eventDate, orderDate) : 0,
      traceCode,
      traceSeverity,
      traceTitle,
      traceExplanation,
    };
  });

  return {
    ok: true,
    count: Math.max(0, toInt(summary?.count, 0)),
    offset,
    limit,
    hasMore: rawRows.length > limit,
    scope: {
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      includeLegacy,
      currentMonthStart,
    },
    summary: {
      totalIn: Number(summary?.total_in || 0),
      totalOut: Number(summary?.total_out || 0),
      net: Number(summary?.net || 0),
    },
    events: rows,
  };
}
