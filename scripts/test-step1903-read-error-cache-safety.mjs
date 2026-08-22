import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import { readWorkerSource } from './lib/worker-source.mjs'
import { readAppControllerSource, readInventorySource } from './lib/frontend-source.mjs'
const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const worker = readWorkerSource()
const app = readAppControllerSource()
const types = read('src/app/types.ts')
const ordersView = read('src/features/sections/OrdersTableSection.tsx')
const clientsView = read('src/features/sections/ClientsSection.tsx')
const debtView = read('src/features/sections/OrderDebtSection.tsx')
const financeView = read('src/features/renderers/FinanceDashboardRenderer.tsx')
const inventory = readInventorySource()
const fail = (message) => { throw new Error(message) }
const expect = (condition, message) => { if (!condition) fail(message) }

function body(name, nextName) {
  const start = worker.indexOf(`async function ${name}`)
  expect(start >= 0, `Missing function ${name}`)
  const end = nextName ? worker.indexOf(`async function ${nextName}`, start + 1) : worker.length
  expect(end > start, `Cannot determine ${name} body`)
  return worker.slice(start, end)
}

expect(worker.includes("readPathSafety: '1903'"), 'Missing Step 190.3 live health marker')
expect(worker.includes("cloudflareBulkLimits: '1902'"), 'Step 190.2 prerequisite marker disappeared')

const listOrders = body('listOrders', 'listOpenDebtOrders')
expect(listOrders.includes("Math.min(200, Math.max(20, toInt(url.searchParams.get('limit'), 100)))"), 'Orders list is not server-paged at 100/200')
expect(listOrders.includes("const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0))"), 'Orders offset pagination missing')
expect(listOrders.includes('LIMIT ? OFFSET ?'), 'Orders SQL LIMIT/OFFSET missing')
expect(listOrders.includes('totalCount'), 'Orders total count metadata missing')
expect(listOrders.includes('hasMore: offset + orders.length < totalCount'), 'Orders hasMore metadata missing')

const debts = body('listOpenDebtOrders', 'resolveCatalogProductAndVariantLegacy')
expect(debts.includes("COUNT(*) AS count, COALESCE(SUM(o.debt_amount), 0) AS total_debt"), 'Open-debt lifetime summary missing')
expect(debts.includes("p.payment_kind = 'debt_close'"), 'Debt-close lightweight history missing')
expect(debts.includes('debt_close_count') && debts.includes('debt_close_amount'), 'Debt-close lifetime summary missing')
expect(debts.includes('json_each(?)'), 'Debt item hydration is not a single JSON ID-set query')
expect(!debts.includes('fetchOrderRelations('), 'Open-debt endpoint still hydrates all order relations')
expect(app.includes('apiFetch(`/api/orders/open-debts?limit=500&offset=${offset}`)'), 'Debt UI does not use the paged lightweight endpoint')
expect(!app.includes("limit: '5000'"), 'Debt UI still requests 5000 full orders')

const client = body('getClientDetails', 'ensureOrderItemWorkshopColumn')
expect(client.includes("Math.min(80, Math.max(20, toInt(url.searchParams.get('limit'), 40)))"), 'Client history server page limit missing')
expect(client.includes("const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0))"), 'Client history offset missing')
expect(client.includes('clientStatsCte()'), 'Client lifetime SQL aggregate missing')
expect(client.includes('totalOrderCount'), 'Client lifetime total order count missing')
expect(!client.includes('LIMIT 300'), 'Client details still caps lifetime calculation at 300')
expect(app.includes('clientDetails.orders.length : 0'), 'Client load-more offset is not based on loaded rows')
expect(clientsView.includes("loadClientDetails(selectedClientSummary.id, true)"), 'Client drawer has no load-more action')

const cycles = body('listCashRegisterCycles', 'listFinancialHistory')
expect(cycles.includes('LAG(id, 1, 0) OVER (ORDER BY id)'), 'Cash cycles do not compute bounds set-wise')
expect(cycles.includes('LIMIT ? OFFSET ?'), 'Cash cycles have no page query')
expect(!cycles.includes('for (const reset'), 'Cash cycles still run per-cycle query loops')
expect(financeView.includes('loadCashRegisterCycles(true)'), 'Cash cycle UI has no load-more action')

expect(app.includes('const OPERATIONAL_GET_STALE_TTL_MS = 45 * 1000'), 'Operational stale TTL is not 45 seconds')
expect(app.includes('const SUPPORTING_GET_STALE_TTL_MS = 3 * 60 * 1000'), 'Supporting stale TTL is not bounded to 3 minutes')
expect(app.includes('staleReadTtlForUrl(url)'), 'GET fallback does not choose TTL by endpoint class')
expect(!app.includes('GET_RESPONSE_CACHE_TTL_MS = 15 * 60 * 1000'), 'Old silent 15-minute fallback remains')
const transientSet = /const TRANSIENT_API_STATUSES = new Set\(\[([^\]]+)\]\)/.exec(app)?.[1] || ''
expect(!/(^|\D)500(\D|$)/.test(transientSet), 'Deterministic HTTP 500 is still retried')
expect(/503/.test(transientSet), 'HTTP 503 must remain transient/retryable')

