import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const source = readFileSync(new URL('../worker/domains/warehouse-demand.ts', import.meta.url), 'utf8')
function sqlPart(name, prefix) {
  const re = new RegExp('(?:const|export const) ' + name + ' = ' + prefix + 'String\\.raw' + String.fromCharCode(96) + '([\\s\\S]*?)' + String.fromCharCode(96) + ';')
  const match = source.match(re)
  assert.ok(match, 'missing SQL ' + name)
  return match[1]
}
const base = sqlPart('demandBaseSql', '')
const summarySql = base + sqlPart('warehouseDemandSql', 'demandBaseSql \\+ ')
const ordersSql = base + sqlPart('warehouseDemandOrdersSql', 'demandBaseSql \\+ ')
assert.ok(!/\binventory_stock\b/.test(base + summarySql + ordersSql), 'demand must never read unreliable stock')
assert.ok(!/\b(?:INSERT|UPDATE|DELETE)\s+/i.test(base + summarySql + ordersSql), 'report is read-only')
const db = new DatabaseSync(':memory:')
db.exec("\nCREATE TABLE orders (id INTEGER PRIMARY KEY, external_id TEXT, shipping_status TEXT, shipping_date TEXT, order_status TEXT, pricing_mode TEXT, total_amount INTEGER, order_date TEXT);\nCREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_name_snapshot TEXT, color_snapshot TEXT, size_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, gender_snapshot TEXT, audience_type TEXT, is_workshop INTEGER, source_type TEXT, quantity INTEGER, unit_price INTEGER, line_total INTEGER, stock_writeoff_status TEXT);\nCREATE TABLE returns (id INTEGER PRIMARY KEY, return_date TEXT, status TEXT);\nCREATE TABLE return_items (return_id INTEGER, order_item_id INTEGER, quantity INTEGER);\nCREATE TABLE exchanges (id INTEGER PRIMARY KEY, refund_return_id INTEGER, status TEXT);\nINSERT INTO orders VALUES\n (1,'ORD-1','sent','2026-10-10','active','legacy_manual_total',90000,'2026-10-10'),\n (2,'ORD-2','not_sent',NULL,'active','legacy_manual_total',50000,'2026-10-10'),\n (3,'ORD-3','sent','2026-10-10','deleted','legacy_manual_total',25000,'2026-10-10'),\n (4,'ORD-4','sent','2026-10-10','active','legacy_manual_total',54000,'2026-10-10'),\n (5,'ORD-5','sent','2026-10-10','active','legacy_manual_total',30000,'2026-10-10'),\n (6,'ORD-6','sent','2026-10-12','active','itemized_v1',0,'2026-10-10'),\n (7,'ORD-7','sent','2026-10-12','active','legacy_manual_total',25000,'2026-10-10');\nINSERT INTO order_items VALUES\n (1,1,'Кардиган','Серый','52','Шерсть','','Жен','adult',0,'warehouse',3,30000,90000,'written_off'),\n (2,2,'Не выдан','Синий','46','','','','adult',0,'warehouse',10,5000,50000,'reserved'),\n (3,3,'Удалён','Синий','46','','','','adult',0,'warehouse',5,5000,25000,'written_off'),\n (4,4,'Кардиган','Хаки','48','Шерсть','','Жен','adult',0,'boutique',2,0,0,'written_off'),\n (5,5,'Кардиган','Серый','52','Шерсть','','Жен','adult',0,'warehouse',1,30000,30000,'written_off'),\n (6,6,'Подарок','Белый','46','Хлопок','','Жен','adult',0,'warehouse',1,0,0,'written_off'),\n (7,7,'Платье','Красный','48','Атлас','','Жен','adult',0,'warehouse',1,25000,0,'written_off');\nINSERT INTO returns VALUES\n (1,'2026-10-12','completed'),(2,'2026-10-12','cancelled'),\n (3,'2026-11-01','completed'),(4,'2026-10-12','completed');\nINSERT INTO return_items VALUES (1,1,1),(2,1,2),(3,1,2),(4,5,1);\nINSERT INTO exchanges VALUES (1,4,'completed');\n")
const rows = db.prepare(summarySql).all('2026-10-31','shipped','2026-10-01','2026-10-31','shipped','2026-10-01','2026-10-31')
assert.equal(rows.length, 4, 'deleted or unsent orders excluded')
const grey = rows.find(x => x.product === 'Кардиган' && x.color === 'Серый')
const khaki = rows.find(x => x.product === 'Кардиган' && x.color === 'Хаки')
const gift = rows.find(x => x.product === 'Подарок')
const mismatch = rows.find(x => x.product === 'Платье')
assert.equal(grey.sold, 4)
assert.equal(grey.returned, 1, 'only active independent returns before period end')
assert.equal(grey.net, 3)
assert.equal(grey.priced_quantity, 3)
assert.equal(grey.known_revenue, 90000)
assert.equal(khaki.sold, 2)
assert.equal(khaki.priced_quantity, 0, 'legacy zero price is unknown even if order total exists')
assert.equal(khaki.known_revenue, 0, 'do not allocate whole order total')
assert.equal(gift.priced_quantity, 1, 'itemized zero is a known free product')
assert.equal(gift.known_revenue, 0)
assert.equal(mismatch.priced_quantity, 1, 'saved price available even if line_total differs')
assert.equal(mismatch.known_revenue, 25000)
assert.equal(mismatch.price_discrepancy_quantity, 1)
const detail = db.prepare(ordersSql).all(
 '2026-10-31','shipped','2026-10-01','2026-10-31','shipped','2026-10-01','2026-10-31',
 'Кардиган','Серый','52','Шерсть','Не указана','Жен','adult','warehouse',0,
)
assert.equal(detail.length, 2, 'exact SKU reveals two original order lines')
assert.equal(detail.find(x=>x.item_id===1).recorded_price, 30000)
assert.equal(detail.find(x=>x.item_id===1).returned, 1)
assert.equal(detail.find(x=>x.item_id===1).order_total, 90000)
assert.equal(db.prepare(ordersSql).all(
 '2026-10-31','shipped','2026-10-01','2026-10-31','shipped','2026-10-01','2026-10-31',
 'Кардиган','Серый','52','Шерсть','Не указана','Жен','adult','boutique',0,
).length,0,'source isolation')

// The same real database may have many orders but only one sent order.
const ordered = db.prepare(summarySql).all('2026-10-31','orders','2026-10-01','2026-10-31','orders','2026-10-01','2026-10-31')
assert.ok(ordered.some(row => row.product === 'Не выдан'), 'demand mode must include not-sent orders')
assert.equal(ordered.find(row => row.product === 'Не выдан').sold, 10)
assert.ok(!rows.some(row => row.product === 'Не выдан'), 'shipped mode excludes unshipped orders')
console.log('STAGE05_ORDERED_VS_SHIPPED_SCOPE_AND_PRICE_DRILLDOWN_PASSED')
