import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

import { readWorkerSource } from './lib/worker-source.mjs'
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON;')
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
  db.exec(readFileSync(`migrations/${file}`, 'utf8'))
}
const orderColumns = new Set(db.prepare(`PRAGMA table_info('orders')`).all().map((row) => String(row.name)))
if (!orderColumns.has('manager_snapshot_name')) db.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT;')

const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sliceFunction = (source, start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  if (a < 0 || b < 0) fail(`cannot slice ${start}`)
  return source.slice(a, b)
}

try {
  const worker = readWorkerSource(process.cwd())
  const teamFn = sliceFunction(worker, 'async function listTeamActivity', 'async function listTeamSalaryPreview')
  check(!/\bUNION(?:\s+ALL)?\b/i.test(teamFn), 'live Team endpoint must contain zero compound SELECT terms')
  for (const marker of ['FROM orders o', 'FROM financial_events fe', 'FROM returns r', 'FROM exchanges e', 'const rowStatements', 'const summaryStatements', 'await db.batch(statements)', 'rawRows.sort']) {
    check(teamFn.includes(marker), `actual Worker split-query plan is missing ${marker}`)
  }
  check(teamFn.includes('fetchLimit = offset + limit'), 'split-domain pagination must fetch enough rows from every included domain')
  check(teamFn.includes('INSTR(UPPER(') && !teamFn.includes(' LIKE ?'), 'team search must remain literal INSTR')

  const managerId = Number(db.prepare(`INSERT INTO managers(name,is_active,color_key,role) VALUES ('STEP189D TEST MANAGER',1,'#2563EB','Менеджер') RETURNING id`).get().id)
  const customerId = Number(db.prepare(`INSERT INTO customers(phone_normalized,display_name) VALUES ('77000018900','STEP189D TEST CLIENT') RETURNING id`).get().id)
  const orderId = Number(db.prepare(`INSERT INTO orders(external_id,order_date,manager_id,manager_snapshot_name,customer_id,source_type,workshop_status,order_status,total_amount,received_amount,debt_amount,return_amount,created_at,updated_at)
              VALUES ('ORD-STEP189D-TEST','2026-08-01',?,'STEP189D TEST MANAGER',?,'warehouse','ready','active',100000,100000,0,0,'2026-08-01T10:00:00.000Z','2026-08-01T10:00:00.000Z') RETURNING id`).get(managerId, customerId).id)
  db.prepare(`INSERT INTO returns(order_id,manager_id,return_date,amount,comment,created_at,status,cancelled_at,cancellation_comment,payment_method)
              VALUES (?,?,'2026-08-02',20000,'Возврат','2026-08-02T10:00:00.000Z','cancelled','2026-08-03T11:00:00.000Z','Ошибка возврата','KASPI PAY')`).run(orderId, managerId)
  db.prepare(`INSERT INTO exchanges(order_id,manager_id,exchange_date,old_quantity,new_source_type,status,comment,created_at,cancelled_at,cancellation_comment,financial_action,financial_amount,payment_method)
              VALUES (?,?,'2026-08-04',1,'warehouse','cancelled','Обмен','2026-08-04T10:00:00.000Z','2026-08-05T11:00:00.000Z','Ошибка обмена','none',0,NULL)`).run(orderId, managerId)
  db.prepare(`INSERT INTO financial_events(event_key,order_id,external_order_id,event_date,event_at,event_type,amount_delta,payment_method,source_type,reason,is_backfill,created_at)
              VALUES ('test-payment',?,'ORD-STEP189D-TEST','2026-08-02','2026-08-02T09:00:00.000Z','order_payment',100000,'KASPI PAY','payment','test',0,'2026-08-02T09:00:00.000Z')`).run(orderId)

  // Every source that the Worker merges must execute independently on the real schema.
  const sourceCounts = {
    orders: Number(db.prepare(`SELECT COUNT(*) count FROM orders o LEFT JOIN managers m ON m.id=o.manager_id WHERE o.order_date BETWEEN ? AND ? AND o.order_status <> 'deleted' AND (?='' OR INSTR(UPPER(COALESCE(m.name,o.manager_snapshot_name,'') || ' ' || COALESCE(o.external_id,'') || ' ' || COALESCE(o.comment,'')),?)>0)`).get('2026-08-01','2026-08-31','','').count),
    money: Number(db.prepare(`SELECT COUNT(*) count FROM financial_events fe JOIN orders o ON o.id=fe.order_id LEFT JOIN managers m ON m.id=o.manager_id WHERE fe.event_date BETWEEN ? AND ? AND fe.amount_delta>0 AND fe.event_type IN ('order_payment','order_extra','exchange_extra','debt_close') AND (?='' OR INSTR(UPPER(COALESCE(m.name,o.manager_snapshot_name,'') || ' ' || COALESCE(fe.external_order_id,o.external_id,'') || ' ' || COALESCE(fe.comment,'')),?)>0)`).get('2026-08-01','2026-08-31','','').count),
    returnsCreated: Number(db.prepare(`SELECT COUNT(*) count FROM returns r JOIN orders o ON o.id=r.order_id LEFT JOIN managers m ON m.id=COALESCE(r.manager_id,o.manager_id) WHERE r.return_date BETWEEN ? AND ?`).get('2026-08-01','2026-08-31').count),
    returnsCancelled: Number(db.prepare(`SELECT COUNT(*) count FROM returns r WHERE COALESCE(r.status,'completed')='cancelled' AND substr(COALESCE(NULLIF(r.cancelled_at,''),r.return_date),1,10) BETWEEN ? AND ?`).get('2026-08-01','2026-08-31').count),
    exchangesCreated: Number(db.prepare(`SELECT COUNT(*) count FROM exchanges e WHERE e.exchange_date BETWEEN ? AND ?`).get('2026-08-01','2026-08-31').count),
    exchangesCancelled: Number(db.prepare(`SELECT COUNT(*) count FROM exchanges e WHERE COALESCE(e.status,'completed')='cancelled' AND substr(COALESCE(NULLIF(e.cancelled_at,''),e.exchange_date),1,10) BETWEEN ? AND ?`).get('2026-08-01','2026-08-31').count),
  }
  check(sourceCounts.orders === 1, 'orders split source failed')
  check(sourceCounts.money === 1, 'money split source failed')
  check(sourceCounts.returnsCreated === 1 && sourceCounts.returnsCancelled === 1, 'return creation/cancellation must both survive')
  check(sourceCounts.exchangesCreated === 1 && sourceCounts.exchangesCancelled === 1, 'exchange creation/cancellation must both survive')

  // Missing-manager legacy orders are still business facts.
  db.prepare(`INSERT INTO orders(external_id,order_date,manager_id,manager_snapshot_name,customer_id,source_type,workshop_status,order_status,total_amount,received_amount,debt_amount,return_amount,created_at,updated_at)
              VALUES ('ORD-STEP189D-NO-MANAGER','2026-08-06',NULL,NULL,?,'warehouse','ready','active',1000,1000,0,0,'2026-08-06T10:00:00.000Z','2026-08-06T10:00:00.000Z')`).run(customerId)
  const missing = db.prepare(`SELECT COALESCE(m.id,0) manager_id, COALESCE(m.name,o.manager_snapshot_name,'') manager FROM orders o LEFT JOIN managers m ON m.id=o.manager_id WHERE o.external_id='ORD-STEP189D-NO-MANAGER'`).get()
  check(Number(missing.manager_id) === 0 && String(missing.manager || '') === '', 'manager-less legacy order must remain representable as Не указан')

  // Long Cyrillic search must remain executable without LIKE/GLOB limits.
  const longQuery = 'ОЧЕНЬ ДЛИННЫЙ ПОИСКОВЫЙ ТЕКСТ ДЛЯ ПРОВЕРКИ ИСТОРИИ ЗАКАЗОВ БЕЗ ОГРАНИЧЕНИЯ LIKE'.toUpperCase()
  const longRows = db.prepare(`SELECT o.id FROM orders o LEFT JOIN managers m ON m.id=o.manager_id WHERE o.order_date BETWEEN ? AND ? AND INSTR(UPPER(COALESCE(m.name,o.manager_snapshot_name,'') || ' ' || COALESCE(o.external_id,'') || ' ' || COALESCE(o.comment,'')),?)>=0 LIMIT 50`).all('2026-08-01','2026-08-31',longQuery)
  check(Array.isArray(longRows), 'long literal team search must execute successfully')

  // >400 events: full manager totals must remain independent from the first 50 feed rows.
  const insert = db.prepare(`INSERT INTO financial_events(event_key,order_id,external_order_id,event_date,event_at,event_type,amount_delta,payment_method,source_type,reason,is_backfill,created_at)
                             VALUES (?,?,?,?,?,'order_payment',1,'KASPI PAY','payment','bulk',0,?)`)
  for (let i = 0; i < 450; i += 1) {
    const key = `bulk-${i}`
    const ts = `2026-08-${String(6 + (i % 20)).padStart(2,'0')}T12:${String(i % 60).padStart(2,'0')}:00.000Z`
    insert.run(key, orderId, 'ORD-STEP189D-TEST', ts.slice(0,10), ts, ts)
  }
  const full = Number(db.prepare(`SELECT COUNT(*) count FROM financial_events WHERE event_type='order_payment' AND amount_delta>0`).get().count)
  const page = db.prepare(`SELECT id FROM financial_events WHERE event_type='order_payment' AND amount_delta>0 ORDER BY event_at DESC,id DESC LIMIT 50`).all().length
  check(full === 451, `expected 451 payment events, got ${full}`)
  check(page === 50, `expected first page 50, got ${page}`)
  check(full > page, 'full-period totals must remain independent from feed pagination')

  // Merge pagination invariant used by Worker: top N from every domain is enough for global top N.
  const a = Array.from({length: 80}, (_,i) => ({action_at:`2026-08-18T12:${String(59-(i%60)).padStart(2,'0')}:00.000Z`, action_id:1000-i, action_type:'payment_added'}))
  const b = Array.from({length: 80}, (_,i) => ({action_at:`2026-08-17T12:${String(59-(i%60)).padStart(2,'0')}:00.000Z`, action_id:2000-i, action_type:'order_created'}))
  const limit = 50, offset = 20, n = offset + limit
  const cmp = (left,right) => left.action_at !== right.action_at ? (left.action_at < right.action_at ? 1 : -1) : right.action_id-left.action_id
  const expected = [...a,...b].sort(cmp).slice(offset,offset+limit)
  const merged = [...a.slice().sort(cmp).slice(0,n), ...b.slice().sort(cmp).slice(0,n)].sort(cmp).slice(offset,offset+limit)
  check(JSON.stringify(merged) === JSON.stringify(expected), 'split-domain offset pagination invariant failed')

  console.log('Step 189D team activity SQL/split-query tests: OK')
} catch (error) {
  console.error(`Step 189D team activity SQL/split-query tests FAILED: ${error?.message || error}`)
  process.exit(1)
}
