import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const source = fs.readFileSync(path.join(root, 'worker/domains/order-reservations.ts'), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function between(text, start, end) {
  const a = text.indexOf(start)
  check(a >= 0, `Marker missing: ${start}`)
  const b = text.indexOf(end, a + start.length)
  check(b > a, `End marker missing after: ${start}`)
  return text.slice(a, b)
}

try {
  const fn = between(source, 'export async function fetchOrderStockHandoverRows(', 'export function stockHandoverItemFromRow(')
  check(fn.includes('customer.display_name AS customer_name'), 'Customer display name is not selected through the dedicated customer alias')
  check(fn.includes('LEFT JOIN customers customer ON customer.id = o.customer_id'), 'Dedicated customer alias is missing')
  check(!fn.includes('LEFT JOIN customers c ON c.id = o.customer_id'), 'Regression: customer reuses stock-check alias c')
  check(fn.includes('LEFT JOIN inventory_stock_checks c ON c.id = ('), 'Canonical stock-check alias c disappeared unexpectedly')

  const prepareStart = 'const result = await db.prepare(\n      `'
  const prepareIndex = fn.indexOf(prepareStart)
  check(prepareIndex >= 0, 'Canonical handover SQL template start missing')
  const sqlStart = prepareIndex + prepareStart.length
  const sqlEnd = fn.indexOf('`\n    ).bind(', sqlStart)
  check(sqlEnd > sqlStart, 'Canonical handover SQL template end missing')
  const sql = fn.slice(sqlStart, sqlEnd).replace('${orderScope}', '1 = 1')

  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, external_id TEXT, order_date TEXT, created_at TEXT,
      customer_id INTEGER, order_status TEXT, shipping_status TEXT
    );
    CREATE TABLE customers (id INTEGER PRIMARY KEY, display_name TEXT);
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY, order_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT,
      color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT,
      source_type TEXT, quantity INTEGER, stock_writeoff_status TEXT, created_at TEXT,
      inventory_obligation_key TEXT, inventory_obligation_origin_at TEXT, is_workshop INTEGER
    );
    CREATE TABLE inventory_reservations (
      id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER, status TEXT,
      inventory_source TEXT, variant_id INTEGER, quantity INTEGER, created_at TEXT
    );
    CREATE TABLE inventory_stock (
      inventory_source TEXT, variant_id INTEGER, quantity INTEGER, reserved_quantity INTEGER
    );
    CREATE TABLE inventory_handover_reviews (
      id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER, reservation_id INTEGER,
      decision TEXT, checkpoint_id INTEGER, checkpoint_type TEXT, checkpoint_at TEXT,
      reviewed_by TEXT, reviewed_at TEXT
    );
    CREATE TABLE inventory_stock_checks (
      id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER, checked_at TEXT,
      check_type TEXT, reference_type TEXT, reference_id TEXT
    );
    CREATE TABLE inventory_stocktake_sessions (
      id TEXT PRIMARY KEY, inventory_source TEXT, status TEXT, started_at TEXT, completed_at TEXT
    );
  `)
  db.prepare(sql)
  db.close()

  console.log('STEP 192B2A3 HANDOVER SQL ALIAS SAFETY TESTS PASSED — canonical order/handover query compiles with distinct customer and stock-check aliases')
} catch (error) {
  console.error(`STEP 192B2A3 HANDOVER SQL ALIAS SAFETY TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
