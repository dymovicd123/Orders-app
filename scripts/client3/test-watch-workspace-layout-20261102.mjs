import assert from 'node:assert/strict'
import fs from 'node:fs'

const shell=fs.readFileSync('src/WatchClient3App.tsx','utf8')
const chrome=fs.readFileSync('src/features/client3/Client3MainChrome.tsx','utf8')
const mainStyle=fs.readFileSync('src/styles/client3-main-chrome.css','utf8')
const catalog=fs.readFileSync('src/features/client3/WatchCatalogEditor.tsx','utf8')
const browse=fs.readFileSync('src/features/client3/WatchStockMainBrowse.tsx','utf8')
const orderCss=fs.readFileSync('src/styles/client3-watch-order.css','utf8')
const stock=fs.readFileSync('src/features/client3/WatchWarehouseMain.tsx','utf8')
const orders=fs.readFileSync('src/features/client3/WatchOrdersPanel.tsx','utf8')
const logistics=fs.readFileSync('src/features/client3/WatchLogisticsPanel.tsx','utf8')
const finance=fs.readFileSync('src/features/client3/WatchFinancePanel.tsx','utf8')

assert(shell.includes('Client3MainChrome'),'Navigation uses the Main-derived ERP chrome')
assert(chrome.includes('<aside className={')&&chrome.includes('erp-sidebar'),
 'Use the same fixed sidebar structure as Main')
assert(chrome.includes('erp-primary-nav')&&chrome.includes('erp-primary-nav-button'),
 'Sidebar must expose distinct functional routes')
assert(chrome.includes('erp-main')&&chrome.includes('erp-topbar'),
 'Workspace is separate from navigation')
assert(chrome.includes('erp-page-title')&&chrome.includes('erp-page-subtitle'),
 'Each section has its own heading')
for(const label of ['Инфопанель','Заказы','Клиенты','Логистика','Склад','Финансы',
 'Отчёты','План','Лиды','Команда','Справочники']){
 assert(chrome.includes("label:'"+label+"'"),'Missing operational section '+label)
}
assert(chrome.includes("href={'#'+route}")&&chrome.includes('onNavigate(route)'),
 'Sidebar routes must be selectable')
assert(chrome.includes('mobile-nav-toggle')&&chrome.includes('mobile-nav-backdrop'),
 'Mobile navigation needs a menu and dismissal surface')
assert(chrome.includes("item.route!=='staff'||isAdmin"),
 'Non-admin users cannot reach Team management via sidebar')
assert(shell.includes("['legacy','accounts','staff'].includes(tab)"),
 'Non-admin must not reach account administration by direct hash')
assert(shell.includes('WatchWarehouseMain')&&shell.includes('WatchCatalogEditor'),
 'Stock and catalog remain separate implementations')
assert(catalog.includes("view?:'catalog'|'warehouse'"))
for(const operation of ['arrival','transfer','writeoff','count'])
 assert(stock.includes("mode==='"+operation+"'"),
   'Main-style stock operation is missing: '+operation)
assert(browse.includes('inventory-calm-summary')&&browse.includes('stock-v13-browse'),
 'Stock table and totals must be available in dedicated Main stock browser')
assert(mainStyle.includes('erp-primary-nav')||mainStyle.includes('erp-sidebar'),
 'Navigation styles must use the ERP chrome')
assert(stock.includes('StocktakeSizeCountCell'),
 'Revisions retain the Main stock count input component')
assert(orders.includes('LinkedTableScroll')&&orders.includes('watch-main-orders-table'),
 'Orders must be a proper Main-style scrollable table')
assert(logistics.includes('LinkedTableScroll')&&logistics.includes('watch-main-logistics-table'),
 'Logistics must show a Main-style table')
assert(finance.includes('LinkedTableScroll')&&finance.includes('finance-days-truth-table')&&
 finance.includes('finance-operation-ledger'),
 'Finance must include Main-style day reconciliation and operation journal tables')
assert(orderCss.includes('order-step-card'),'Order workflow uses Main numbered steps')
assert(shell.includes('WatchUserAccessPanel')&&shell.includes('WatchBrandAccessPanel'),
 'Admin tools for accounts and brand access must be retained')
assert(shell.includes('WatchReturnsPanel')&&shell.includes('WatchLogisticsPanel'),
 'Return and dispatch panels are reachable')
assert(!chrome.includes('<h1>TAUWACH / WACHIZEN</h1>'),'No hard-coded brand at login')
console.log('CLIENT3_WORKSPACE_LAYOUT_PASS: Main ERP navigation, role gates, catalog/warehouse, and report tables')
