from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path('.')


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new, label):
    text = read(path)
    if old not in text:
        raise SystemExit(f'{label}: marker not found')
    write(path, text.replace(old, new, 1))
    print(f'{label}: patched')


def declaration_hash(path, name):
    script = r"""
import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'
const [file, target] = process.argv.slice(1)
const text = fs.readFileSync(file, 'utf8')
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
for (const statement of source.statements) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === target) {
    const normalized = statement.getText(source).replace(/^export\s+/, '')
    console.log(crypto.createHash('sha256').update(normalized).digest('hex'))
    process.exit(0)
  }
}
throw new Error(`Declaration not found: ${target}`)
"""
    return subprocess.check_output(['node', '--input-type=module', '-e', script, path, name], text=True).strip()


# 1. Backend: bounded, user-selected money journal with legacy hidden by default.
cash_path = 'worker/domains/cash.ts'
before_list_history = declaration_hash(cash_path, 'listFinancialHistory')
cash = read(cash_path)
start = cash.index('export async function listFinancialHistory(db: D1Database, url: URL) {')
new_function = r'''export async function listFinancialHistory(db: D1Database, url: URL) {
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
  else if (operation === 'debt_close') where.push("fe.event_type = 'debt_close'");
  else if (operation === 'order_extra') where.push("fe.event_type = 'order_extra'");
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
      traceCode = 'order_extra';
      traceTitle = 'Доплата по заказу';
      traceExplanation = 'Отдельная доплата хранится отдельно от первичной оплаты.';
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
'''
write(cash_path, cash[:start] + new_function)
after_list_history = declaration_hash(cash_path, 'listFinancialHistory')

