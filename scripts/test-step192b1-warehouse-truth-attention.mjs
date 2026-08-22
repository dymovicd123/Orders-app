import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function declarationBody(source, marker) {
  const start = source.indexOf(marker)
  check(start >= 0, `Declaration marker missing: ${marker}`)
  const next = source.indexOf('\n\nexport ', start + marker.length)
  return source.slice(start, next >= 0 ? next : source.length)
}


try {
  const migration = read('migrations/0061_v72_warehouse_attention_truth_gates.sql')
  const migrationNoComments = migration.replace(/^\s*--.*$/gm, ' ')
  const statements = migrationNoComments.split(';').map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean)
  check(statements.length === 3, `0061 must contain exactly 3 additive schema statements, got ${statements.length}`)
  check(/^ALTER TABLE order_items ADD COLUMN inventory_obligation_key TEXT$/i.test(statements[0]), '0061 obligation key ALTER changed')
  check(/^ALTER TABLE order_items ADD COLUMN inventory_obligation_origin_at TEXT$/i.test(statements[1]), '0061 obligation origin ALTER changed')
  check(/^CREATE INDEX IF NOT EXISTS idx_order_items_inventory_obligation_key ON order_items\(order_id, inventory_obligation_key\)$/i.test(statements[2]), '0061 lineage index changed')
  check(!/\b(?:UPDATE|DELETE|INSERT|REPLACE|DROP|VACUUM|ATTACH|DETACH)\b/i.test(migrationNoComments), '0061 contains forbidden data mutation')
  check(!/inventory_stock/i.test(migrationNoComments), '0061 must not touch inventory_stock')

  const write = read('worker/domains/orders-write.ts')
  const identity = declarationBody(write, 'export function inventoryObligationIdentityKey')
  check(identity.includes('product_name_snapshot') && identity.includes('color_snapshot') && identity.includes('size_snapshot'), 'Stable obligation identity lost SKU facts')
  check(identity.includes('quantity'), 'Stable obligation identity must distinguish quantity changes')
  check(identity.includes('source_type') && identity.includes('normalizeSourceType'), 'Stable obligation identity must distinguish source changes')
  check(!/unit_price|unitPrice|line_total|lineTotal/.test(identity), 'Price-only edits must not create a new warehouse obligation')
  const lineage = declarationBody(write, 'export async function inventoryObligationLineageForRewrite')
  check(lineage.includes('inventory_obligation_key') && lineage.includes('inventory_obligation_origin_at'), 'Rewrite lineage does not preserve warehouse obligation fields')
  check(write.includes('inventory_obligation_key, inventory_obligation_origin_at'), 'order_items insert does not persist stable obligation lineage')
  check(write.includes('inventoryObligationLineage?.[itemIndex]?.originAt || timestamp'), 'New/reused obligation origin semantics changed')
  const update = declarationBody(write, 'export async function updateOrderCritical')
  check(update.includes('inventoryObligationLineageForRewrite') && update.includes('inventoryObligationLineage'), 'Order edit does not carry stable obligation lineage through critical operation')

  const reservations = read('worker/domains/order-reservations.ts')
  const handoverRows = declarationBody(reservations, 'export async function fetchOrderStockHandoverRows')
  check(handoverRows.includes("COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at)"), 'Handover resolver lost stable obligation origin fallback')
  check(handoverRows.includes("COALESCE(NULLIF(reviewed_item.inventory_obligation_key, ''), 'legacy-order-item:' || reviewed_item.id)"), 'Handover review no longer follows stable obligation key')
  check(handoverRows.includes('options: { allActive?: boolean }') && handoverRows.includes("r.status = 'active'"), 'Attention handover count must reuse canonical resolver without a separate capped SQL implementation')
  const handoverState = declarationBody(reservations, 'export async function getOrderStockHandoverState')
  check(handoverState.includes('fetchOrderStockHandoverRows') && handoverState.includes('stockHandoverItemFromRow'), 'Detailed handover state must use canonical resolver')
  const handoverCount = declarationBody(reservations, 'export async function countOrderStockHandoverReviewCandidates')
  check(handoverCount.includes("fetchOrderStockHandoverRows(db, [], { allActive: true })"), 'Attention handover count must use canonical resolver')
  check(!handoverCount.includes('LIMIT 1200'), 'Attention handover count must not silently cap active orders')

  const relations = read('worker/domains/orders-relations.ts')
  check(relations.includes("import { fetchOrderStockHandoverRows, stockHandoverItemFromRow } from './order-reservations.ts'"), 'Orders table does not import canonical handover resolver')
  check(relations.includes('fetchOrderStockHandoverRows(db, chunk)'), 'Orders table does not use canonical handover resolver')
  check(!relations.includes('inventory_stock_checks c ON c.id ='), 'Duplicated handover checkpoint SQL returned to orders-relations')

  const lifecycle = read('worker/domains/lifecycle.ts')
  const disposition = declarationBody(lifecycle, 'export async function inventoryLifecycleDeferredInboundDisposition')
  for (const marker of ['no_trusted_baseline', 'active_stocktake', 'stale_before_full_stocktake', 'overlaps_full_stocktake', 'later_physical_check', 'fresh']) {
    check(disposition.includes(marker), `Deferred inbound truth disposition missing: ${marker}`)
  }
  const supersede = declarationBody(lifecycle, 'export async function supersedeInventoryLifecycleInboundWithoutStockChange')
  check(supersede.includes("UPDATE inventory_lifecycle_events"), 'Supersede must close only the lifecycle event')
  check(!/inventory_stock|inventory_movements|applyInventory/i.test(supersede), 'Supersede must never change stock or movement history')
  const auto = declarationBody(lifecycle, 'export async function canAutoApplyFreshWorkshopInbound')
  check(auto.includes('inventoryLifecycleDeferredInboundDisposition'), 'Automatic workshop intake bypasses common truth gate')
  const manual = declarationBody(lifecycle, 'export async function resolveInventoryLifecycleFacts')
  check((manual.match(/inventoryLifecycleDeferredInboundDisposition/g) || []).length >= 2, 'Manual lifecycle resolve must check truth gate before and after SKU resolution')
  check((manual.match(/supersedeInventoryLifecycleInboundWithoutStockChange/g) || []).length >= 2, 'Manual lifecycle resolve must safely supersede stale/rechecked inbound events')

  const attention = read('worker/domains/warehouse-attention.ts')
  for (const marker of ['shortage', 'lifecycle', 'catalog', 'handover', 'stocktake']) check(attention.includes(marker), `Warehouse attention source missing: ${marker}`)
  check(attention.includes('fetchOrderStockHandoverRows') && attention.includes('stockHandoverItemFromRow'), 'Warehouse attention does not use canonical handover resolver')
  check(!/\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(attention), 'Warehouse attention must remain read-only')
  check(!/warehouse_cases|case_owner|deadline|sla/i.test(attention + write + lifecycle), '192B1 must not introduce a persistent case/SLA workflow')

  const index = read('worker/index.ts')
  check(index.includes("warehouseAttentionTruthGates: '192b1'"), '192B1 health marker missing')
  check(index.includes("url.pathname === '/api/inventory/attention'"), 'Warehouse attention endpoint missing')
  check(index.includes('getWarehouseAttentionSummary(env.DB'), 'Warehouse attention endpoint does not use summary resolver')

  const contracts = read('shared/api-contracts.ts')
  check(contracts.includes('WarehouseAttentionSummaryResponse'), 'Warehouse attention API contract missing')
  const app = read('src/App.tsx')
  check(app.includes('/api/inventory/attention'), 'Frontend does not load warehouse attention')
  check(app.includes('void loadWarehouseAttention()') && app.includes('function invalidateInventoryStockCaches'), 'Warehouse attention must refresh after stock/reservation cache invalidation')
  check(app.includes("activeSector === 'inventory' || warehouseAttention === null"), 'Warehouse attention should not re-query on every unrelated order-panel change')
  check(app.includes("module.id === 'inventory'") && app.includes('warehouse-attention-nav-badge'), 'Warehouse sidebar attention badge missing')
  const css = read('src/styles/192b1-warehouse-attention.css')
  check(css.includes('.warehouse-attention-nav-badge'), 'Warehouse attention badge CSS missing')
  check(!/Step 192B1|D1|migration|variant_id|forensic|canonical/i.test(css), 'Developer terminology leaked into visible 192B1 CSS content')

  const release = read('scripts/release-check.mjs')
  check(release.includes('test-step192b1-warehouse-truth-attention.mjs'), '192B1 test is not chained into cumulative release gate')

  console.log('STEP 192B1 WAREHOUSE TRUTH GATES / ATTENTION TESTS PASSED — stable handover lineage, one canonical resolver, manual+auto inbound freshness gate, derived read-only attention badge')
} catch (error) {
  console.error(`STEP 192B1 WAREHOUSE TRUTH GATES / ATTENTION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
