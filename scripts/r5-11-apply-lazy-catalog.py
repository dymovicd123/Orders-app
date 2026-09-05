from pathlib import Path
import json

app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')

old_order_scope = "if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit')) {"
new_order_scope = "if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit' || orderPanel === 'exchange')) {"
if app.count(old_order_scope) != 1:
    raise SystemExit(f'expected one order catalog scope, found {app.count(old_order_scope)}')
app = app.replace(old_order_scope, new_order_scope, 1)

old_optional = "        Promise.all([loadReferencesData(forceReferences), loadCatalogData(forceReferences)]),"
new_optional = "        // R5.11: ordinary list/overview refreshes do not consume the 1,226-row variant catalog.\n        // Product-aware forms load the catalog explicitly when their panel becomes active.\n        loadReferencesData(forceReferences),"
if app.count(old_optional) != 1:
    raise SystemExit(f'expected one unconditional catalog refresh, found {app.count(old_optional)}')
app = app.replace(old_optional, new_optional, 1)
app_path.write_text(app, encoding='utf-8')

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
scripts = pkg['scripts']
needle = 'node scripts/test-d1-read-budget-r5-10.mjs'
if needle not in scripts['release:check']:
    raise SystemExit('R5.10 release gate tail not found')
if 'test-d1-read-budget-r5-11.mjs' not in scripts['release:check']:
    scripts['release:check'] += ' && node scripts/test-d1-read-budget-r5-11.mjs'
scripts['test:d1-read-budget-r5-11'] = 'node scripts/test-d1-read-budget-r5-11.mjs'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

test = r'''import fs from 'node:fs'

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
'''
Path('scripts/test-d1-read-budget-r5-11.mjs').write_text(test, encoding='utf-8')
