import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const read = (relative) => {
  const file = path.join(root, relative)
  check(fs.existsSync(file), `Missing file: ${relative}`)
  return fs.readFileSync(file, 'utf8')
}

try {
  const operational = read('src/app/controllers/useOperationalViewModel.ts')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const attentionPanel = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
  const release = read('scripts/release-check.mjs')

  check(operational.includes("const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention', 'movement', 'stocktake', 'history']"), 'Manager visibility allow-list does not include routine Warehouse panels')
  check(operational.includes("const inventoryAdminPanels: InventoryPanel[] = ['overview', 'attention', 'stocktake', 'movement', 'catalog', 'history', 'settings', 'warehouse', 'boutique', 'exact']"), 'Admin visibility allow-list still hides Attention')
  check(operational.includes("&& inventoryPanel === panel ? undefined : 'none'"), 'Inventory panel visibility function changed unexpectedly')
  check(inventory.includes("value: 'attention' as const"), 'Attention tab missing from Warehouse navigation')
  check(inventory.includes('renderInventoryAttentionPanel({'), 'Attention renderer is not mounted')
  check(attentionPanel.includes("style={inventoryPanelStyle('attention')}"), 'Attention renderer no longer uses the common panel visibility guard')

  // This hotfix is frontend-only. It must not add schema/data work or modify frozen Arrival.
  const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()
  check(migrations.at(-1) === '0061_v72_warehouse_attention_truth_gates.sql', '192B2A1 must not add a migration')
  check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace disappeared')
  check(release.includes('test-step192b2a1-attention-visibility.mjs'), '192B2A1 visibility test is not chained into cumulative release gate')

  console.log('STEP 192B2A1 ATTENTION VISIBILITY TESTS PASSED — Attention is reachable and visible for manager/admin panel allow-lists; frontend-only hotfix, Arrival unchanged')
} catch (error) {
  console.error(`STEP 192B2A1 ATTENTION VISIBILITY TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
