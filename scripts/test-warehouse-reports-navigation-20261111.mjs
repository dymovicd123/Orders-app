import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const operational=readFileSync('src/app/controllers/useOperationalViewModel.ts','utf8')
const app=readFileSync('src/App.tsx','utf8')
const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const types=readFileSync('src/app/types.ts','utf8')
const handler=readFileSync('worker/index.ts','utf8')
const page=readFileSync('src/features/inventory/views/WarehouseReportsWorkspace.tsx','utf8')

function allowed(name){
  const match=operational.match(new RegExp('const '+name+': InventoryPanel\\[\\] = \\[([^\\]]+)\\]'))
  assert.ok(match,'Missing warehouse navigation allowlist: '+name)
  return [...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1])
}

const admin=allowed('inventoryAdminPanels')
const manager=allowed('inventoryManagerPanels')
for(const [name,panels] of [['administrator',admin],['manager',manager]]){
  assert.ok(panels.includes('reports'),name+' must be able to open Reports without redirect')
  assert.ok(panels.includes('statistics'),name+' must retain the existing Statistics panel')
  assert.ok(panels.includes('overview'),name+' must retain Stock overview')
}
assert.ok(!manager.includes('catalog')&&!manager.includes('settings'),'Do not elevate manager roles')
assert.ok(types.includes("export type InventoryPanel = 'reports'"), 'Reports must remain in typed navigation')
assert.ok(section.includes("label: 'Отчёты'"), 'Reports button must be visible in warehouse navigation')
assert.ok(section.includes("inventoryPanelStyle('reports')"), 'Reports must be rendered by allowed panel style')
assert.ok(operational.includes('inventoryAdminPanels.includes(panel) : inventoryManagerPanels.includes(panel)'),
  'Panel display must agree with both role allowlists')
assert.ok(app.includes('if (canManageWarehouse && !inventoryAdminPanels.includes(inventoryPanel)) setInventoryPanel'),
  'Inventory navigation reset must allow Reports for warehouse operators')
assert.ok(app.includes("if (!canManageWarehouse && (nextPanel === 'catalog' || nextPanel === 'settings'))"),
  'Ordinary users must not be prevented from selecting the Reports panel')
assert.ok(app.includes('isAdmin: canManageWarehouse, isFinanceAdmin: isAdmin'),
  'Financial access must use true administrator role, not broader warehouse supervisor role')
assert.ok(section.includes("<WarehouseReportsWorkspace active={inventoryModuleVisible && inventoryPanel === 'reports'} isAdmin={isFinanceAdmin} />"),
  'Financial valuation must be hidden for non-administrators')
const route=handler.indexOf("url.pathname === '/api/reports/warehouse-capital'")
assert.ok(route>=0)
assert.ok(handler.slice(route,route+400).includes('requireAdminUser(authUser'),
  'Server must independently protect warehouse cost API')
assert.ok(page.includes("fetch('/api/reports/warehouse-demand?'"),
  'Reports must keep using the existing demand API without changing Statistics')
console.log('WAREHOUSE_REPORTS_NAVIGATION_PASS: admin and manager panels stay open, unchanged statistics and protected costs')
