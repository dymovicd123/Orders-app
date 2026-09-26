import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { renderToStaticMarkup } from 'react-dom/server'

const read = p => fs.readFileSync(p, 'utf8')
const nativeRequire = createRequire(import.meta.url)
const modules = new Map()
const auxiliaryReads = []
const auxiliary = {
  listLeadRecords: async () => { auxiliaryReads.push('leads'); return { rows: [{ id: 1, acceptedCount: 8 }], totals: { acceptedCount: 8 } } },
  listCallCentreRecords: async () => { auxiliaryReads.push('callCentre'); return { rows: [{ id: 2, callsMade: 12 }], totals: { callsMade: 12 } } },
  listPlans: async () => { auxiliaryReads.push('plans'); return { managerPlans: [{ id: 3 }], departmentPlans: [] } },
  listTeamEmployees: async () => { auxiliaryReads.push('team'); return { employees: [{ id: 4 }] } },
}
function loadModule(file, source = read(file)) {
  file = path.resolve(file)
  if (modules.has(file)) return modules.get(file).exports
  const module = { exports: {} }
  modules.set(file, module)
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const require = name => {
    if (name.endsWith('/team.ts')) return auxiliary
    if (!name.startsWith('.')) return nativeRequire(name)
    const target = path.resolve(path.dirname(file), name)
    return loadModule(path.extname(target) ? target : `${target}.ts`)
  }
  new Function('require', 'module', 'exports', code)(require, module, module.exports)
  return module.exports
}
const db = new DatabaseSync(':memory:')
db.exec(`
 CREATE TABLE managers(id INTEGER PRIMARY KEY, name TEXT, color_key TEXT);
 CREATE TABLE customers(id INTEGER PRIMARY KEY, display_name TEXT, phone_normalized TEXT, orders_count INTEGER, first_order_at TEXT, last_order_at TEXT);
 CREATE TABLE orders(id INTEGER PRIMARY KEY, external_id TEXT, order_date TEXT, created_at TEXT, order_status TEXT, manager_id INTEGER, manager_snapshot_name TEXT, customer_id INTEGER, city TEXT, total_amount INTEGER, received_amount INTEGER, return_amount INTEGER, debt_amount INTEGER);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER, product_name_snapshot TEXT, material_snapshot TEXT, gender_snapshot TEXT, quantity INTEGER);
 CREATE TABLE payments(id INTEGER PRIMARY KEY, order_id INTEGER, payment_date TEXT, amount INTEGER, payment_kind TEXT, method TEXT, comment TEXT, created_at TEXT);
 CREATE TABLE returns(id INTEGER PRIMARY KEY, order_id INTEGER, manager_id INTEGER, return_date TEXT, amount INTEGER, payment_method TEXT, status TEXT, comment TEXT);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY, return_id INTEGER, product_name_snapshot TEXT, quantity INTEGER);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY, order_id INTEGER, payment_id INTEGER, refund_return_id INTEGER, financial_action TEXT, status TEXT, exchange_date TEXT, old_quantity INTEGER, old_return_source TEXT, new_source_type TEXT, financial_amount INTEGER, comment TEXT);
 CREATE TABLE inventory_movements(movement_type TEXT, inventory_source TEXT, quantity_delta INTEGER, created_at TEXT);
 CREATE TABLE activity_log(event_type TEXT, created_at TEXT);
 CREATE TABLE financial_events(id INTEGER PRIMARY KEY, order_id INTEGER, external_order_id TEXT, event_date TEXT, event_at TEXT, event_type TEXT, related_type TEXT, amount_delta INTEGER, payment_method TEXT, source_type TEXT, source_id INTEGER, source_ref TEXT, reason TEXT, is_backfill INTEGER, created_at TEXT);
 INSERT INTO managers VALUES(1,'A','#123456'),(2,'B','#654321');
 INSERT INTO customers VALUES(1,'Client','123',2,'2026-08-01','2026-09-30');
 INSERT INTO orders VALUES(1,'ONE','2026-09-01','2026-09-02T00:00:00Z','active',1,'A',1,'X',150,999,7,40),
 (2,'TWO','2026-08-31','2026-08-31T00:00:00Z','active',2,'B',1,'Y',50,50,5,0),
 (3,'DELETED','2026-09-15',NULL,'deleted',1,'A',1,'X',999,999,0,0),
 (4,'MISSING','2026-09-30',NULL,'active',NULL,'Snapshot',1,'',20,0,0,20);
 INSERT INTO order_items VALUES(1,1,'Coat','Wool','M',2),(2,1,'Hat','',NULL,1),(3,2,'Coat','Wool','M',1),(4,3,'Deleted','',NULL,50),(5,4,'Hat','',NULL,2);
 INSERT INTO payments VALUES(1,1,'2026-09-01',100,'primary','Kaspi','',NULL),(2,1,'2026-09-02',10,'debt_close','Cash','',NULL),
 (3,1,'2026-09-02',5,'extra','Cash','',NULL),(4,2,'2026-09-03',7,'extra','Kaspi','',NULL),
 (5,3,'2026-09-15',999,'primary','Kaspi','',NULL),(6,4,'2026-08-30',5,'primary','Cash','early',NULL),
 (7,1,'2026-10-01',3,'primary','Cash','',NULL),(8,4,'2026-09-30',2,NULL,NULL,'',NULL);
 INSERT INTO returns VALUES(1,1,2,'2026-09-02',7,'Cash',NULL,''),(2,2,NULL,'2026-09-03',5,'Kaspi','completed',''),(3,1,1,'2026-09-02',999,'Cash','cancelled','');
 INSERT INTO return_items VALUES(1,1,'Coat',1),(2,2,'Hat',1);
 INSERT INTO exchanges VALUES(1,2,4,NULL,'extra_payment','completed','2026-09-03',1,'warehouse','boutique',7,''),
 (2,1,3,NULL,'extra_payment','cancelled','2026-09-02',1,'warehouse','warehouse',5,''),
 (3,2,NULL,2,'refund',NULL,'2026-09-03',1,'warehouse','warehouse',5,'');
 INSERT INTO inventory_movements VALUES('in','warehouse',1,'2026-09-01T00:00:00.000Z');
 INSERT INTO activity_log VALUES('order','2026-09-01T00:00:00.000Z');
`)
const queryReads = []
const adapter = { prepare(sql) {
  const statement = db.prepare(sql)
  let args = []
  return {
    bind(...values) { args = values; return this },
    async all() { queryReads.push(sql); return { results: statement.all(...args) } },
    async first() { queryReads.push(sql); return statement.get(...args) || null },
  }
} }
const currentPath = 'worker/domains/finance-reports.ts'
const current = loadModule(currentPath).listFinanceReports
modules.delete(path.resolve(currentPath))
const baseline = loadModule(currentPath, read('scripts/fixtures/o1-finance-baseline.ts')).listFinanceReports
const url = new URL('https://test/api/reports/finance?startDate=2026-09-01&endDate=2026-09-30')
const stable = result => { const { generatedAt, ...rest } = result; return rest }
const withoutClientReconciliation = result => {
  const stableResult = stable(result)
  const reports = { ...(stableResult.reports || {}) }
  delete reports.paymentMethodReconciliation
  delete reports.paymentReconciliationByDay
  reports.products = (reports.products || []).map(row => {
    const legacyProductRow = Object.create(Object.getPrototypeOf(row))
    for (const [key, value] of Object.entries(row)) {
      if (['itemized_gross_sales', 'itemized_order_count', 'legacy_order_count'].includes(key)) continue
      legacyProductRow[key] = value
    }
    return legacyProductRow
  })
  return { ...stableResult, reports }
}
const canonicalMethod = value => {
  const method = String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!method) return '—'
  if (method === 'КАСПИЙ МАГАЗИН' || method === 'KASPI МАГАЗИН') return 'КАСПИ МАГАЗИН'
  return method
}
const expectedClientReconciliation = result => {
  const methodMap = new Map()
  const dayMap = new Map()
  const emptyMethod = method => ({ method, orderPayments: 0, debtClosures: 0, exchangeExtras: 0, grossInflow: 0, refunds: 0, netMovement: 0 })
  const touchDay = date => {
    const key = String(date || '').trim()
    const current = dayMap.get(key) || { date: key, orderPayments: 0, debtClosures: 0, exchangeExtras: 0, grossInflow: 0, refunds: 0, netMovement: 0 }
    dayMap.set(key, current)
    return current
  }
  for (const operation of result.reports.paymentOperations || []) {
    const method = canonicalMethod(operation.method)
    const current = methodMap.get(method) || emptyMethod(method)
    const day = touchDay(operation.paymentDate)
    const amount = Number(operation.amount || 0)
    if (operation.operationType === 'exchange_extra') {
      current.exchangeExtras += amount
      day.exchangeExtras += amount
    } else if (operation.operationType === 'debt_close' || operation.operationType === 'order_extra') {
      current.debtClosures += amount
      day.debtClosures += amount
    } else {
      current.orderPayments += amount
      day.orderPayments += amount
    }
    current.grossInflow += amount
    day.grossInflow += amount
    methodMap.set(method, current)
  }
  for (const row of result.reports.returns || []) {
    if (String(row.status || '').trim() === 'cancelled') continue
    const method = canonicalMethod(row.payment_method)
    const current = methodMap.get(method) || emptyMethod(method)
    const amount = Number(row.amount || 0)
    current.refunds += amount
    touchDay(row.return_date).refunds += amount
    methodMap.set(method, current)
  }
  return {
    methods: Array.from(methodMap.values())
      .map(row => ({ ...row, netMovement: row.grossInflow - row.refunds }))
      .sort((a,b) => b.grossInflow - a.grossInflow || a.method.localeCompare(b.method, 'ru')),
    days: Array.from(dayMap.values())
      .map(row => ({ ...row, netMovement: row.grossInflow - row.refunds }))
      .sort((a,b) => a.date.localeCompare(b.date)),
  }
}
const assertClientReconciliation = result => {
  const expected = expectedClientReconciliation(result)
  assert.deepEqual(result.reports.paymentMethodReconciliation, expected.methods, 'payment-method reconciliation arithmetic')
  assert.deepEqual(result.reports.paymentReconciliationByDay, expected.days, 'payment-day reconciliation arithmetic')
}
const fields = {
  payments: ['paymentMethods','paymentMethodsByDay','returns'],
  managers: ['managers','managerDays','returns'], products: ['products','productDays'],
  cities: ['cities','cityDays'], returns: ['returns','returnDays'], debts: ['closedDebts','closedDebtDays'],
  leads: ['leads','leadsTotals'], callCentre: ['callCentre','callCentreTotals'],
}
// R6.3 removes two redundant manager-summary reads while preserving full/selected response parity below.
const counts = { payments: 3, managers: 6, products: 3, cities: 6, returns: 2, debts: 2, leads: 0, callCentre: 0 }
const renderer = loadModule('src/features/renderers/FinanceReportContentRenderer.tsx').FinanceReportContentRenderer
const markup = (financeReport, financeReportType) => renderToStaticMarkup(renderer({
  financeReport, financeReportType, financeReportOptions: [],
  formatMoney: String, formatDateShort: String, formatPercent: String,
  ManagerBadge: ({name}) => name, managerColorFor: () => '#123456',
}))
for (const range of [['2026-09-01','2026-09-30'],['2026-08-01','2026-10-01'],['2027-01-01','2027-01-31']]) {
  url.searchParams.set('startDate',range[0]); url.searchParams.set('endDate',range[1])
  url.searchParams.delete('scope'); url.searchParams.delete('reportType')
  const full = await baseline(adapter,url)
  const currentFull = await current(adapter,url)
  assert.deepEqual(withoutClientReconciliation(currentFull),stable(full),'legacy full response parity outside the two intentional additive reconciliation fields')
  assertClientReconciliation(currentFull)
  for (const reportType of Object.keys(fields)) {
    queryReads.length = 0; auxiliaryReads.length = 0
    url.searchParams.set('reportType',reportType)
    const selected = await current(adapter,url)
    assert.equal(selected.reportType,reportType)
    assert.equal(markup(selected,reportType),markup(currentFull,reportType),`${reportType}: complete displayed/exportable report DOM parity`)
    for (const field of fields[reportType]) assert.deepEqual(selected.reports[field],currentFull.reports[field],`${range}: ${reportType}.${field}`)
    if (reportType === 'payments') {
      assertClientReconciliation(selected)
      assert.deepEqual(selected.reports.paymentMethodReconciliation,currentFull.reports.paymentMethodReconciliation,'payments selected/full method reconciliation parity')
      assert.deepEqual(selected.reports.paymentReconciliationByDay,currentFull.reports.paymentReconciliationByDay,'payments selected/full day reconciliation parity')
    }
    if (['managers','cities','products'].includes(reportType)) assert.equal(selected.overview.orderCount,full.overview.orderCount)
    if (['managers','cities'].includes(reportType)) for (const key of ['totalSales','totalReceived','periodDebt']) assert.equal(selected.overview[key],full.overview[key],key)
    assert.equal(queryReads.length,counts[reportType],`${reportType} SQL budget`)
    assert.deepEqual(auxiliaryReads,['leads','callCentre'].includes(reportType) ? [reportType] : [],'no unrelated auxiliary reports')
  }
  url.searchParams.set('reportType','unknown')
  const unknown = await current(adapter,url)
  assert.deepEqual(withoutClientReconciliation(unknown),stable(full),'unknown type keeps legacy full contract outside intentional reconciliation fields')
  assertClientReconciliation(unknown)
  url.searchParams.set('scope','finance'); url.searchParams.set('reportType','products')
  const financeWorkspaceCurrent = await current(adapter,url)
  const financeWorkspaceBaseline = await baseline(adapter,url)
  assert.deepEqual(withoutClientReconciliation(financeWorkspaceCurrent),stable(financeWorkspaceBaseline),'finance workspace legacy contract unaffected outside intentional reconciliation fields')
  assertClientReconciliation(financeWorkspaceCurrent)
}

