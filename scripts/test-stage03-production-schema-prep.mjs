import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const workflow = read('.github/workflows/stage03-production-schema-prep-0073-0074.yml')
const migration73 = read('migrations/0073_v72_order_item_pricing_foundation.sql')
const migration74 = read('migrations/0074_v72_retained_order_pricing_mode.sql')

check(workflow.includes('branches:\n      - main'), 'Stage03 Production schema prep must be main-only')
check(workflow.includes("paths:\n      - '.github/workflows/stage03-production-schema-prep-0073-0074.yml'"), 'Stage03 Production schema prep must trigger only when its guarded workflow is intentionally merged')
check(workflow.includes('"name": "orders-app"'), 'Production Worker identity guard missing')
check(workflow.includes('"database_name": "orders_db_prod"'), 'Production D1 logical-name guard missing')
check(workflow.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'Production D1 immutable-id guard missing')
check(workflow.includes('orders-app-branch2') && workflow.includes('orders_db_branch2') && workflow.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'Branch2 negative hard-stop guard missing')
check(workflow.includes('Partial 0073 state detected'), 'Partial 0073 schema state is not fail-closed')
check(workflow.includes('PRE_0073_PRESENT') && workflow.includes('PRE_0074_PRESENT'), 'Idempotent schema preflight markers missing')

const apply73 = workflow.indexOf('- name: Apply 0073 if absent')
const verify73 = workflow.indexOf('- name: Verify 0073 legacy classification and zero historical price snapshots')
const apply74 = workflow.indexOf('- name: Apply 0074 if absent')
const verify74 = workflow.indexOf('- name: Verify 0074 retained legacy classification')
check(apply73 >= 0 && verify73 > apply73 && apply74 > verify73 && verify74 > apply74, '0073/0074 Production sequencing drifted')
check(workflow.includes('all existing Production orders must remain legacy/manual'), '0073 historical order classification guard missing')
check(workflow.includes('Historical Production order items unexpectedly received Catalog price snapshots.'), '0073 zero historical Catalog-snapshot guard missing')
check(workflow.includes('all retained Production history must remain legacy/manual'), '0074 retained-history classification guard missing')
check(workflow.includes('Production live finance fingerprint changed during Stage03 schema prep.'), 'Live finance fingerprint comparison missing')
check(workflow.includes('Production retained-history fingerprint changed during Stage03 schema prep.'), 'Retained-history fingerprint comparison missing')
check(!workflow.includes('wrangler deploy') && !workflow.includes('pages deploy'), 'Schema prep workflow must not deploy runtime')

check(migration73.includes("DEFAULT 'legacy_manual_total'") && migration73.includes("'itemized_v1'"), '0073 pricing generation contract missing')
check(migration73.includes('ADD COLUMN catalog_price_snapshot INTEGER'), '0073 Catalog snapshot column missing')
check(!/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(migration73), '0073 must not backfill/rewrite business rows')
check(!/catalog_execution_prices/i.test(migration73), '0073 must never infer history from current Catalog prices')

check(migration74.includes('ALTER TABLE retained_order_summaries'), '0074 retained-history table target missing')
check(migration74.includes("DEFAULT 'legacy_manual_total'") && migration74.includes("'itemized_v1'"), '0074 retained pricing generation contract missing')
check(!/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(migration74), '0074 must not backfill/rewrite retained business rows')
check(!/catalog_execution_prices|catalog_price_snapshot/i.test(migration74), '0074 must not infer retained history from Catalog price facts')

console.log('STAGE03 PRODUCTION SCHEMA PREP SAFETY PASSED — 0073/0074 are additive, sequential, idempotence-aware, Production-bound, finance-fingerprinted and contain no runtime deploy or Catalog-derived historical backfill')
