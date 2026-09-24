import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0075_v72_zammler_workshop_due_time.sql')
const refs = read('migrations/0002_reference_values.sql')

check(migration.includes('ALTER TABLE order_items ADD COLUMN workshop_due_time TEXT'), '0075 order-item due time missing')
check(migration.includes('ALTER TABLE workshop_tasks ADD COLUMN due_time TEXT'), '0075 workshop-task due time missing')
check(migration.includes("('delivery_type', 'ZAMMLER'"), '0075 ZAMMLER delivery reference missing')
check(migration.includes('ON CONFLICT(kind, value) DO UPDATE SET'), '0075 ZAMMLER reference seed must be idempotent')
check(refs.includes("('payment_method', 'КАСПИ МАГАЗИН'"), 'Existing KASPI MAGAZIN payment reference disappeared')
check(!migration.includes('CREATE TABLE zammler') && !migration.includes('zammler_orders'), 'ZAMMLER must reuse the existing order model')
check(!migration.includes('marketplace_order') && !migration.includes('kaspi_order'), 'No invented marketplace identifier belongs in the foundation')
check(!migration.includes('UPDATE orders') && !migration.includes('UPDATE order_items'), '0075 must not rewrite existing commercial order data')

console.log('STAGE04-ZAMMLER-A FOUNDATION PASSED — existing orders/workshop model retained; ZAMMLER delivery reference and editable workshop due time added without a second order system')
