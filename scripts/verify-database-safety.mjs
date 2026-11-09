import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ORDER_MANAGER_AUDIT_COLUMNS, inspectOrderManagerSchema, planOrderManagerSchemaReconciliation } from './order-manager-schema-reconciliation-20261030.mjs'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

try {
  const packageJson = JSON.parse(read('package.json'))
  const wrangler = read('wrangler.jsonc')
  const workerTree = fs.readdirSync(path.join(root, 'worker', 'domains')).filter((name) => name.endsWith('.ts'))
    .map((name) => read(path.join('worker', 'domains', name))).join('\n') + '\n' + read('worker/index.ts')
  const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()

  check(wrangler.includes('"binding": "DB"'), 'wrangler.jsonc must keep the DB binding')
  check((wrangler.match(/"binding"\s*:\s*"DB"/g) || []).length === 1, 'exactly one DB binding is expected')
  check(migrations.includes('0059_v72_critical_operation_idempotency.sql'), '0059 must remain in migration history')
  check(migrations.includes('0060_v72_storage_database_hygiene.sql'), '0060 must remain in migration history')
  check(!Object.keys(packageJson.scripts || {}).some((name) => /^db:/.test(name)), 'normal package scripts must not expose db:* mutation helpers')
  for (const [name, command] of Object.entries(packageJson.scripts || {})) {
    if (name === 'dev') continue
    check(!/wrangler(?:\.cmd)?\s+d1\s+(?:execute|migrations|delete)|npx(?:\.cmd)?\s+wrangler\s+d1\s+(?:execute|migrations|delete)/i.test(String(command || '')), `package script ${name} must not mutate D1`)
  }
  check(!workerTree.includes("/api/import/"), 'legacy import API surface must stay retired')
  check(!workerTree.includes('rebuild-imported-test1'), 'legacy Test1 workshop rebuild route must stay retired')
  check(!workerTree.includes('repair-imported'), 'legacy imported-workshop repair route must stay retired')
  check(!workerTree.includes('MIGRATION_ENABLED'), 'retired migration/import runtime flag must not return')
  check(read('worker/index.ts').includes("deadLegacyCleanup: '1906c'"), '1906C health marker missing')
  // #648: prove that a NEW database can be reconciled to the two required
  // order-manager objects, without editing a historical migration or a live D1.
  // The only SQL executor below is an ephemeral :memory: SQLite instance.
  const fresh = new DatabaseSync(':memory:')
  try {
    const versioned = migrations.filter(name => /^[0-9]{4}.*[.]sql$/.test(name))
    check(versioned.length >= 114, 'fresh-install migration inventory unexpectedly shrank')
    for (const name of versioned) fresh.exec(read(path.join('migrations', name)))

    const localAdapter = {
      prepare(sql) {
        return { async all() { return { results: fresh.prepare(sql).all() } } }
      },
    }
    const before = await inspectOrderManagerSchema(localAdapter)
    const plan = planOrderManagerSchemaReconciliation(before)
    const allowed = new Set(['orders-manager-snapshot-name', 'order-manager-audit'])
    check(plan.steps.every(step => {
      const additive = step.sql === 'ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT'
        || step.sql.startsWith('CREATE TABLE order_manager_audit (')
      const forbidden = ['DROP ', 'DELETE ', 'UPDATE ', 'INSERT ', 'REPLACE ', 'ATTACH ', 'DETACH ']
        .some(keyword => step.sql.toUpperCase().includes(keyword))
      return additive && !forbidden
    }), 'fresh-install plan must remain two additive order-manager DDL operations')
    check(plan.requiresExplicitApproval === (plan.steps.length > 0), 'schema planner approval contract changed')

    // Test data exists BEFORE reconciliation: no step may replace or rewrite it.
    fresh.prepare(`INSERT INTO managers(id,name,is_active) VALUES(9980,'Fresh-install manager',1)`).run()
    fresh.prepare(`INSERT INTO orders(id,external_id,order_date,source_type,manager_id,created_at,updated_at)
      VALUES(9980,'FRESH-SCHEMA-TEST','2026-10-30','warehouse',9980,'2026-10-30','2026-10-30')`).run()
    const preserved = fresh.prepare('SELECT id,external_id,manager_id FROM orders WHERE id=9980').get()
    for (const step of plan.steps) fresh.exec(step.sql)
    const after = await inspectOrderManagerSchema(localAdapter)
    const replayPlan = planOrderManagerSchemaReconciliation(after)
    assert.deepEqual(replayPlan.steps, [], 'second reconciliation must be a no-op')
    assert.deepEqual(
      { ...fresh.prepare('SELECT id,external_id,manager_id FROM orders WHERE id=9980').get() },
      { ...preserved }, 'fresh-install reconciliation rewrote an existing order',
    )
    const auditCols = new Set(after.auditColumns.map(col => col.name))
    for (const name of ORDER_MANAGER_AUDIT_COLUMNS) check(auditCols.has(name), 'missing audit column: ' + name)
    check(after.ordersColumns.some(col => col.name === 'manager_snapshot_name'), 'manager snapshot missing after reconciliation')
    check(after.auditColumns.some(col => col.name === 'id' && Number(col.pk) === 1), 'audit primary key missing')
    check(fresh.prepare("PRAGMA foreign_key_list(order_manager_audit)").all()
      .some(row => row.table === 'orders' && row.from === 'order_id'), 'audit foreign key to order missing')

    fresh.prepare(`INSERT INTO order_manager_audit (
      order_id,external_id,new_manager_id,new_manager_name,action,source,created_at
    ) VALUES (9980,'FRESH-SCHEMA-TEST',9980,'Fresh-install manager','created','order_create','2026-10-30')`).run()
    check(fresh.prepare('SELECT COUNT(*) AS n FROM order_manager_audit').get().n === 1,
      'fresh-install audit row was not persisted')
    assert.deepEqual(
      planOrderManagerSchemaReconciliation(await inspectOrderManagerSchema(localAdapter)).steps, [],
      'already-reconciled schema must never try to create the audit table again',
    )
    check(fresh.prepare('SELECT COUNT(*) AS n FROM order_manager_audit').get().n === 1,
      'schema reinspection lost an existing audit row')
    console.log(`FRESH_LOCAL_SCHEMA_RECONCILIATION_PASS — ${versioned.length} versioned migrations; ${plan.steps.length} local-only additive steps; no-op replay; preserved order/audit`)
  } finally {
    fresh.close()
  }

  console.log(`DATABASE SAFETY CHECK PASSED — ${migrations.length} migration files preserved; runtime legacy import/repair surface retired; package scripts contain no D1 mutation command.`)
} catch (error) {
  console.error(`DATABASE SAFETY CHECK FAILED: ${error?.message || error}`)
  process.exit(1)
}
