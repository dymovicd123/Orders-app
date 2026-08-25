import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function cashBalance(db) {
  const row = db.prepare("SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS balance FROM cash_register_entries").get()
  return Number(row?.balance || 0)
}

try {
  const app = read('src/App.tsx')
  const worker = read('worker/index.ts')
  const money = read('worker/domains/money.ts')
  const finance = read('worker/domains/finance-reports.ts')
  const cash = read('worker/domains/cash.ts')
  const migration = read('migrations/0046_v72_cash_register_and_inventory_revision.sql')
  const orderWrite = read('worker/domains/orders-write.ts')

  // Neighboring frontend paths must retain their established explicit semantics.
  check(app.includes("paymentKind: 'debt_close' as const") && app.includes("apiFetch('/api/payments'"), 'Dedicated debt-close flow no longer uses the safe payment endpoint')
  check(app.includes('payments: createDraft.payments.map'), 'Order creation accidentally stopped sending its initial payments')
  check(worker.includes("url.pathname === '/api/payments' && request.method === 'POST'"), 'Dedicated payment API route disappeared')
  check(money.includes('financialOperationTypeFromPaymentKind(plan.paymentKind)'), 'Manual payment no longer writes semantic immutable financial events')
  check(finance.includes("operationType === 'debt_close'") && finance.includes("operationType === 'order_extra'"), 'Finance reports lost payment-kind separation')
  check(cash.includes('includeLegacy') && cash.includes('traceSeverity'), 'F4 money-history audit controls regressed')

  // The old backend rewrite primitive still exists for explicit legacy/full-rewrite callers, but the generic UI must not invoke it.
  check(orderWrite.includes('removeOrderPaymentsWithMoneyEvents'), 'Expected guarded legacy payment-rewrite primitive disappeared unexpectedly')
  const persistStart = app.indexOf('async function persistOrder(')
  const persistEnd = app.indexOf('async function saveSelectedOrder()', persistStart)
  const persistBlock = app.slice(persistStart, persistEnd)
  check(!persistBlock.includes('payments: nextDraft.payments.map'), 'Order editor PATCH still sends the full payment collection and can trigger rewrite-all')

  // Reproduce the neighboring cash hazard from the real migration. This negative control is why rewrite-all is forbidden.
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      external_id TEXT,
      created_at TEXT,
      order_status TEXT DEFAULT 'active'
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      payment_date TEXT,
      method TEXT,
      amount INTEGER,
      payment_kind TEXT,
      comment TEXT,
      created_at TEXT
    );
    CREATE TABLE returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      return_date TEXT,
      amount INTEGER,
      comment TEXT,
      status TEXT DEFAULT 'completed',
      created_at TEXT
    );
    CREATE TABLE exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER,
      refund_return_id INTEGER,
      comment TEXT
    );
  `)
  db.exec(migration)
  db.prepare("INSERT INTO cash_register_settings (id, opening_amount, initialized_at, auto_tracking_enabled, activated_at, updated_at) VALUES (1, 0, ?, 1, ?, ?)")
    .run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
  db.prepare("INSERT INTO orders (id, external_id, created_at, order_status) VALUES (1, 'ORD-F5-CASH', '2026-08-02T09:00:00.000Z', 'active')").run()
  db.prepare("INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at) VALUES (1, '2026-08-02', 'НАЛИЧКА', 100, 'primary', '', '2026-08-02T09:05:00.000Z')").run()
  check(cashBalance(db) === 100, 'Cash setup negative-control did not capture the original payment')
  db.prepare('UPDATE cash_register_settings SET auto_tracking_enabled = 0 WHERE id = 1').run()
  db.prepare('DELETE FROM payments WHERE order_id = 1').run()
  db.prepare("INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at) VALUES (1, '2026-08-02', 'НАЛИЧКА', 100, 'primary', '', '2026-08-25T12:00:00.000Z')").run()
  check(cashBalance(db) === 0, 'Cash negative-control changed: review the F5 safety assumption before altering editor payment isolation')
  check(Number(db.prepare("SELECT COUNT(*) AS count FROM cash_register_entries WHERE entry_type = 'payment_reversal'").get()?.count || 0) === 1, 'Cash negative-control did not record the destructive rewrite reversal')

  console.log('FINANCE F5 ADJACENT REGRESSION PASSED — create/debt/report/journal paths remain intact, and the cash rewrite hazard is reproduced while the generic editor is statically isolated from it.')
} catch (error) {
  console.error(`FINANCE F5 ADJACENT REGRESSION FAILED: ${error?.message || error}`)
  process.exit(1)
}