// Index migration changes access paths, not financial classifications or warehouse rows.
db.exec(`CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER, checked_at TEXT, reference_type TEXT, reference_id TEXT);
CREATE INDEX idx_old_check_time ON inventory_stock_checks(inventory_source,variant_id,checked_at DESC,id DESC);
INSERT INTO inventory_stock_checks VALUES(1,'warehouse',1,'2026-09-01 09:00:00','stocktake','S'),(2,'warehouse',1,'2026-09-01T08:00:00Z','order','O');`)
const indexSql = read('migrations/0067_v72_o1_read_budget_indexes.sql')
assert.ok(!/\b(?:UPDATE|DELETE|INSERT|REPLACE|DROP)\b/i.test(indexSql))
const paymentSql = [...read(currentPath).matchAll(/`([\s\S]*?)`/g)].find(x=>x[1].includes('AS primary_received'))[1]
const before = db.prepare(paymentSql).all('2026-09-01','2026-09-30')
db.exec(indexSql); db.exec(indexSql)
assert.deepEqual(db.prepare(paymentSql).all('2026-09-01','2026-09-30'),before)
assert.ok(db.prepare(`EXPLAIN QUERY PLAN ${paymentSql}`).all('2026-09-01','2026-09-30').some(x=>x.detail.includes('idx_o1_exchanges_payment_finance')))
const checkSql = "SELECT id FROM inventory_stock_checks WHERE inventory_source=? AND variant_id=? ORDER BY datetime(checked_at) DESC,id DESC LIMIT 1"
assert.equal(db.prepare(checkSql).get('warehouse',1).id,1,'mixed-format times sort chronologically')
assert.ok(db.prepare(`EXPLAIN QUERY PLAN ${checkSql}`).all('warehouse',1).some(x=>x.detail.includes('idx_o1_stock_checks_normalized_time')))
const exactSql = "SELECT 1 FROM inventory_stock_checks WHERE inventory_source=? AND variant_id=? AND reference_type='stocktake' AND reference_id=?"
assert.ok(db.prepare(`EXPLAIN QUERY PLAN ${exactSql}`).all('warehouse',1,'S').some(x=>x.detail.includes('idx_o1_stock_checks_exact_stocktake')))
db.close()
console.log('O1 passed: all eight selected reports match full output; strict SQL budgets, legacy/finance contracts, additive idempotent index migration and query plans')
