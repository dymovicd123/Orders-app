import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {
  ORDER_MANAGER_AUDIT_COLUMNS,
  inspectOrderManagerSchema,
  planOrderManagerSchemaReconciliation,
} from './order-manager-schema-reconciliation-20261030.mjs'

const makeAdapter = sqlite => ({
  prepare(statement) {
    return {async all() {return {results:sqlite.prepare(statement).all()}}}
  }
})

function freshMigrations() {
  const sqlite = new DatabaseSync(':memory:')
  const files = fs.readdirSync('migrations').filter(n => /^\d{4}.*\.sql$/.test(n)).sort()
  assert(files.length >= 114, 'Versioned migration inventory shrank')
  for (const file of files) sqlite.exec(fs.readFileSync('migrations/'+file,'utf8'))
  return {sqlite, files}
}
const {sqlite,files}=freshMigrations()
const observation=await inspectOrderManagerSchema(makeAdapter(sqlite))
assert.equal(observation.auditTableExists,false)
assert(!observation.ordersColumns.some(x=>x.name==='manager_snapshot_name'))
const plan=planOrderManagerSchemaReconciliation(observation)
assert.equal(plan.requiresExplicitApproval,true)
assert.deepEqual(plan.steps.map(x=>x.id),['orders-manager-snapshot-name','order-manager-audit'])
assert(plan.steps.every(x=>/^ALTER TABLE orders ADD COLUMN|^CREATE TABLE order_manager_audit/.test(x.sql)),
  'Only the two enumerated, additive SQL statements may be generated')
assert(plan.steps.every(x=>!/(?:DROP|DELETE|UPDATE|INSERT|REPLACE|PRAGMA writable_schema)/i.test(x.sql)),
  'The repair plan must not mutate existing physical, order or audit rows')

// Simulate an approved plan on a DISPOSABLE LOCAL SQLite database ONLY.
// This is deliberately NOT a remote D1 migration runner.
sqlite.exec("INSERT INTO managers(id,name,is_active) VALUES(9980,'Schema manager',1)")
sqlite.exec("INSERT INTO orders(id,external_id,order_date,source_type,manager_id,created_at,updated_at) VALUES(9980,'SCHEMA-TEST','2026-10-30','warehouse',9980,'2026-10-30','2026-10-30')")
const before=sqlite.prepare('SELECT id,external_id,manager_id FROM orders WHERE id=9980').get()
for(const step of plan.steps) sqlite.exec(step.sql)
const again=planOrderManagerSchemaReconciliation(await inspectOrderManagerSchema(makeAdapter(sqlite)))
assert.equal(again.needsReconciliation,false,'Already reconciled schema should produce no SQL')
assert.deepEqual(again.steps,[])
assert.deepEqual({...sqlite.prepare('SELECT id,external_id,manager_id FROM orders WHERE id=9980').get()},{...before},
  'Existing order cannot be rewritten during schema reconciliation')
const auditCols=new Set(sqlite.prepare('PRAGMA table_info(order_manager_audit)').all().map(x=>x.name))
for(const name of ORDER_MANAGER_AUDIT_COLUMNS)assert(auditCols.has(name),name)
sqlite.prepare(`INSERT INTO order_manager_audit(
  order_id,external_id,new_manager_id,new_manager_name,action,source,created_at
) VALUES(9980,'SCHEMA-TEST',9980,'Schema manager','created','order_create','2026-10-30')`).run()
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_manager_audit').get().n,1)
assert.equal(planOrderManagerSchemaReconciliation(await inspectOrderManagerSchema(makeAdapter(sqlite))).steps.length,0,
  'Re-reading existing audit must not produce a new CREATE')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_manager_audit').get().n,1,
  'Existing audit evidence must survive a repeated inspection')

// Partial history: order column exists but table does not.
const partial=freshMigrations().sqlite
partial.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const partialPlan=planOrderManagerSchemaReconciliation(await inspectOrderManagerSchema(makeAdapter(partial)))
assert.deepEqual(partialPlan.steps.map(x=>x.id),['order-manager-audit'])

// Partial history: audit table exists but order column does not.
const other=freshMigrations().sqlite
other.exec(plan.steps.find(x=>x.id==='order-manager-audit').sql)
const otherPlan=planOrderManagerSchemaReconciliation(await inspectOrderManagerSchema(makeAdapter(other)))
assert.deepEqual(otherPlan.steps.map(x=>x.id),['orders-manager-snapshot-name'])

// Never replace a wrongly-shaped existing table; investigation is required.
const incompatible=freshMigrations().sqlite
incompatible.exec('CREATE TABLE order_manager_audit(id INTEGER PRIMARY KEY,order_id INTEGER)')
assert.throws(
  ()=>planOrderManagerSchemaReconciliation({
    ordersColumns:incompatible.prepare('PRAGMA table_info(orders)').all(),
    auditTableExists:true,
    auditColumns:incompatible.prepare('PRAGMA table_info(order_manager_audit)').all(),
  }),
  /SCHEMA_REFUSED: existing order_manager_audit is incompatible/,
)

// A read-only planner must not embed external D1/Workers credentials or calls.
const source=fs.readFileSync('scripts/order-manager-schema-reconciliation-20261030.mjs','utf8')
assert(!/\.run\(|\.batch\(|fetch\(|CLOUDFLARE_API_TOKEN|wrangler|process\.env/.test(source))
console.log('P0_ORDER_MANAGER_SCHEMA_PLAN_PASSED: '+files.length+
  ' real migrations; clean, partial, already-installed, incompatible and preserved-audit SQLite scenarios')
