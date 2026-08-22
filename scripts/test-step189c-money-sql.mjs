import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

const fail = (message) => { throw new Error(message) }
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON;')

try {
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql') && !name.startsWith('0058_')).sort()) {
    db.exec(readFileSync(`migrations/${file}`, 'utf8'))
  }
  const orderColumns = new Set(db.prepare(`PRAGMA table_info('orders')`).all().map((row) => String(row.name)))
  if (!orderColumns.has('manager_snapshot_name')) db.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT;')

  db.prepare(`INSERT INTO orders (id, external_id, order_date, source_type, workshop_status, order_status, total_amount, received_amount, debt_amount, return_amount, created_at, updated_at, shipping_status)
              VALUES (1, 'ORD-189C-TEST', '2026-08-01', 'warehouse', 'ready', 'active', 120, 120, 0, 30, '2026-08-01T10:00:00.000Z', '2026-08-04T12:00:00.000Z', 'sent')`).run()
  db.prepare(`INSERT INTO payments (id, order_id, payment_date, method, amount, payment_kind, comment, created_at) VALUES (101,1,'2026-08-01','НАЛИЧНЫЕ',100,'primary','Первая оплата','2026-08-01T10:05:00.000Z')`).run()
  db.prepare(`INSERT INTO payments (id, order_id, payment_date, method, amount, payment_kind, comment, created_at) VALUES (102,1,'2026-08-02','КАСПИ',20,'debt_close','Закрытие долга','2026-08-02T11:00:00.000Z')`).run()
  db.prepare(`INSERT INTO returns (id, order_id, return_date, amount, payment_method, comment, status, created_at) VALUES (201,1,'2026-08-03',30,'КАСПИ','Обычный возврат','completed','2026-08-03T09:00:00.000Z')`).run()
  db.prepare(`INSERT INTO returns (id, order_id, return_date, amount, payment_method, comment, status, created_at, cancelled_at, cancellation_comment) VALUES (202,1,'2026-08-03',10,'НАЛИЧНЫЕ','Ошибочный возврат','cancelled','2026-08-03T10:00:00.000Z','2026-08-03T10:30:00.000Z','Отмена возврата')`).run()
  db.prepare(`INSERT INTO exchanges (id, order_id, exchange_date, old_quantity, new_source_type, status, comment, created_at, financial_action, financial_amount, payment_method, payment_id, cancelled_at, cancellation_comment)
              VALUES (301,1,'2026-08-04',1,'warehouse','cancelled','Обмен с доплатой','2026-08-04T10:00:00.000Z','extra_payment',15,'КАСПИ',NULL,'2026-08-04T11:00:00.000Z','Отмена обмена')`).run()

  const before = {
    payments: db.prepare('SELECT COUNT(*) AS n, SUM(amount) AS s FROM payments').get(),
    returns: db.prepare('SELECT COUNT(*) AS n, SUM(amount) AS s FROM returns').get(),
    exchanges: db.prepare('SELECT COUNT(*) AS n FROM exchanges').get(),
  }
  const migration = readFileSync('migrations/0058_v72_reliable_money_history.sql', 'utf8')
  db.exec(migration)

  const first = db.prepare('SELECT COUNT(*) AS n, SUM(amount_delta) AS net FROM financial_events').get()
  if (Number(first.n) !== 7) fail(`Backfill count ${first.n}, ожидалось 7.`)
  if (Number(first.net) !== 90) fail(`Backfill net ${first.net}, ожидалось 90.`)
  const kinds = Object.fromEntries(db.prepare('SELECT event_type, COUNT(*) AS n FROM financial_events GROUP BY event_type').all().map((row) => [String(row.event_type), Number(row.n)]))
  for (const [kind, count] of Object.entries({ order_payment: 1, debt_close: 1, order_refund: 2, refund_reversal: 1, exchange_extra: 1, payment_reversal: 1 })) {
    if (kinds[kind] !== count) fail(`${kind}: ${kinds[kind] || 0}, ожидалось ${count}.`)
  }
  const marker = db.prepare(`SELECT value FROM app_settings WHERE key='financial_history_model'`).get()
  if (String(marker?.value || '') !== '189c-v1') fail('financial_history_model marker не установлен.')

  db.exec(migration)
  const retry = db.prepare('SELECT COUNT(*) AS n, SUM(amount_delta) AS net FROM financial_events').get()
  if (Number(retry.n) !== 7 || Number(retry.net) !== 90) fail('0058 не retry-safe.')
  const after = {
    payments: db.prepare('SELECT COUNT(*) AS n, SUM(amount) AS s FROM payments').get(),
    returns: db.prepare('SELECT COUNT(*) AS n, SUM(amount) AS s FROM returns').get(),
    exchanges: db.prepare('SELECT COUNT(*) AS n FROM exchanges').get(),
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('0058 изменила текущие payments/returns/exchanges.')

  const fks = db.prepare(`PRAGMA foreign_key_list('financial_events')`).all()
  if (fks.length) fail('financial_events неожиданно получила FK: retention должен быть независимым.')
  console.log('Step 189C reliable money history SQL tests: OK')
} catch (error) {
  console.error(`Step 189C reliable money history SQL tests FAILED: ${error?.message || error}`)
  process.exit(1)
}
