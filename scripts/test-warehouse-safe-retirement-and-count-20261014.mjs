import fs from 'node:fs'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const retirement = fs.readFileSync('worker/domains/catalog-retirement.ts','utf8')
const dialog = fs.readFileSync('src/features/inventory/views/CatalogRetirementAction.tsx','utf8')
const quick = fs.readFileSync('src/features/inventory/routineCycleCount.ts','utf8')
const method = retirement.split('export async function retireCatalogEntity(')[1] || ''
assert.ok(method.includes("preview.physicalQuantity !== 0") && method.includes('preview.openOrderItemCount > 0'), 'Server preview must block physical stock and outstanding orders')
assert.ok(method.includes("preview.stockReservedQuantity !== 0") && method.includes("preview.activeReservationQuantity !== 0"), 'Server preview must block both reserve sources')
assert.ok(method.split('AND NOT EXISTS (SELECT 1 FROM catalog_retirement_operations op WHERE op.request_id=?)').length === 3, 'Both product and execution retirement paths missing')
assert.ok(method.split('$'+'{zeroWorkingStateGuard}').length === 3, 'Both transaction-scoped INSERT guards required')
assert.ok(dialog.includes('disabled={deleting || blockedByWorkingStock}'), 'Dialog must prevent confirming unsafe deletion')
assert.ok(dialog.includes('Система не будет автоматически обнулять склад'), 'Dialog should explain why deletion is blocked')
const conflictBlock = quick.split("if (result?.code === 'changed') {")[1]?.split('const refreshes')[0] || ''
assert.ok(!conflictBlock.includes('setValues('), 'Short check discards employee count on stale baseline')
assert.ok(quick.includes('Введённое количество сохранено на экране'), 'Explain retained measurement after failed short check')

// Execute the actual production SQL predicate against SQLite, not a paraphrase.
const tick = String.fromCharCode(96)
const prefix = 'const zeroWorkingStateGuard = '+tick
const start = method.indexOf(prefix)
const end = method.indexOf(tick+';', start+prefix.length)
assert.ok(start >= 0 && end > start, 'Cannot extract actual SQL retirement guard')
const template = method.slice(start+prefix.length,end)
const db = new DatabaseSync(':memory:')
db.exec([
'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);',
'CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY, product_id INTEGER);',
'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,is_active INTEGER);',
'CREATE TABLE inventory_stock(variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);',
'CREATE TABLE inventory_reservations(variant_id INTEGER,status TEXT);',
'CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT);',
'CREATE TABLE order_items(variant_id INTEGER,order_id INTEGER,quantity INTEGER);',
'INSERT INTO catalog_products VALUES(1);',
'INSERT INTO catalog_stock_positions VALUES(10,1);',
'INSERT INTO catalog_variants VALUES(100,1,10,1),(101,1,10,1);',
'INSERT INTO inventory_stock VALUES(100,0,0),(101,0,0);'
].join('\n'))
function allowed(kind) {
  const where=kind==='product'?'live_v.product_id = p.id':'live_v.stock_position_id = sp.id'
  const guard=template.replaceAll('$'+'{workingVariantCondition}', where)
  const base=kind==='product'?'SELECT 1 FROM catalog_products p WHERE p.id=1':'SELECT 1 FROM catalog_stock_positions sp WHERE sp.id=10'
  return !!db.prepare(base+' '+guard).get()
}
for (const kind of ['product','execution']) {
  assert.equal(allowed(kind),true,kind+' clean entry should be retireable')
  db.exec('UPDATE inventory_stock SET quantity=1 WHERE variant_id=100')
  assert.equal(allowed(kind),false,kind+' physical stock allowed destructive retirement')
  db.exec('UPDATE inventory_stock SET quantity=-1 WHERE variant_id=101')
  assert.equal(allowed(kind),false,kind+' net-zero but real SKU stock bypassed guard')
  db.exec('UPDATE inventory_stock SET quantity=0')
  db.exec('UPDATE inventory_stock SET reserved_quantity=2 WHERE variant_id=100')
  assert.equal(allowed(kind),false,kind+' reserved stock allowed destructive retirement')
  db.exec('UPDATE inventory_stock SET reserved_quantity=0')
  db.exec("INSERT INTO inventory_reservations VALUES(100,'active')")
  assert.equal(allowed(kind),false,kind+' active reservation allowed destructive retirement')
  db.exec('DELETE FROM inventory_reservations')
  db.exec("INSERT INTO orders VALUES(7,'active','not_sent'); INSERT INTO order_items VALUES(100,7,1)")
  assert.equal(allowed(kind),false,kind+' pending order allowed destructive retirement')
  db.exec('DELETE FROM order_items; DELETE FROM orders')
  assert.equal(allowed(kind),true,kind+' resolved entry was still blocked')
}
console.log('WAREHOUSE SAFE RETIREMENT PASSED: product/execution guard physical quantity, reservations, orders; short-check retains count')
