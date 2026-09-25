import fs from 'node:fs'

const sql = fs.readFileSync('scripts/stage03-branch2-test-reset.sql', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(sql.includes("LIKE 'BR2-H8-%'"), 'Fixture cleanup is not scoped to the BR2-H8 prefix')
check(sql.includes("DELETE FROM orders;"), 'Order cleanup missing')
check(sql.includes("DELETE FROM customers;"), 'Customer cleanup missing')
check(sql.includes("DELETE FROM financial_events;"), 'Money-history cleanup missing')
check(sql.includes("DELETE FROM inventory_reservations;"), 'Reservation cleanup missing')
check(sql.includes("UPDATE inventory_stock\nSET reserved_quantity = 0"), 'Reservation aggregate reset missing')
check(sql.includes("BR2-H8-A ОСНОВНОЙ") && sql.includes("BR2-H8-C БЕЗ ЦЕНЫ") && sql.includes("BR2-H8-D ЦЕХ"), 'Expected isolated acceptance fixtures missing')
check(!/DELETE\s+FROM\s+(app_users|app_sessions|managers|reference_values|app_settings)\b/i.test(sql), 'Reset must not delete auth, managers, references or app settings')
check(!/DELETE\s+FROM\s+catalog_(products|variants|stock_positions|execution_prices)\s*;/i.test(sql), 'Reset must not globally wipe Catalog master data')
check(!/UPDATE\s+inventory_stock\s+SET\s+quantity\s*=/i.test(sql), 'Reset must not rewrite non-test physical stock quantities')
check(!/DROP\s+(TABLE|TRIGGER|INDEX)/i.test(sql), 'Reset must not change schema objects')
check(!sql.includes('orders_db_prod') && !sql.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Production D1 identity is forbidden in reset SQL')

console.log('STAGE03 BRANCH2 TEST RESET SAFETY PASSED — transactional residue is cleared, master/auth data and non-test physical quantities are preserved, and fixtures are isolated under BR2-H8-*')
