import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

const nativeRequire = createRequire(import.meta.url)
const modules = new Map()
function load(file) {
  file = path.resolve(file)
  if (modules.has(file)) return modules.get(file).exports
  const module = { exports: {} }
  modules.set(file, module)
  const source = fs.readFileSync(file, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const require = name => {
    if (name.endsWith('.css')) return {}
    if (!name.startsWith('.')) return nativeRequire(name)
    const target = path.resolve(path.dirname(file), name)
    return load(path.extname(target) ? target : fs.existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`)
  }
  new Function('require', 'module', 'exports', code)(require, module, module.exports)
  return module.exports
}

// Local fixture only. These are the packet's three demonstrated amounts, not production access.
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`
 CREATE TABLE orders(id INTEGER PRIMARY KEY, external_id TEXT, order_status TEXT, customer_id INTEGER, manager_id INTEGER, manager_snapshot_name TEXT);
 CREATE TABLE customers(id INTEGER PRIMARY KEY, display_name TEXT);
 CREATE TABLE managers(id INTEGER PRIMARY KEY, name TEXT);
 CREATE TABLE payments(id INTEGER PRIMARY KEY, order_id INTEGER, payment_date TEXT, method TEXT, amount INTEGER);
 CREATE TABLE financial_events(id INTEGER PRIMARY KEY, order_id INTEGER, external_order_id TEXT, event_date TEXT, event_at TEXT, event_type TEXT, related_type TEXT, amount_delta INTEGER, payment_method TEXT, reason TEXT, comment TEXT, is_backfill INTEGER, created_at TEXT);
 CREATE TABLE cash_register_entries(id INTEGER PRIMARY KEY, order_id INTEGER, external_order_id TEXT, business_date TEXT, occurred_at TEXT, created_at TEXT, entry_type TEXT, direction TEXT, amount INTEGER, payment_method TEXT, created_by TEXT, comment TEXT);
 INSERT INTO orders VALUES(1,'DEBT','active',1,1,'Manager'),(2,'KASPI','active',1,1,'Manager'),(3,'TERMINAL','active',1,1,'Manager');
 INSERT INTO customers VALUES(1,'Клиент'); INSERT INTO managers VALUES(1,'Менеджер');
 INSERT INTO payments VALUES(1,1,'2026-09-05','НАЛИЧКА',20000),(2,2,'2026-09-05','КАСПИ МАГАЗИН',40000),(3,3,'2026-09-05','ТЕРМИНАЛ',40000);
 INSERT INTO financial_events VALUES
 (1,1,'DEBT','2026-09-05','2026-09-07T12:01:13.781Z','debt_close',NULL,20000,'НАЛИЧКА','recorded','',0,'2026-09-07T12:01:13.781Z'),
 (2,2,'KASPI','2026-09-05','2026-09-05T06:10:00Z','order_payment',NULL,40000,'КАСПИ МАГАЗИН','order_create','',0,'2026-09-05T06:10:00Z'),
 (3,3,'TERMINAL','2026-09-05','2026-09-05T09:21:00Z','order_payment',NULL,40000,'ТЕРМИНАЛ','order_create','',0,'2026-09-05T09:21:00Z');
 INSERT INTO cash_register_entries VALUES(1,1,'DEBT','2026-09-05','2026-09-07T12:01:13.781Z','2026-09-07T12:01:13.781Z','payment_debt','in',20000,'НАЛИЧКА','Автоучёт','');
`)
const original = sqlite.prepare('SELECT * FROM financial_events').all()
let reads = 0
const db = {
  prepare(sql) {
    assert.match(sql.trim(), /^(SELECT|WITH)\b/, 'day endpoint must be read-only')
    let bindings = []
    return { bind(...values) { bindings = values; return this }, async all() { reads++; return { results: sqlite.prepare(sql).all(...bindings), success: true } } }
  },
  async batch(statements) { return Promise.all(statements.map(s => s.all())) },
}
const { readFinanceDay } = load('worker/domains/finance-day.ts')
const query = (extra = '') => readFinanceDay(db, new URL(`https://fixture/api/finance/money-history?view=day&date=2026-09-05${extra}`))
const day = await query()
assert.equal(day.payments.total, 100000)
assert.equal(day.payments.cash, 20000)
assert.equal(day.cash.in, 20000)
assert.equal(day.cash.out, 0)
assert.equal(day.cash.net, 20000)
assert.equal(day.reconciliation.status, 'matched')
assert.equal(day.lateCount, 1)
assert.deepEqual(day.events.map(r => r.externalOrderId), ['KASPI','TERMINAL','DEBT'])
assert.equal(day.events.at(-1).recordedLater, true)
assert.equal(day.events.at(-1).recordedAt, '2026-09-07T12:01:13.781Z')
assert.equal(day.events.at(-1).eventTimeKnown, false, 'do not invent a clock time on the business day')
assert.equal(day.events[1].methodKind, 'noncash')
assert.deepEqual(day.payments.methods.map(r => [r.method,r.total]).sort(), [['КАСПИ МАГАЗИН',40000],['НАЛИЧКА',20000],['ТЕРМИНАЛ',40000]].sort())
assert.ok(reads <= 5, 'day view must not execute full report SQL')
const initialCashDay = await query('&ledger=cash')

// The owner explicitly chose corrected current payments, not positive history deltas.
sqlite.exec(`INSERT INTO financial_events VALUES
 (4,3,'TERMINAL','2026-09-05','2026-09-06T10:00:00Z','payment_reversal','order_payment',-40000,'ТЕРМИНАЛ','order_edit','',0,'2026-09-06T10:00:00Z'),
 (5,3,'TERMINAL','2026-09-05','2026-09-06T10:00:00Z','order_payment',NULL,40000,'ТЕРМИНАЛ','order_edit_new','',0,'2026-09-06T10:00:00Z');`)
const corrected = await query()
assert.equal(corrected.payments.total, 100000)
assert.equal(corrected.events.length, 5)
assert.match(corrected.events.find(r => r.id === 5).operation, /Исправление/)

// Do not pronounce ledgers consistent when opposite omissions merely cancel out.
sqlite.exec(`INSERT INTO cash_register_entries VALUES
 (2,1,'DEBT','2026-09-05','2026-09-05T10:00:00Z','2026-09-05T10:00:00Z','payment_debt','in',40000,'НАЛИЧКА','Автоучёт',''),
 (3,1,'DEBT','2026-09-05','2026-09-05T10:01:00Z','2026-09-05T10:01:00Z','order_refund','out',40000,'НАЛИЧКА','Автоучёт','');`)
assert.equal((await query()).reconciliation.status, 'different')
const cash = await query('&ledger=cash')
assert.equal(cash.events.length, 3)
assert.equal(cash.cash.net, 20000)
assert.equal(cash.lateCount, 1)

// Local midnight, legacy unknown time, manual cash, closed cycles, unknown methods.
sqlite.exec(`INSERT INTO financial_events VALUES
 (6,2,'KASPI','2026-09-05','2026-09-05T20:01:00Z','order_payment',NULL,1,NULL,'recorded','',0,'2026-09-05T20:01:00Z'),
 (7,2,'KASPI','2026-09-05','2026-09-05T12:00:00Z','order_payment',NULL,1,NULL,'baseline','',1,'2026-09-10T10:00:00Z');
 INSERT INTO cash_register_entries VALUES
 (4,NULL,NULL,'2026-09-05','2026-09-05T11:00:00Z','2026-09-05T11:00:00Z','manual_out','out',5000,NULL,'Администратор','Передано владельцу'),
 (5,NULL,NULL,'2026-09-06','2026-09-06T11:00:00Z','2026-09-06T11:00:00Z','ledger_reset','in',0,NULL,'Администратор','');`)
const mixed = await query()
assert.equal(mixed.events.find(r => r.id === 6).recordedLater, true)
assert.equal(mixed.events.find(r => r.id === 6).methodKind, 'unknown')
assert.equal(mixed.events.find(r => r.id === 7).recordedLater, false)
assert.equal(mixed.events.find(r => r.id === 7).originalRecordedAtUnknown, true)
assert.equal((await query('&ledger=cash')).events.length, 4, 'closed cycle must not hide historical cash')
await assert.rejects(() => readFinanceDay(db,new URL('https://fixture/?date=2026-02-30')))
const empty = await readFinanceDay(db,new URL('https://fixture/?date=2026-09-04'))
assert.equal(empty.payments.total,0)
assert.equal(empty.events.length,0)
assert.deepEqual(sqlite.prepare('SELECT * FROM financial_events WHERE id <= 3').all(),original)

const { FinanceDayView, financeRecordedAt } = load('src/features/finance/FinanceDayView.tsx')
const html = renderToStaticMarkup(createElement(FinanceDayView,{ data:day, busy:false, error:'', onReload(){}, onLedger(){}, onMore(){}, onOrder(){} }))
for (const copy of ['Оплаты за день','Наличные','Безналичные','КАСПИ МАГАЗИН','ТЕРМИНАЛ','Относится к 05.09.2026','07.09.2026','17:01','Внесено позже','Закрытие долга']) assert.ok(html.includes(copy),copy)
assert.doesNotMatch(html,/baseline|ledger|canonical|resolver|predicate|read-path/i)
assert.ok(html.includes('с учётом исправлений'))
assert.equal(financeRecordedAt('2026-09-07 12:01:13'), financeRecordedAt('2026-09-07T12:01:13Z'))
assert.equal(financeRecordedAt('broken'), 'Время ввода не сохранено')

// Pagination retains all old entries, including corrections and closed-cycle cash.
for (let id=8;id<=65;id++) sqlite.prepare("INSERT INTO financial_events VALUES(?,2,'KASPI','2026-09-05','2026-09-05T10:00:00Z','order_payment',NULL,1,'ТЕРМИНАЛ','recorded','',0,'2026-09-05T10:00:00Z')").run(id)
const page1 = await query(), page2 = await query('&offset=50')
assert.equal(page1.count,65)
assert.equal(page1.events.length,50)
assert.equal(page1.hasMore,true)
assert.equal(page2.events.length,15)
assert.equal(page2.hasMore,false)
assert.equal(new Set([...page1.events,...page2.events].map(r=>r.id)).size,65)
assert.deepEqual(page1.payments,page2.payments)

const section = fs.readFileSync('src/features/sections/FinanceSection.tsx','utf8')
assert.ok(!section.includes('FinanceDayPanel'), 'a single day must not replace the normal finance workspace')
assert.ok(section.includes("const periodApplies = !['cash', 'methods'].includes(financeMode)"), 'cash and payment-method settings must not inherit the report period')
assert.ok(section.includes('Все операции ниже относятся именно к выбранным датам'), 'period semantics must be explicit to the user')
const router = fs.readFileSync('worker/domains/cash.ts','utf8')
assert.ok(router.includes("if (url.searchParams.get('view') === 'day') return readFinanceDay(db, url)"))
assert.ok(router.includes('ORDER BY fe.event_date DESC, datetime(fe.event_at) DESC, fe.id DESC'))
const rendererSource = fs.readFileSync('src/features/renderers/FinanceDashboardRenderer.tsx', 'utf8')
assert.ok(rendererSource.includes("{ id: 'payments', label: 'Операции', hint: 'По дате операции' }"), 'human money journal label missing')
assert.ok(rendererSource.includes("{ id: 'cash', label: 'Касса', hint: 'Наличные сейчас' }"), 'cash must be presented as current operational state')
assert.ok(!rendererSource.includes('ctx.financeDay'), 'historical day must not replace summary, operations or cash')
assert.ok(rendererSource.includes('moneyHistory.map((row, index)'), 'operations must be grouped by business date')
assert.ok(rendererSource.includes('дата операции'), 'business-date group heading missing')
assert.ok(rendererSource.includes("payment_correction: 'Исправление способа оплаты'"), 'cash journal must not expose payment_correction')
assert.ok(rendererSource.includes('const humanOperations = ['), 'effective payments and returns must drive the human journal')
assert.ok(rendererSource.includes('История исправлений и технический аудит'), 'raw financial events must be secondary audit detail')
assert.ok(rendererSource.includes('Разбивка поступлений по видам и способам оплаты'), 'classification tables must be secondary detail')
assert.ok(!rendererSource.includes('Для истории конкретного дня используйте «Один день»'), 'removed single-day UX must not remain in cash copy')
assert.ok(rendererSource.indexOf('finance-days-truth-panel') < rendererSource.indexOf('finance-reconciliation-v2'), 'day chronology must appear before reconciliation diagnostics')
assert.ok(rendererSource.indexOf('finance-human-operations-block') < rendererSource.indexOf('finance-payment-classification'), 'human operations must appear before classifications')
console.log('FINANCE DAY FOCUSED GREEN — business-date human journal leads; corrections and audit stay secondary; cash remains a separate current-state workspace')
export { day, initialCashDay }
