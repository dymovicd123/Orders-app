import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const operational=readFileSync('src/app/controllers/useOperationalViewModel.ts','utf8')
const app=readFileSync('src/App.tsx','utf8')
const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const types=readFileSync('src/app/types.ts','utf8')
const handler=readFileSync('worker/index.ts','utf8')
const stats=readFileSync('src/features/inventory/views/InventoryDemandStatistics.tsx','utf8')
const finance=readFileSync('src/features/inventory/views/WarehouseReportsWorkspace.tsx','utf8')

function allowed(name){
  const match=operational.match(new RegExp('const '+name+': InventoryPanel\\[\\] = \\[([^\\]]+)\\]'))
  assert.ok(match,'Missing warehouse navigation allowlist: '+name)
  return [...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1])
}
const admin=allowed('inventoryAdminPanels'),manager=allowed('inventoryManagerPanels')
assert.ok(admin.includes('reports'),'Administrator must be able to open valuation')
assert.ok(!manager.includes('reports'),'No finance-only tab for ordinary managers')
for(const group of [admin,manager]){
  assert.ok(group.includes('statistics')&&group.includes('overview'),'Statistics and Stock unaffected')
}
assert.ok(!manager.includes('catalog')&&!manager.includes('settings'),'Manager scope unchanged')
assert.ok(types.includes("| 'reports'"))
assert.ok(section.includes("label: 'Стоимость запасов'"))
assert.ok(section.includes("...(isFinanceAdmin ? [{ value: 'reports'"))
assert.ok(section.includes("<InventoryDemandStatistics active={inventoryModuleVisible && inventoryPanel === 'statistics'} />"),
  'Unchanged original Statistics view must remain in place')
assert.ok(section.includes("<WarehouseReportsWorkspace active={inventoryModuleVisible && inventoryPanel === 'reports'} isAdmin={isFinanceAdmin} />"))
assert.ok(app.includes("(nextPanel === 'reports' && !isAdmin)"),'Finance panel must reject non-admin navigation')
assert.ok(app.includes("(inventoryPanel === 'reports' && !isAdmin)"),'Switching role must close finance screen')
assert.ok(app.includes('isFinanceAdmin: isAdmin, isAdmin: canManageWarehouse'),
  'Finance access must use actual admin role')
assert.ok(operational.includes('inventoryAdminPanels.includes(panel) : inventoryManagerPanels.includes(panel)'))
const route=handler.indexOf("url.pathname === '/api/reports/warehouse-capital'")
assert.ok(route>=0)
assert.ok(handler.slice(route,route+400).includes('requireAdminUser(authUser'),
  'Server must protect confidential cost')
assert.ok(stats.includes("fetch('/api/reports/warehouse-demand?'"), 'Demand API and component unchanged')
assert.ok(stats.includes('buildDemandStatisticsXlsx('), 'Demand Excel belongs within existing Statistics')
assert.ok(finance.includes("fetch('/api/reports/warehouse-capital'"), 'Finance data remain read-only')
assert.ok(!finance.includes("fetch('/api/reports/warehouse-demand?'"), 'No second, partial Statistics clone')
assert.ok(finance.includes('warehouse-capital-execution'),'Financial details must go beyond model totals')
assert.ok(finance.includes('<StockDetails rows={execution.items}/>'),'Variant-level valuation required')
console.log('WAREHOUSE_SEPARATE_REPORTS_NAV_PASS: Statistics owns Excel and admin Capital owns its detail and XLSX')
