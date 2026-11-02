import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const main=readFileSync('src/App.tsx','utf8')
const chrome=readFileSync('src/features/client3/Client3MainChrome.tsx','utf8')
const watch=readFileSync('src/WatchClient3App.tsx','utf8')
const stock=readFileSync('src/features/client3/WatchStockMainBrowse.tsx','utf8')
const operations=readFileSync('src/features/client3/WatchWarehouseMain.tsx','utf8')
const sourceMainCss=[...main.matchAll(/^import '\.\/styles\/([^']+\.css)'$/gm)].map(m=>m[1])
assert(sourceMainCss.length>=24,'Main CSS import source changed')
for(const css of sourceMainCss){
  assert(chrome.includes("import '../../styles/"+css+"'"),'Must import unmodified Main stylesheet '+css)
}
for(const className of ['erp-shell','erp-sidebar','erp-sidebar-scroll','erp-brand','erp-brand-mark',
  'erp-sidebar-card access-role-card','erp-primary-nav','erp-primary-nav-button',
  'erp-sidebar-footer','mobile-nav-toggle','mobile-nav-backdrop','erp-main',
  'erp-topbar','erp-page-context','erp-page-kicker','erp-page-title','erp-page-subtitle',
  'erp-topbar-actions','erp-topbar-status']){
  assert(main.includes(className),'Main shell missing '+className)
  assert(chrome.includes(className),'Third Client3 must reuse actual Main shell '+className)
}
assert(chrome.includes("import {workspaceModules} from '../../app/constants'"),
  'Use exact Main navigation module icons and text')
assert(watch.includes("import {OrdersHeaderSection} from './features/sections/OrdersHeaderSection'"),
  'Use Main order tabs view not own menu')
assert(watch.includes("import {orderPanelOptions} from './app/constants'"),
  'Use Main order tabs definitions')
assert(stock.includes('stock-v13-master-list')&&stock.includes('stock-v13-detail-pane'),
  'Stock overview must copy Main master/detail selectors')
assert(operations.includes("import {StocktakeProductChoice,StocktakeSizeCountCell} from '../inventory/views/StocktakeSharedInputs'"),
  'Stock operations must reuse Main stocktake input controls')
assert(watch.includes('WatchStockMainBrowse')&&watch.includes('WatchWarehouseMain'),
  'Main stock overview and operation screens must not be mixed')
assert(!watch.includes('<aside className=')&&!watch.includes('watch-shell-sidebar-top'),
  'No invented Client3 sidebar may remain')
assert(!watch.includes("'/api/orders'")&&!watch.includes("'/api/finance'"),
  'Main clothing financial endpoints cannot be called from Client3')
assert(watch.includes("'/api/client3/watches/orders'"),
  'New watch order must retain brand-safe Client3 API')
console.log('CLIENT3_MAIN_FOUNDATION_PASS: Main chrome, CSS cascade, module navigation, order tabs, stock browser and stocktake controls reused')
