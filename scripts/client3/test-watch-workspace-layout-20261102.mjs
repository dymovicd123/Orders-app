import assert from 'node:assert/strict'
import fs from 'node:fs'

const shell=fs.readFileSync('src/WatchClient3App.tsx','utf8')
const layout=fs.readFileSync('src/styles/client3-watch-shell.css','utf8')
const catalog=fs.readFileSync('src/features/client3/WatchCatalogEditor.tsx','utf8')
const orderCss=fs.readFileSync('src/styles/client3-watch-order.css','utf8')
const stockSource=fs.readFileSync('src/features/client3/WatchWarehouseMain.tsx','utf8')
const ordersSource=fs.readFileSync('src/features/client3/WatchOrdersPanel.tsx','utf8')
const catalogCss=fs.readFileSync('src/styles/client3-watch-catalog-editor.css','utf8')

for(const group of ['Продажи','Рабочие процессы','Товары и склад','Финансы','Администрирование']){
  assert(shell.includes('>'+group+'</div>'),group+' must be a distinct sidebar group')
}
assert(shell.includes('<aside className={'), 'Navigation belongs in a fixed sidebar')
assert(shell.includes('watch-shell-sidebar'), 'Workspace sidebar must exist')
assert(shell.includes('watch-shell-nav-svg')&&shell.includes('sectionIcons'), 'Navigation items need distinct vector icons rather than repeated markers')
assert(shell.includes('watch-shell-workspace'), 'Content and sidebar must be separate')
assert(shell.includes('watch-shell-topbar'), 'Workspace header must be independent of navigation')
assert(shell.includes('watch-shell-page-head'), 'Each page needs its own title and context')
assert(shell.includes("navItem('create','Новый заказ',true)"), 'Create order must be a primary action')
assert(shell.includes("goTo('create')"), 'Create order must have its own route')
assert(shell.includes("window.addEventListener('hashchange',syncHash)"), 'Browser history needs navigation state')
assert(shell.includes('watch-shell-menu-toggle'), 'Mobile navigation toggle is required')
assert(shell.includes('watch-shell-backdrop'), 'Mobile navigation needs a safe dismissal')
assert(shell.includes("['legacy','accounts','staff'].includes(tab)"), 'Manager must not navigate to admin pages via hash')
assert(shell.includes('WatchWarehouseMain') && shell.includes('WatchCatalogEditor'), 'Warehouse must reuse Main stocktake picker while Catalog remains a separate component')
assert(catalog.includes("view?:'catalog'|'warehouse'"))
assert(catalog.includes("view==='catalog'&&<div className=\"watch-catalog-editor-forms\""),
  'Product creation forms should only be visible in Catalog')
for(const operation of ['arrival','transfer','writeoff','count']){
  assert(stockSource.includes("mode==='"+operation+"'") || (operation==='count'&&stockSource.includes("mode==='count'")),
    operation+' must exist in the Main stocktake adapter')
}
assert(catalog.includes('watch-warehouse-table'),'Warehouse must have inventory/stock table')
assert(catalog.includes('watch-warehouse-summary'),'Warehouse must have at-a-glance stock totals')
assert(layout.includes('grid-template-columns:248px minmax(0,1fr)'),'Desktop has a real sidebar column')
assert(layout.includes('@media(max-width:850px)'),'Mobile sidebar must become a drawer')
assert(layout.includes('transform:translateX(-104%)'),'Mobile drawer must be closed by default')
assert(layout.includes('.watch-shell-backdrop'),'Mobile drawer must have backdrop')
assert(stockSource.includes("import {StocktakeProductChoice,StocktakeSizeCountCell} from '../inventory/views/StocktakeSharedInputs'"),'Must reuse Main stocktake picker/count cells')
assert(ordersSource.includes("import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'"),'Must reuse Main linked table scrolling')
assert(ordersSource.includes('<table className="watch-main-orders-table">'),'Orders must display as a proper operator table')
const logisticsSource=fs.readFileSync('src/features/client3/WatchLogisticsPanel.tsx','utf8')
const financeSource=fs.readFileSync('src/features/client3/WatchFinancePanel.tsx','utf8')
assert(logisticsSource.includes("import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'"),'Logistics must use Main table component')
assert(financeSource.includes("import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'"),'Finances must use Main table component')
assert(logisticsSource.includes('<table className="watch-main-logistics-table">'),'Logistics must display a real queue table')
assert(financeSource.includes('<table className="watch-main-finance-table">'),'Finances must display a real money journal table')
const formSource=fs.readFileSync('src/features/client3/WatchOrderForm.tsx','utf8')
assert(formSource.includes('create-hero')&&formSource.includes('order-step-card'),'Watch create form must follow Main order step structure')
assert(formSource.includes('order-step-index">1')&&formSource.includes('order-step-index">2'),'Order steps must be numbered')
assert(stockSource.includes("'/api/client3/watches/stock/'"),'Main stocktake UI must preserve isolated Client3 warehouse endpoints')
assert(orderCss.includes('.watch-shell-create-page .watch-order-form'),'Order entry must be a dedicated workspace card')
assert(orderCss.includes('order-step-card'),'Order workflow must reuse Main CreateOrderSection step hierarchy')
assert(shell.includes('WatchUserAccessPanel')&&shell.includes('WatchBrandAccessPanel'),
  'Existing administrative navigation is still accessible')
assert(shell.includes('WatchReturnsPanel')&&shell.includes('WatchLogisticsPanel'),
  'Returns and logistics navigation remains accessible')
assert(!shell.includes('<h1>TAUWACH / WACHIZEN</h1>'), 'Plain login must remain')
console.log('CLIENT3_WORKSPACE_LAYOUT_PASS: grouped sidebar, primary create route, split catalog/warehouse, role guard, mobile drawer and plain login')