expect(worker.includes('function publicApiError(error: unknown): PublicApiError'), 'Public API error classifier missing')
expect(worker.includes("message: 'Не удалось выполнить операцию с данными."), 'Technical D1/SQLite errors are not sanitized')
expect(worker.includes('const publicError = publicApiError(error);'), 'Router catch does not use public error classification')
expect(!worker.includes('Ошибка базы данных: ${raw}'), 'Raw database error leak remains')
expect(!worker.includes('friendlyErrorMessage(error)'), 'A route still flattens classified errors to a hard-coded status')
expect(worker.includes("return json({ ok: false, message: 'Клиент не найден.' }, { status: 404 })"), 'Known client-not-found is not 404')

expect(types.includes('totalCount?: number'), 'OrderListResponse paging type missing')
expect(types.includes('totalOrderCount?: number'), 'ClientDetailsResponse paging type missing')
expect(ordersView.includes("changeOrderPage('previous')") && ordersView.includes("changeOrderPage('next')"), 'Orders UI pagination controls missing')
expect(debtView.includes('debtOverview.totalDebt'), 'Debt summary is still calculated from the truncated loaded page')
expect(debtView.includes('loadAllOpenDebtOrders(true)'), 'Open-debt UI has no load-more action')
expect(debtView.includes('debtOverview.historyAmount'), 'Debt-close summary is still calculated from the truncated history page')

// Arrival is a frozen UI invariant and Step 190.3 must not touch it.
const ARRIVAL_START = '<div className="inventory-arrival-legacy-workspace">'
const ARRIVAL_END = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
const start = inventory.indexOf(ARRIVAL_START)
const end = start >= 0 ? inventory.indexOf(ARRIVAL_END, start) : -1
expect(start >= 0 && end >= 0, 'Frozen Arrival block missing')
const hash = crypto.createHash('sha256').update(inventory.slice(start, end + ARRIVAL_END.length)).digest('hex')
expect(hash === 'd8806f8f7971d6ee5c4c656d5cdf1551297ecc6ad01cc84730b16c3153bd05bf', 'Arrival UI changed during Step 190.3')

// Validate the single-query cash-cycle shape against local SQLite, including pagination.
const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE cash_register_entries (
  id INTEGER PRIMARY KEY, occurred_at TEXT, business_date TEXT, direction TEXT, amount INTEGER,
  entry_type TEXT, comment TEXT, created_by TEXT
)`)
const insert = db.prepare('INSERT INTO cash_register_entries(id, occurred_at, business_date, direction, amount, entry_type, comment, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
insert.run(1, '2026-08-01T09:00:00Z', '2026-08-01', 'in', 100, 'manual_in', 'start', 'admin')
insert.run(2, '2026-08-01T10:00:00Z', '2026-08-01', 'out', 25, 'manual_out', 'expense', 'admin')
insert.run(3, '2026-08-01T18:00:00Z', '2026-08-01', 'in', 0, 'ledger_reset', 'cycle 1', 'admin')
insert.run(4, '2026-08-02T09:00:00Z', '2026-08-02', 'in', 60, 'manual_in', 'start2', 'admin')
insert.run(5, '2026-08-02T18:00:00Z', '2026-08-02', 'in', 0, 'ledger_reset', 'cycle 2', 'admin')
insert.run(6, '2026-08-03T09:00:00Z', '2026-08-03', 'in', 90, 'manual_in', 'start3', 'admin')
insert.run(7, '2026-08-03T18:00:00Z', '2026-08-03', 'in', 0, 'ledger_reset', 'cycle 3', 'admin')
const cycleSql = `WITH reset_bounds AS (
  SELECT id, occurred_at, business_date, comment, created_by, LAG(id, 1, 0) OVER (ORDER BY id) AS previous_reset_id
  FROM cash_register_entries WHERE entry_type = 'ledger_reset'
), page AS (SELECT * FROM reset_bounds ORDER BY id DESC LIMIT ? OFFSET ?)
SELECT p.id, p.previous_reset_id, COUNT(e.id) AS entry_count,
 COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE 0 END), 0) AS total_in,
 COALESCE(SUM(CASE WHEN e.direction = 'out' THEN e.amount ELSE 0 END), 0) AS total_out
FROM page p LEFT JOIN cash_register_entries e ON e.id > p.previous_reset_id AND e.id < p.id
GROUP BY p.id, p.previous_reset_id ORDER BY p.id DESC`
const first = db.prepare(cycleSql).all(2, 0)
const second = db.prepare(cycleSql).all(2, 1)
expect(first.length === 2 && Number(first[0].id) === 7 && Number(first[1].id) === 5, 'Cash cycle first page order/bounds failed')
expect(Number(first[0].total_in) === 90 && Number(first[1].total_in) === 60, 'Cash cycle aggregate failed')
expect(second.length === 2 && Number(second[0].id) === 5 && Number(second[1].id) === 3, 'Cash cycle offset page failed')
db.close()

console.log('STEP 190.3 READ / ERROR / CACHE SAFETY TESTS PASSED')