manifest_path = Path('scripts/finance-f4-money-journal-worker-manifest.json')
manifest_path.write_text(json.dumps({
    'version': 1,
    'step': 'finance-f4-money-journal',
    'changes': {
        'listFinancialHistory': {
            'before': before_list_history,
            'after': after_list_history,
        }
    }
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# 2. Worker modularization hash chain: accept only the exact F4 listFinancialHistory delta.
path = 'scripts/test-step1906a-worker-modularization.mjs'
text = read(path)
text = text.replace(
    "const financeF2TracePath = path.join(root, 'scripts/finance-f2-trace-worker-manifest.json')\n",
    "const financeF2TracePath = path.join(root, 'scripts/finance-f2-trace-worker-manifest.json')\nconst financeF4MoneyJournalPath = path.join(root, 'scripts/finance-f4-money-journal-worker-manifest.json')\n",
    1,
)
text = text.replace(
    "  check(fs.existsSync(financeF2TracePath), 'Finance F2 trace Worker manifest missing')\n",
    "  check(fs.existsSync(financeF2TracePath), 'Finance F2 trace Worker manifest missing')\n  check(fs.existsSync(financeF4MoneyJournalPath), 'Finance F4 money journal Worker manifest missing')\n",
    1,
)
text = text.replace(
    "  const financeF2TraceChanges = financeF2Trace?.version === 1 ? (financeF2Trace.changes || {}) : {}\n",
    "  const financeF2TraceChanges = financeF2Trace?.version === 1 ? (financeF2Trace.changes || {}) : {}\n  const financeF4MoneyJournal = fs.existsSync(financeF4MoneyJournalPath) ? JSON.parse(fs.readFileSync(financeF4MoneyJournalPath, 'utf8')) : null\n  const financeF4MoneyJournalChanges = financeF4MoneyJournal?.version === 1 ? (financeF4MoneyJournal.changes || {}) : {}\n",
    1,
)
old_chain = """    const financeF2TraceChanged = financeF2TraceChanges[name]
    if (financeF2TraceChanged) {
      check(financeF2TraceChanged.before === acceptedPostFinanceOrderDateSyncHash, `Finance F2 trace declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF2TraceChanged.after, `Worker declaration changed beyond exact Finance F2 trace allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceOrderDateSyncHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace deltas: ${name}`)
    }
"""
new_chain = """    const financeF2TraceChanged = financeF2TraceChanges[name]
    let acceptedPostFinanceF2TraceHash = acceptedPostFinanceOrderDateSyncHash
    if (financeF2TraceChanged) {
      check(financeF2TraceChanged.before === acceptedPostFinanceOrderDateSyncHash, `Finance F2 trace declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF2TraceHash = financeF2TraceChanged.after
    }
    const financeF4MoneyJournalChanged = financeF4MoneyJournalChanges[name]
    if (financeF4MoneyJournalChanged) {
      check(financeF4MoneyJournalChanged.before === acceptedPostFinanceF2TraceHash, `Finance F4 money journal declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF4MoneyJournalChanged.after, `Worker declaration changed beyond exact Finance F4 money journal allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF2TraceHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal deltas: ${name}`)
    }
"""
if old_chain not in text:
    raise SystemExit('1906A F2 hash-chain marker not found')
text = text.replace(old_chain, new_chain, 1)
write(path, text)

# 3. Frontend types.
types_path = 'src/app/types.ts'
types = read(types_path)
start = types.index('export type FinancialHistoryEntry = {')
end = types.index('export type FinancialHistoryResponse = {', start)
new_type = '''export type FinancialHistoryEntry = {
  id: number
  orderId?: number | null
  externalOrderId: string
  orderDate?: string | null
  orderCreatedAt?: string | null
  eventDate: string
  eventAt: string
  eventRecordedAt?: string | null
  eventType: string
  relatedType: string | null
  operationLabel: string
  amountDelta: number
  paymentMethod: string | null
  manager?: string | null
  managerColor?: string | null
  reason: string | null
  comment: string | null
  isBackfill: boolean
  sourceType?: string | null
  sourceId?: number | null
  sourceRef?: string | null
  dateRelation?: 'before_order' | 'same_day' | 'after_order' | 'unknown' | string
  dateOffsetDays?: number
  traceCode?: string
  traceSeverity?: 'normal' | 'info' | 'review' | string
  traceTitle?: string
  traceExplanation?: string
}

'''
write(types_path, types[:start] + new_type + types[end:])

# 4. App state/read contract. Preserve React hook count/order by changing the existing moneyHistoryType state only.
app_path = 'src/App.tsx'
app = read(app_path)
app = app.replace("import './styles/189c-reliable-money-history.css'\n", "import './styles/189c-reliable-money-history.css'\nimport './styles/finance-f4-money-journal.css'\n", 1)
old_state = "  const [moneyHistoryType, setMoneyHistoryType] = useState<'all' | 'in' | 'out' | 'refund' | 'correction'>('all')"
new_state = "  const [moneyHistoryType, setMoneyHistoryType] = useState({ flow: 'all' as 'all' | 'in' | 'out', operation: 'all' as 'all' | 'order_payment' | 'debt_close' | 'order_extra' | 'exchange_extra' | 'refund' | 'correction', trace: 'all' as 'all' | 'normal' | 'info' | 'review' | 'legacy' })"
if old_state not in app:
    raise SystemExit('App moneyHistoryType state marker not found')
app = app.replace(old_state, new_state, 1)
load_start = app.index('  async function loadMoneyHistory(options: { append?: boolean } = {}) {')
load_end = app.index('  function refreshFinanceReportsIfVisible()', load_start)
new_loader = r'''  async function loadMoneyHistory(options: { append?: boolean } = {}) {
    const append = Boolean(options.append)
    if (!financeReportFilters.dateFrom || !financeReportFilters.dateTo) return null
    const requestId = ++moneyHistoryRequestIdRef.current
    const offset = append ? moneyHistory.length : 0
    const currentMonthStart = `${formatLocalDateInput().slice(0, 7)}-01`
    const includeLegacy = financeReportFilters.dateFrom < currentMonthStart
    const effectiveTrace = !includeLegacy && moneyHistoryType.trace === 'legacy' ? 'all' : moneyHistoryType.trace
    setMoneyHistoryBusy(true)
    setMoneyHistoryError('')
    try {
      const params = new URLSearchParams({
        dateFrom: financeReportFilters.dateFrom,
        dateTo: financeReportFilters.dateTo,
        q: moneyHistoryQuery.trim(),
        flow: moneyHistoryType.flow,
        operation: moneyHistoryType.operation,
        trace: effectiveTrace,
        includeLegacy: includeLegacy ? '1' : '0',
        limit: '50',
        offset: String(offset),
      })
      const response = await apiFetch(`/api/finance/money-history?${params.toString()}`)
      const data = await readJsonResponse<FinancialHistoryResponse & { message?: string }>(response, 'История денег')
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить историю денег.')
      if (requestId !== moneyHistoryRequestIdRef.current) return data
      setMoneyHistory((current) => append ? [...current, ...(data.events || [])] : (data.events || []))
      setMoneyHistoryHasMore(Boolean(data.hasMore))
      setMoneyHistorySummary({
        count: Number(data.count || 0),
        totalIn: Number(data.summary?.totalIn || 0),
        totalOut: Number(data.summary?.totalOut || 0),
        net: Number(data.summary?.net || 0),
      })
      return data
    } catch (err) {
      if (requestId === moneyHistoryRequestIdRef.current) {
        setMoneyHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить историю денег.')
        if (!append) setMoneyHistory([])
      }
      return null
    } finally {
      if (requestId === moneyHistoryRequestIdRef.current) setMoneyHistoryBusy(false)
    }
  }

'''
app = app[:load_start] + new_loader + app[load_end:]
old_dep = "}, [activeSector, authReady, financeMode, financeReportFilters.dateFrom, financeReportFilters.dateTo, moneyHistoryQuery, moneyHistoryType])"
new_dep = "}, [activeSector, authReady, financeMode, financeReportFilters.dateFrom, financeReportFilters.dateTo, moneyHistoryQuery, moneyHistoryType.flow, moneyHistoryType.operation, moneyHistoryType.trace])"
if old_dep not in app:
    raise SystemExit('App moneyHistory effect dependency marker not found')
app = app.replace(old_dep, new_dep, 1)
write(app_path, app)

# 5. Money journal UI + direct drilldown from F3 summary.
renderer_path = 'src/features/renderers/FinanceDashboardRenderer.tsx'
renderer = read(renderer_path)
insert_marker = "  const visibleLegacyBaselineCount = visiblePaymentTraceInfo.filter((row) => row.traceCode === 'legacy_baseline').length\n"
insert_code = r'''  const visibleLegacyBaselineCount = visiblePaymentTraceInfo.filter((row) => row.traceCode === 'legacy_baseline').length
  const formatFinanceDateTime = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text) return '—'
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? text : date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  const openMoneyHistoryForOrder = (row: any) => {
    const externalId = String(row?.externalId || row?.externalOrderId || '').trim()
    if (!externalId) return
    setMoneyHistoryQuery(externalId)
    setMoneyHistoryType({ flow: 'all', operation: 'all', trace: 'all' })
    setFinanceMode('payments')
  }
  const visibleMoneyHistoryTrace = historicalPeriodSelected
    ? moneyHistoryType.trace
    : moneyHistoryType.trace === 'legacy' ? 'all' : moneyHistoryType.trace
'''
if insert_marker not in renderer:
    raise SystemExit('Renderer F3 insert marker not found')
renderer = renderer.replace(insert_marker, insert_code, 1)
old_action = '<td><button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance(row)}>К заказу</button></td>'
new_action = '<td><div className="finance-row-actions"><button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance(row)}>К заказу</button><button className="secondary compact finance-money-link" type="button" onClick={() => openMoneyHistoryForOrder(row)}>Денежная история</button></div></td>'
if renderer.count(old_action) < 2:
    raise SystemExit('Renderer summary action markers missing')
renderer = renderer.replace(old_action, new_action, 2)
filters_start = renderer.index('            <div className="finance-money-history-filters">')
filters_end = renderer.index('\n\n            {moneyHistoryBusy', filters_start)
new_filters = r'''            <div className="finance-money-history-filters finance-money-history-filters-f4">
              <label className="finance-money-search"><span>Найти операцию</span><input value={moneyHistoryQuery} onChange={(event) => setMoneyHistoryQuery(event.target.value)} placeholder="Номер заказа, способ оплаты или комментарий" /></label>
              <label><span>Движение</span><select value={moneyHistoryType.flow} onChange={(event) => setMoneyHistoryType((current) => ({ ...current, flow: event.target.value }))}>
                <option value="all">Все</option>
                <option value="in">Поступления</option>
                <option value="out">Возвраты / списания</option>
              </select></label>
              <label><span>Вид операции</span><select value={moneyHistoryType.operation} onChange={(event) => setMoneyHistoryType((current) => ({ ...current, operation: event.target.value }))}>
                <option value="all">Все виды</option>
                <option value="order_payment">Оплата заказа</option>
                <option value="debt_close">Закрытие долга</option>
                <option value="order_extra">Доплата по заказу</option>
                <option value="exchange_extra">Доплата по обмену</option>
                <option value="refund">Возвраты</option>
                <option value="correction">Исправления / отмены</option>
              </select></label>
              <label><span>Проверка</span><select value={visibleMoneyHistoryTrace} onChange={(event) => setMoneyHistoryType((current) => ({ ...current, trace: event.target.value }))}>
                <option value="all">Все состояния</option>
                <option value="normal">Обычные операции</option>
                <option value="info">С пояснением</option>
                <option value="review">Нужно проверить</option>
                <option value="legacy" disabled={!historicalPeriodSelected}>Исторический baseline{historicalPeriodSelected ? '' : ' — выберите старый период'}</option>
              </select></label>
            </div>
            {historicalPeriodSelected ? <div className="finance-history-scope-note">Выбран старый период. Исторические baseline-записи разрешены и помечаются отдельно; их первоначальный пользовательский ввод может быть недоказуем.</div> : null}'''
renderer = renderer[:filters_start] + new_filters + renderer[filters_end:]
row_start_marker = '            : moneyHistory.length ? <div className="finance-money-history-list">{moneyHistory.map((row) => ('
row_start = renderer.index(row_start_marker)
row_end_marker = '            : <div className="finance-money-history-state"><strong>За выбранный период денежных операций нет.</strong></div>}'
row_end = renderer.index(row_end_marker, row_start)
new_rows = r'''            : moneyHistory.length ? <div className="finance-money-history-list">{moneyHistory.map((row) => (
              <article className={`finance-money-history-row finance-money-history-row-f4 trace-${row.traceSeverity || 'normal'}`} key={`money-history-${row.id}`}>
                <div className="finance-money-history-date">
                  <strong>{formatDateShort(row.eventDate)}</strong>
                  <small>Операция записана: {formatFinanceDateTime(row.eventAt)}</small>
                </div>
                <div className="finance-money-history-order">
                  <strong>{row.externalOrderId || 'Без номера заказа'}</strong>
                  {row.orderDate ? <small>Дата заказа: {formatDateShort(row.orderDate)}</small> : <small>Подробная карточка заказа недоступна</small>}
                  {row.orderCreatedAt ? <small>Заказ введён: {formatFinanceDateTime(row.orderCreatedAt)}</small> : null}
                  {row.manager ? <ManagerBadge name={row.manager} colorKey={row.managerColor || managerColorFor(row.manager)} compact /> : null}
                </div>
                <div className="finance-money-history-operation">
                  <strong>{row.operationLabel}</strong>
                  <span className={`soft-badge ${row.traceSeverity === 'review' ? 'warning-soft' : ''}`}>{row.traceSeverity === 'review' ? 'Нужно проверить' : row.traceCode === 'legacy_baseline' ? 'Историческая запись' : row.traceSeverity === 'info' ? 'Пояснение' : 'Обычная операция'}</span>
                  {row.traceTitle ? <span className="finance-money-history-trace-title">{row.traceTitle}</span> : null}
                  {row.traceExplanation ? <span className="finance-money-history-note">{row.traceExplanation}</span> : null}
                  {row.comment ? <span className="finance-money-history-note">Комментарий: {row.comment}</span> : null}
                </div>
                <div className="finance-money-history-method">{row.paymentMethod || 'Способ не указан'}</div>
                <div className={`finance-money-history-amount ${row.amountDelta >= 0 ? 'is-in' : 'is-out'}`}>{row.amountDelta >= 0 ? '+ ' : '− '}{formatMoney(Math.abs(row.amountDelta))}</div>
                <div className="finance-money-history-actions">
                  {row.orderId || row.externalOrderId ? <button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance({ orderId: row.orderId || undefined, externalId: row.externalOrderId, orderDate: row.orderDate || undefined })}>К заказу</button> : null}
                </div>
              </article>
            ))}</div>
'''
renderer = renderer[:row_start] + new_rows + renderer[row_end:]
write(renderer_path, renderer)

# 6. F4 CSS (new additive override file).
Path('src/styles/finance-f4-money-journal.css').write_text(r'''/* Finance F4 — auditable money journal without default legacy noise. */
.finance-money-history-filters-f4 { grid-template-columns: minmax(260px, 1.5fr) repeat(3, minmax(150px, .7fr)); }
.finance-history-scope-note { padding: 9px 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-size: 12px; opacity: .82; }
.finance-money-history-row-f4 { grid-template-columns: minmax(150px, .9fr) minmax(190px, 1.2fr) minmax(250px, 1.7fr) minmax(105px, .7fr) minmax(110px, .7fr) auto; align-items: start; }
.finance-money-history-row-f4.trace-review { border-style: solid; }
.finance-money-history-date { display: grid; gap: 4px; }
.finance-money-history-date small,
.finance-money-history-order small { font-size: 11px; opacity: .72; }
.finance-money-history-trace-title { font-size: 12px; font-weight: 700; }
.finance-money-history-actions,
.finance-row-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.finance-money-history-actions { justify-content: flex-end; }
.finance-money-history-method { overflow-wrap: anywhere; }
@media (max-width: 1250px) {
  .finance-money-history-filters-f4 { grid-template-columns: minmax(240px, 1.4fr) repeat(2, minmax(150px, 1fr)); }
  .finance-money-history-filters-f4 .finance-money-search { grid-column: 1 / -1; }
  .finance-money-history-row-f4 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
  .finance-money-history-row-f4 .finance-money-history-operation { grid-column: 1 / -1; }
  .finance-money-history-row-f4 .finance-money-history-method { grid-column: 1; }
  .finance-money-history-row-f4 .finance-money-history-actions { grid-column: 3; }
}
@media (max-width: 760px) {
  .finance-money-history-filters-f4 { grid-template-columns: 1fr; }
  .finance-money-history-filters-f4 .finance-money-search { grid-column: auto; }
  .finance-money-history-row-f4 { grid-template-columns: 1fr auto; }
  .finance-money-history-row-f4 .finance-money-history-order,
  .finance-money-history-row-f4 .finance-money-history-operation,
  .finance-money-history-row-f4 .finance-money-history-method { grid-column: 1 / -1; }
  .finance-money-history-row-f4 .finance-money-history-actions { grid-column: 1 / -1; justify-content: flex-start; }
}
''', encoding='utf-8')

# 7. Regression test.
Path('scripts/test-finance-f4-money-journal.mjs').write_text(r'''import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const cash = read('worker/domains/cash.ts')
  const app = read('src/App.tsx')
  const renderer = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  const types = read('src/app/types.ts')
  const css = read('src/styles/finance-f4-money-journal.css')

  check(cash.includes("const includeLegacy = cleanText(url.searchParams.get('includeLegacy')) === '1'") && cash.includes("dateFrom < currentMonthStart"), 'Server legacy history is not gated by an explicitly older date range')
  check(cash.includes("if (!includeLegacy) where.push(`NOT ${legacySql}`)"), 'Server can expose baseline history by default')
  check(cash.includes("url.searchParams.get('flow')") && cash.includes("url.searchParams.get('operation')") && cash.includes("url.searchParams.get('trace')"), 'Money journal filters are incomplete')
  check(cash.includes("trace === 'review'") && cash.includes("trace === 'legacy'") && cash.includes('backdatedCreateInfoSql'), 'Server trace filtering is incomplete')
  for (const marker of ['order_created_at', 'event_recorded_at', 'source_ref', 'traceSeverity', 'traceExplanation']) check(cash.includes(marker), `Money history trace field missing: ${marker}`)

  check(app.includes("includeLegacy: includeLegacy ? '1' : '0'"), 'Frontend does not explicitly request historical baseline only for an older period')
  check(app.includes("moneyHistoryType.flow") && app.includes("moneyHistoryType.operation") && app.includes("moneyHistoryType.trace"), 'Frontend money history filters are not independent')
  check(app.includes("import './styles/finance-f4-money-journal.css'"), 'F4 money journal CSS is not loaded')
  check(renderer.includes('Движение') && renderer.includes('Вид операции') && renderer.includes('Проверка'), 'F4 journal filters are not visible')
  check(renderer.includes('disabled={!historicalPeriodSelected}') && renderer.includes('Исторический baseline'), 'Legacy filter is not locked behind an explicitly historical range')
  check(renderer.includes('Операция записана:') && renderer.includes('Заказ введён:'), 'Journal does not expose operation/order recorded timestamps')
  check(renderer.includes('traceExplanation') && renderer.includes('Нужно проверить'), 'Journal does not explain trace state')
  check(renderer.includes('openMoneyHistoryForOrder') && renderer.includes('Денежная история'), 'Summary trace rows cannot drill down to money history')
  check(renderer.includes("openOrderFromFinance({ orderId: row.orderId"), 'Money journal has no direct order action')
  check(types.includes('eventRecordedAt?: string | null') && types.includes("traceSeverity?: 'normal' | 'info' | 'review'"), 'FinancialHistoryEntry contract was not enriched')
  check(css.includes('.finance-money-history-row-f4') && css.includes('@media (max-width: 760px)'), 'F4 journal responsive CSS missing')

  console.log('FINANCE F4 MONEY JOURNAL TESTS PASSED — legacy is opt-in through an older period, journal filters are independent, trace timestamps/explanations and direct drilldowns are visible.')
} catch (error) {
  console.error(`FINANCE F4 MONEY JOURNAL TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
''', encoding='utf-8')

# 8. Wire F4 into release check.
release_path = 'scripts/release-check.mjs'
release = read(release_path)
release = release.replace("    'scripts/test-finance-f3-summary-ux.mjs',\n", "    'scripts/test-finance-f3-summary-ux.mjs',\n    'scripts/test-finance-f4-money-journal.mjs',\n    'scripts/finance-f4-money-journal-worker-manifest.json',\n", 1)
release = release.replace("    'src/styles/189c-reliable-money-history.css',\n", "    'src/styles/189c-reliable-money-history.css',\n    'src/styles/finance-f4-money-journal.css',\n", 1)
release = release.replace("  run('Finance F3 summary/day UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f3-summary-ux.mjs')])\n", "  run('Finance F3 summary/day UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f3-summary-ux.mjs')])\n  run('Finance F4 money journal UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f4-money-journal.mjs')])\n", 1)
write(release_path, release)

print('Finance F4 patch applied')
print(json.dumps({'listFinancialHistory': {'before': before_list_history, 'after': after_list_history}}, indent=2))
