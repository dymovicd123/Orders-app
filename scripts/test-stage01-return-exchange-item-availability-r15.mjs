import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const relations = fs.readFileSync('worker/domains/orders-relations.ts', 'utf8')
const ordersRead = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const ordersWrite = fs.readFileSync('worker/domains/orders-write.ts', 'utf8')
const utils = fs.readFileSync('src/app/utils.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const returnsView = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeView = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')
const types = fs.readFileSync('src/app/types.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(relations.includes('export function orderItemAvailableOperationQuantity'), 'Shared item operation availability projection missing')
check(relations.includes('currentQuantity - activeStandaloneReturnedQuantity'), 'Availability projection does not subtract active standalone returns')
check(relations.includes('standaloneReturnedResult'), 'Order relation read does not load active standalone returned quantities')
check(relations.includes("COALESCE(r.status, 'completed') <> 'cancelled'"), 'Cancelled returns are not excluded from item availability')
check(relations.includes('e.refund_return_id = r.id'), 'Exchange-owned refund return is not excluded from standalone returned quantity')
check(relations.includes("COALESCE(e.status, 'completed') <> 'cancelled'"), 'Active exchange ownership check missing')
check(relations.includes('item.active_standalone_returned_quantity ='), 'Returned quantity is not attached to current order-item read truth')
check(ordersRead.includes('availableOperationQuantity: orderItemAvailableOperationQuantity'), 'Orders list does not expose current item operation availability')
check(ordersWrite.includes('availableOperationQuantity: orderItemAvailableOperationQuantity'), 'Order readback does not expose current item operation availability')
check(types.includes('availableOperationQuantity?: number'), 'Frontend OrderRecord contract lacks current item operation availability')

check(utils.includes('item.availableOperationQuantity ?? item.quantity ?? 0'), 'Return/exchange draft helpers ignore current operation availability')
check(utils.includes('item.maxQuantity > 0'), 'Return draft still offers fully returned positions')
check(app.includes('selectedOldItem.availableOperationQuantity ?? selectedOldItem.quantity ?? 0'), 'Exchange save validation still trusts raw order quantity')
check(exchangeView.includes('operationAvailableQuantity'), 'Exchange form does not project current available old quantity')
check(exchangeView.includes('queuedOldQuantityByItem'), 'Exchange form does not reserve unsaved queued pair quantities locally')
check(exchangeView.includes('max={effectiveOldAvailableQuantity}'), 'Exchange old-quantity input is not capped by current availability')
check(returnsView.includes('<th>Доступно к возврату</th>'), 'Return form still labels remaining quantity as original order quantity')

const marker = '`SELECT r.order_id, ri.order_item_id, COALESCE(SUM(ri.quantity), 0) AS returned_quantity'
const sqlStartMarker = relations.indexOf(marker)
check(sqlStartMarker >= 0, 'Standalone returned-quantity SQL marker missing')
const sqlStart = sqlStartMarker + 1
const sqlEnd = relations.indexOf('`', sqlStart)
check(sqlEnd > sqlStart, 'Standalone returned-quantity SQL end missing')
const sql = relations.slice(sqlStart, sqlEnd).replace('${placeholders}', '?')

const db = new DatabaseSync(':memory:')
db.exec([
  'CREATE TABLE returns (id INTEGER PRIMARY KEY, order_id INTEGER, status TEXT);',
  'CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, order_item_id INTEGER, quantity INTEGER);',
  'CREATE TABLE exchanges (id INTEGER PRIMARY KEY, refund_return_id INTEGER, status TEXT);',
  "INSERT INTO returns(id, order_id, status) VALUES (1, 10, 'completed'), (2, 10, 'cancelled'), (3, 10, 'completed'), (4, 10, 'completed');",
  'INSERT INTO return_items(id, return_id, order_item_id, quantity) VALUES (11, 1, 100, 1), (12, 2, 100, 5), (13, 3, 100, 2), (14, 4, 101, 1);',
  "INSERT INTO exchanges(id, refund_return_id, status) VALUES (21, 3, 'completed'), (22, 4, 'cancelled');",
].join('\n'))

const rows = db.prepare(sql).all(10)
const byItem = new Map(rows.map(row => [Number(row.order_item_id), Number(row.returned_quantity)]))
check(byItem.get(100) === 1, 'Availability SQL counted cancelled or exchange-owned return quantity')
check(byItem.get(101) === 1, 'Cancelled exchange must not hide its formerly-owned return from standalone availability')
const available = (quantity, returned) => Math.max(0, quantity - Math.max(0, returned || 0))
check(available(3, byItem.get(100)) === 2, 'Current remaining item quantity is wrong after standalone return')
check(available(1, byItem.get(100)) === 0, 'Availability projection must clamp at zero')

db.close()

console.log('STAGE01 RETURN/EXCHANGE ITEM AVAILABILITY R15 PASSED — live forms use backend-derived remaining quantity after standalone returns while exchange-owned/cancelled history is classified correctly')
