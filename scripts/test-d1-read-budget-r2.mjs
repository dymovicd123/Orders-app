import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const reservations = read('worker/domains/order-reservations.ts')
  const attention = read('worker/domains/warehouse-attention.ts')
  const app = read('src/App.tsx')

  check(reservations.includes("options: { allActive?: boolean; listFlagsOnly?: boolean } = {}"), 'Canonical handover compact mode missing')
  check(!reservations.includes("throw new Error('Compact handover flags require an explicit order scope.')"), 'Compact handover still blocks all-active Attention summary')
  check(reservations.includes("JOIN orders o ON o.id = r.order_id"), 'Compact all-active handover does not scope through live orders')
  check(reservations.includes("o.order_status NOT IN ('deleted', 'archived')"), 'Compact all-active handover lost active-order guard')
  check(reservations.includes("COALESCE(o.shipping_status, 'not_sent') <> 'sent'"), 'Compact all-active handover lost shipping guard')
  for (const marker of ['ar.quantity AS reservation_quantity', 'stock.quantity AS physical_quantity', 'stock.reserved_quantity AS total_reserved_quantity']) {
    check(reservations.includes(marker), `Compact Attention payload missing ${marker}`)
  }
  check(reservations.includes("Object.prototype.hasOwnProperty.call(row, 'review_needed')"), 'Canonical handover item mapper does not accept compact precomputed review flag')

  check(attention.includes("fetchOrderStockHandoverRows(db, [], { allActive: true, listFlagsOnly: !details })"), 'Warehouse Attention summary does not use compact all-active handover mode')
  check(attention.includes('if (!details) return response'), 'Warehouse Attention summary/details split missing')
  check(attention.includes('stockHandoverItemFromRow(row)'), 'Explicit Attention details lost canonical full handover mapping')

  check(app.includes("if (warehouseAttention === null) void loadWarehouseAttention()"), 'Warehouse Attention badge should load once until invalidated')
  check(!app.includes("activeSector === 'inventory' || warehouseAttention === null"), 'Opening Inventory still forces a redundant Attention summary read')
  check(app.includes("if (nextPanel === 'attention') void loadWarehouseAttention(true)"), 'Opening Attention must still request fresh detail payload')
  check(app.includes('void loadWarehouseAttention()'), 'Inventory/order mutations must still refresh Attention after invalidation')

  console.log('D1 READ-BUDGET R2 TESTS PASSED — background Attention uses compact canonical handover flags, full detail remains explicit, redundant inventory-entry summary read removed')
} catch (error) {
  console.error(`D1 READ-BUDGET R2 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
