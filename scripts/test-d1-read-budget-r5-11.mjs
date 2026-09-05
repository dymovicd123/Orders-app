import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const workspace = fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx', 'utf8')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

const dashboardStart = app.indexOf('async function loadDashboard(')
const dashboardEnd = app.indexOf('async function changeOrderPage(', dashboardStart)
expect(dashboardStart >= 0 && dashboardEnd > dashboardStart, 'loadDashboard boundary not found')
const dashboard = app.slice(dashboardStart, dashboardEnd)
expect(!dashboard.includes('loadCatalogData(forceReferences)'), 'R5.11: loadDashboard must not fetch the full catalog on ordinary list/overview refreshes')
expect(dashboard.includes('loadReferencesData(forceReferences)'), 'R5.11: canonical order/reference dictionaries must still refresh')

expect(
  app.includes("activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit' || orderPanel === 'exchange')"),
  'R5.11: create/edit/exchange must explicitly load product catalog data',
)
expect(
  app.includes("inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog'"),
  'R5.11: product-aware Warehouse panels must keep explicit catalog loading',
)
expect(
  workspace.includes('const catalogProducts = catalogData?.products?.map((product) => product.name) || []'),
  'R5.11: product suggestions still depend on catalogData and therefore require the explicit panel loads',
)
expect(
  workspace.includes('function applyExchangeProductPick(productName: string)') && workspace.includes('buildOrderItemFromCatalogPick(current.newItem, productName)'),
  'R5.11: exchange product selection must remain catalog-backed',
)

console.log('R5.11 lazy catalog read-budget regression passed')
