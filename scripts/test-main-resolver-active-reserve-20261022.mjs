import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

// Exercise the REAL unresolved-shipping SQL, not a mocked copy or a source hash.
const source = readFileSync('worker/domains/order-reservations.ts', 'utf8')
const start = source.indexOf('export async function getOrderShipmentInventoryBlockers')
assert(start >= 0, 'Shipping blocker query not found')
const implementation = source.slice(start)
const matched = implementation.match(/const unresolvedResult = await db\.prepare\(\s*`([\s\S]*?)`\s*\)\.bind\(orderId\)\.all/)
assert(matched, 'Could not extract current unresolved-shipping SQL')
const sql = matched[1]
const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, variant_id INTEGER,
    product_name_snapshot TEXT, quantity INTEGER, is_workshop INTEGER, stock_writeoff_status TEXT
  );
  CREATE TABLE inventory_reservations (
    id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER,
    inventory_source TEXT, variant_id INTEGER, status TEXT, quantity INTEGER
  );
  CREATE TABLE catalog_products (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY, product_id INTEGER);
  CREATE TABLE inventory_stock (id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER);
  INSERT INTO catalog_products VALUES (11, 'ЭТНО КАРДИГАН');
  INSERT INTO catalog_variants VALUES (1498, 11);
  INSERT INTO order_items VALUES (101, 1775, 11, 1498, 'ЭТНО КАРДИГАН', 1, 0, 'reserved');
  INSERT INTO inventory_stock VALUES (1, 'warehouse', 1498);
  INSERT INTO inventory_reservations VALUES (1, 1775, 101, 'warehouse', 1498, 'released', 1);
  INSERT INTO inventory_reservations VALUES (2, 1775, 101, 'warehouse', 1498, 'active', 1);
`)
const blockers = () => db.prepare(sql).all(1775)
assert.equal(blockers().length, 0,
  'An old released reservation must not block a valid current active reservation')
function scenario(label, change, expected) {
  db.exec('SAVEPOINT shipping_scenario')
  try {
    db.exec(change)
    const rows = blockers()
    assert.equal(rows.length, expected, label)
    if (expected) assert.equal(rows[0].blocker_reason, 'unresolved', label + ': reason')
  } finally {
    db.exec('ROLLBACK TO shipping_scenario; RELEASE shipping_scenario')
  }
}
scenario('No active reservation is a genuine blocker',
  "DELETE FROM inventory_reservations WHERE status = 'active'", 1)
scenario('An active reservation with no stock row is a blocker',
  'DELETE FROM inventory_stock WHERE id = 1', 1)
scenario('A fulfilled historical reservation beside the active one is harmless',
  "INSERT INTO inventory_reservations VALUES (3, 1775, 101, 'warehouse', 1498, 'fulfilled', 1)", 0)
scenario('An unresolved historical reservation beside active one is harmless',
  "INSERT INTO inventory_reservations VALUES (3, 1775, 101, 'warehouse', 1498, 'unresolved', 1)", 0)
scenario('A zero-quantity order item cannot block shipping',
  'UPDATE order_items SET quantity = 0 WHERE id = 101', 0)
scenario('Workshop items do not participate in warehouse reservation blockers',
  'UPDATE order_items SET is_workshop = 1 WHERE id = 101', 0)
scenario('An already-fulfilled item cannot block shipping',
  "UPDATE order_items SET stock_writeoff_status = 'fulfilled' WHERE id = 101", 0)
scenario('A newly unresolved item without a reservation must block',
  "UPDATE order_items SET stock_writeoff_status = 'catalog_unresolved'; DELETE FROM inventory_reservations", 1)
scenario('Missing active variant identity must block',
  "UPDATE inventory_reservations SET variant_id = NULL WHERE status = 'active'", 1)
scenario('Wrong stock source must block',
  "UPDATE inventory_reservations SET inventory_source = 'boutique' WHERE status = 'active'", 1)
db.close()
console.log('SHIPPING_CURRENT_RESERVATION_ONLY_PASSED: 10 actual SQLite cases; no production data touched')
