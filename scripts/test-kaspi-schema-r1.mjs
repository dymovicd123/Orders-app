import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0082_v72_kaspi_order_payment_method.sql')
const workflow = read('.github/workflows/kaspi-order-separation-branch2-migration-0082.yml')

check(migration.includes('ALTER TABLE orders ADD COLUMN order_payment_method TEXT'), '0082 must add only the order-level payment identity column')
check(migration.includes("SET order_payment_method = 'КАСПИ МАГАЗИН'"), '0082 historical recovery missing')
check(migration.includes("UPPER(TRIM(COALESCE(p.method, ''))) = 'КАСПИ МАГАЗИН'"), '0082 does not recover from factual Kaspi payments')
check(migration.includes('AND NOT EXISTS') && migration.includes("<> 'КАСПИ МАГАЗИН'"), '0082 could classify mixed-payment history as Kaspi')
check(!migration.includes('delivery_type'), '0082 must not infer Kaspi from delivery')
check(migration.includes('idx_orders_order_payment_method_status_date'), '0082 list index missing')
check(!/\b(?:DELETE|DROP|INSERT|REPLACE)\b/i.test(migration), '0082 widened beyond additive column/backfill/index scope')

check(workflow.includes('branches:\n      - branch2'), '0082 workflow is not Branch2-only')
check(workflow.includes('"name": "orders-app-branch2"'), '0082 workflow does not hard-lock the Branch2 Worker')
check(workflow.includes('"database_name": "orders_db_branch2"'), '0082 workflow does not hard-lock the Branch2 D1 name')
check(workflow.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), '0082 workflow does not hard-lock the Branch2 D1 id')
check(workflow.includes('orders_db_prod') && workflow.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), '0082 workflow does not explicitly reject Production D1')
check(workflow.includes("pragma_table_info('orders')") && workflow.includes("column_exists"), '0082 rerun guard missing')
check(workflow.includes('already exists; keeping rerun idempotent'), '0082 rerun path is not explicit')
check(workflow.includes('missing_backfill') && workflow.includes('idx_orders_order_payment_method_status_date'), '0082 post-migration verification incomplete')

console.log('KASPI SCHEMA R1 PASSED — Branch2-only additive order payment identity, conservative history recovery, no delivery inference, rerun-safe workflow and Production hard-stop')
