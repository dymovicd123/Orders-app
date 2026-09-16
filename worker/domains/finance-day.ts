import type { FinanceDayResponse, FinanceDayEvent } from '../../shared/finance-day-contracts.ts'

// A separate opt-in read: current payment facts are not reconstructed from positive audit deltas.
export async function readFinanceDay(db: D1Database, url: URL): Promise<FinanceDayResponse> {
  const date = url.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Выберите существующую дату для просмотра денег за день.');
  }
  const ledger = url.searchParams.get('ledger') || 'money';
  if (ledger !== 'money' && ledger !== 'cash') throw new Error('Выберите журнал оплат или наличных.');
  const offset = Math.max(0, Math.min(1000000, Math.trunc(Number(url.searchParams.get('offset')) || 0)));
  const limit = 50;
  const text = (value: unknown) => String(value ?? '').trim();
  const methodName = (value: unknown) => {
    const method = text(value).toUpperCase().replace(/\s+/g, ' ');
    return method === 'КАСПИЙ МАГАЗИН' || method === 'KASPI МАГАЗИН' ? 'КАСПИ МАГАЗИН' : method || 'Способ не указан';
  };
  const methodKind = (value: unknown): FinanceDayEvent['methodKind'] => {
    const method = text(value).toUpperCase();
    return !method || method === '—' ? 'unknown' : method.includes('НАЛИЧ') || method === 'CASH' ? 'cash' : 'noncash';
  };
  const correctionTypes = new Set(['payment_reversal', 'refund_reversal', 'return_reversal', 'order_cancel_payment', 'manual_reversal', 'balance_adjustment_in', 'balance_adjustment_out']);
  const openingTypes = new Set(['opening', 'ledger_reset']);
  const cashPaymentTypes = new Set(['payment_primary', 'payment_debt', 'payment_extra', 'exchange_extra']);
  const paymentTypes = new Set(['order_payment', 'debt_close', 'order_extra', 'exchange_extra']);
  const refundTypes = new Set(['order_refund', 'exchange_refund']);
  const labels: Record<string, string> = {
    order_payment: 'Оплата заказа', payment_primary: 'Оплата заказа', debt_close: 'Закрытие долга', payment_debt: 'Закрытие долга',
    order_extra: 'Закрытие долга', payment_extra: 'Закрытие долга', exchange_extra: 'Доплата по обмену',
    order_refund: 'Возврат клиенту', exchange_refund: 'Возврат по обмену', payment_reversal: 'Исправление: отмена оплаты',
    refund_reversal: 'Исправление: отмена возврата', return_reversal: 'Исправление: отмена возврата',
    order_cancel_payment: 'Исправление при удалении заказа', manual_in: 'Ручное внесение наличных', manual_out: 'Выдача / передача наличных',
    manual_reversal: 'Исправление: отмена ручной операции', balance_adjustment_in: 'Корректировка остатка', balance_adjustment_out: 'Корректировка остатка',
    opening: 'Начальный остаток — не поступление', ledger_reset: 'Начало нового цикла — не поступление',
  };
  // Batch keeps the summary and its page in one read transaction. All date predicates are bounded.
  const pageSql = ledger === 'money' ? `
    SELECT fe.id, fe.order_id, fe.external_order_id, fe.event_date AS business_date,
      fe.event_at, fe.created_at AS recorded_at, fe.event_type AS operation_type, fe.amount_delta AS amount,
      fe.payment_method AS method, fe.reason, fe.comment, fe.is_backfill,
      COALESCE(c.display_name, '') AS customer, COALESCE(m.name, o.manager_snapshot_name, '') AS actor,
      CASE WHEN COALESCE(fe.is_backfill, 0) = 0 AND COALESCE(fe.reason, '') <> 'baseline'
        AND date(fe.created_at, '+5 hours') > fe.event_date THEN 1 ELSE 0 END AS recorded_later,
      CASE WHEN COALESCE(fe.is_backfill, 0) = 0 AND COALESCE(fe.reason, '') <> 'baseline'
        AND date(fe.event_at, '+5 hours') = fe.event_date THEN 1 ELSE 0 END AS event_time_known
    FROM financial_events fe LEFT JOIN orders o ON o.id = fe.order_id
    LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN managers m ON m.id = o.manager_id
    WHERE fe.event_date = ?
    ORDER BY fe.event_date ASC, event_time_known DESC, datetime(fe.event_at) ASC, fe.id ASC LIMIT ? OFFSET ?`
    : `SELECT e.id, e.order_id, e.external_order_id, e.business_date, e.occurred_at AS event_at,
      e.created_at AS recorded_at, e.entry_type AS operation_type,
      CASE WHEN e.direction = 'out' THEN -e.amount ELSE e.amount END AS amount,
      e.payment_method AS method, '' AS reason, e.comment, 0 AS is_backfill,
      COALESCE(c.display_name, '') AS customer, COALESCE(e.created_by, '') AS actor,
      CASE WHEN date(e.created_at, '+5 hours') > e.business_date THEN 1 ELSE 0 END AS recorded_later,
      CASE WHEN date(e.occurred_at, '+5 hours') = e.business_date THEN 1 ELSE 0 END AS event_time_known
    FROM cash_register_entries e LEFT JOIN orders o ON o.id = e.order_id LEFT JOIN customers c ON c.id = o.customer_id
    WHERE e.business_date = ?
    ORDER BY e.business_date ASC, event_time_known DESC, datetime(e.occurred_at) ASC, e.id ASC LIMIT ? OFFSET ?`;
  const [paymentsResult, historyResult, cashResult, pageResult] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT p.order_id, p.method, COUNT(*) AS count, SUM(p.amount) AS total
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.payment_date = ? AND o.order_status <> 'deleted' GROUP BY p.order_id, p.method`).bind(date),
    db.prepare(`SELECT order_id, payment_method, event_type, reason, is_backfill, COUNT(*) AS count,
      SUM(CASE WHEN amount_delta > 0 THEN amount_delta ELSE 0 END) AS total_in,
      SUM(CASE WHEN amount_delta < 0 THEN -amount_delta ELSE 0 END) AS total_out,
      SUM(CASE WHEN COALESCE(is_backfill, 0) = 0 AND COALESCE(reason, '') <> 'baseline'
        AND date(created_at, '+5 hours') > event_date THEN 1 ELSE 0 END) AS late_count
      FROM financial_events WHERE event_date = ? GROUP BY order_id, payment_method, event_type, reason, is_backfill`).bind(date),
    db.prepare(`SELECT order_id, entry_type, COUNT(*) AS count,
      SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END) AS total_in,
      SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END) AS total_out,
      SUM(CASE WHEN date(created_at, '+5 hours') > business_date THEN 1 ELSE 0 END) AS late_count
      FROM cash_register_entries WHERE business_date = ? GROUP BY order_id, entry_type`).bind(date),
    db.prepare(pageSql).bind(date, limit + 1, offset),
  ]);
  const methods = new Map<string, FinanceDayResponse['payments']['methods'][number]>();
  const paymentByOrder = new Map<string, number>();
  const historyByOrder = new Map<string, number>();
  const registerByOrder = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, amount: number) => map.set(key, (map.get(key) || 0) + amount);
  let total = 0, paymentsCash = 0, historyIn = 0, historyOut = 0, registerIn = 0, registerOut = 0;
  let limited = false;
  for (const row of paymentsResult.results) {
    const amount = Number(row.total || 0), method = methodName(row.method), kind = methodKind(row.method);
    const bucket = methods.get(method) || { method, kind, total: 0, count: 0 };
    bucket.total += amount; bucket.count += Number(row.count || 0); methods.set(method, bucket); total += amount;
    if (kind === 'cash') { paymentsCash += amount; add(paymentByOrder, `${row.order_id}:in`, amount); }
  }
  for (const row of historyResult.results) {
    if (methodKind(row.payment_method) !== 'cash') continue;
    const incoming = Number(row.total_in || 0), outgoing = Number(row.total_out || 0), type = text(row.event_type);
    if (correctionTypes.has(type) || text(row.reason).includes('edit') || Number(row.is_backfill) || row.reason === 'baseline') limited = true;
    if (paymentTypes.has(type)) { historyIn += incoming; add(historyByOrder, `${row.order_id}:in`, incoming); }
    else if (refundTypes.has(type)) { historyOut += outgoing; add(historyByOrder, `${row.order_id}:out`, outgoing); }
    else limited = true;
  }
  const cash = { in: 0, out: 0, net: 0, correctionIn: 0, correctionOut: 0, opening: 0 };
  for (const row of cashResult.results) {
    const incoming = Number(row.total_in || 0), outgoing = Number(row.total_out || 0), type = text(row.entry_type);
    if (openingTypes.has(type)) { cash.opening += incoming - outgoing; continue; }
    cash.net += incoming - outgoing;
    if (correctionTypes.has(type)) { cash.correctionIn += incoming; cash.correctionOut += outgoing; limited = true; }
    else { cash.in += incoming; cash.out += outgoing; }
    if (cashPaymentTypes.has(type)) { registerIn += incoming; add(registerByOrder, `${row.order_id}:in`, incoming); }
    else if (refundTypes.has(type)) { registerOut += outgoing; add(registerByOrder, `${row.order_id}:out`, outgoing); }
    else if (type !== 'manual_in' && type !== 'manual_out' && !correctionTypes.has(type)) limited = true;
  }
  const keys = new Set([...historyByOrder.keys(), ...registerByOrder.keys(), ...paymentByOrder.keys()]);
  const differs = [...keys].some(key => (historyByOrder.get(key) || 0) !== (registerByOrder.get(key) || 0)
    || (key.endsWith(':in') && (paymentByOrder.get(key) || 0) !== (historyByOrder.get(key) || 0)));
  const groups = ledger === 'money' ? historyResult.results : cashResult.results;
  return {
    ok: true, date, ledger,
    payments: { total, cash: paymentsCash, methods: [...methods.values()].sort((a, b) => b.total - a.total || a.method.localeCompare(b.method)) },
    cash,
    reconciliation: { status: differs ? 'different' : limited ? 'limited' : 'matched', paymentsCash, historyIn, historyOut, registerIn, registerOut },
    count: groups.reduce((sum, row) => sum + Number(row.count || 0), 0),
    lateCount: groups.reduce((sum, row) => sum + Number(row.late_count || 0), 0),
    offset, hasMore: pageResult.results.length > limit,
    events: pageResult.results.slice(0, limit).map(row => {
      const type = text(row.operation_type), reason = text(row.reason);
      const correction = correctionTypes.has(type) || reason.includes('edit');
      return {
        id: Number(row.id), orderId: row.order_id == null ? null : Number(row.order_id), externalOrderId: text(row.external_order_id),
        customer: text(row.customer), actor: text(row.actor), businessDate: text(row.business_date), recordedAt: text(row.recorded_at) || null,
        recordedLater: Boolean(Number(row.recorded_later)), originalRecordedAtUnknown: Boolean(Number(row.is_backfill)) || reason === 'baseline',
        eventTimeKnown: Boolean(Number(row.event_time_known)), operation: reason === 'order_edit_new' ? 'Исправление: новая версия оплаты' : labels[type] || 'Денежная операция — тип не уточнён',
        amount: Number(row.amount || 0), method: ledger === 'cash' ? 'НАЛИЧКА' : methodName(row.method),
        methodKind: ledger === 'cash' ? 'cash' : methodKind(row.method), comment: text(row.comment), correction,
      };
    }),
  };
}
