import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const migration = fs.readFileSync('migrations/0071_v72_inventory_operation_evidence.sql', 'utf8')
const source = fs.readFileSync('worker/domains/stock-resolution.ts', 'utf8')

const sqlite = new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY); INSERT INTO catalog_variants(id) VALUES (7);')
sqlite.exec(migration)

const columns = sqlite.prepare("PRAGMA table_info('inventory_operation_evidence')").all().map(row => row.name)
for (const required of [
  'evidence_key', 'inventory_source', 'variant_id', 'operation_type', 'operation_reference',
  'tracked_physical_before', 'confirmed_operation_quantity', 'explained_quantity',
  'unexplained_quantity', 'confirmed_by', 'occurred_at', 'created_at',
]) assert.ok(columns.includes(required), `Phase2A migration missing column: ${required}`)

const indexes = sqlite.prepare("PRAGMA index_list('inventory_operation_evidence')").all().map(row => row.name)
assert.ok(indexes.includes('idx_inventory_operation_evidence_source_variant_time'), 'Phase2A source/variant/time index missing')
assert.ok(indexes.includes('idx_inventory_operation_evidence_operation'), 'Phase2A operation lookup index missing')
assert.ok(!/UPDATE\s+inventory_stock\b/i.test(migration), 'Phase2A migration must not rewrite Physical')
assert.ok(!/inventory_stock_checks/i.test(migration), 'Phase2A operation evidence must stay separate from exact physical-count history')

const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
const sandbox = {
  module,
  exports: module.exports,
  require: (id) => {
    if (id.endsWith('../core/text.ts')) return {
      cleanText: value => value === null || value === undefined ? '' : String(value).trim(),
      toInt: (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback,
    }
    throw new Error(`Unexpected import in Phase2A test: ${id}`)
  },
  crypto,
  Date,
}
vm.runInNewContext(output, sandbox)
const { boundedOutboundStock, buildStockResolutionRequired } = module.exports

const shortage = boundedOutboundStock(2, 5)
assert.equal(shortage.trackedPhysicalBefore, 2)
assert.equal(shortage.operationQuantity, 5)
assert.equal(shortage.trackedPhysicalAfter, 0)
assert.equal(shortage.explainedQuantity, 2)
assert.equal(shortage.unexplainedQuantity, 3)
assert.equal(shortage.requiresResolution, true)

const covered = boundedOutboundStock(5, 2)
assert.equal(covered.trackedPhysicalAfter, 3)
assert.equal(covered.explainedQuantity, 2)
assert.equal(covered.unexplainedQuantity, 0)
assert.equal(covered.requiresResolution, false)

const required = buildStockResolutionRequired('shipping', [{
  source: 'warehouse',
  variantId: 7,
  productName: 'ШАПАН',
  trackedPhysicalQuantity: 1,
  operationQuantity: 3,
}])
assert.equal(required.ok, false)
assert.equal(required.code, 'stock_resolution_required')
assert.equal(required.operationType, 'shipping')
assert.equal(required.items.length, 1)
assert.equal(required.items[0].trackedPhysicalQuantity, 1)
assert.equal(required.items[0].operationQuantity, 3)
assert.equal(required.items[0].unexplainedQuantity, 2)

assert.throws(() => buildStockResolutionRequired('shipping', [{
  source: 'warehouse',
  variantId: 7,
  productName: 'ШАПАН',
  trackedPhysicalQuantity: 3,
  operationQuantity: 2,
}]), /без фактического дефицита/)

assert.ok(source.includes('INSERT OR IGNORE INTO inventory_operation_evidence'), 'Phase2A idempotent evidence insert missing')
assert.ok(source.includes('WHERE evidence_key = ?'), 'Phase2A evidence replay readback missing')
assert.ok(source.includes('Этот ключ доказательства уже использован для другого складского факта'), 'Phase2A conflicting evidence-key protection missing')
assert.ok(!source.includes('inventory_stock_checks'), 'Operational evidence must never be written as an exact stock check')
assert.ok(!/UPDATE\s+inventory_stock\b/i.test(source), 'Phase2A evidence primitive must not mutate Physical')
assert.ok(source.includes("operation_type IN ('shipping', 'handover', 'transfer', 'writeoff')") === false, 'Domain must not embed schema mutation logic')

console.log('STAGE02 PHASE2A STOCK TRUTH PRIMITIVES PASSED — absolute counts stay separate, outbound stock is bounded at zero, resolver contract is shortage-only, and unexplained operation evidence is idempotent/auditable.')
