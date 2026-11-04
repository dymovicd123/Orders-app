import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(p,'utf8')
const mainCatalog=read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const mainExec=read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const mainStockCss=read('src/styles/w13-stock-catalog-browse.css')
const watchCatalog=read('src/features/client3/WatchCatalogEditor.tsx')
const watchStock=read('src/features/client3/WatchStockMainBrowse.tsx')
const watchCss=read('src/styles/client3-watch-catalog-polish.css')
const watchStockCss=read('src/styles/client3-watch-stock-browser.css')
const watchEdit=read('src/features/client3/WatchCatalogVariantEditAction.tsx')
const shell=read('src/WatchClient3App.tsx')

for(const key of ['catalog-detail-head','catalog-detail-actions','catalog-execution-list',
  'catalog-execution-card','catalog-execution-head','catalog-execution-prices',
  'catalog-color-list','catalog-color-head']){
 assert(mainExec.includes(key)||mainCatalog.includes(key),'Missing Main UI reference '+key)
 assert(watchCatalog.includes(key),'Client3 must actually render Main UI component '+key)
}
assert(watchCatalog.includes('data-client3-execution-hierarchy="main"')&&
 !watchCatalog.includes('client3-main-catalog-variants')&&
 !watchCatalog.includes('client3-watch-execution-control'),
 'Legacy floating execution delete buttons and tall repeated SKU cards must not return')
assert(watchCatalog.includes('executions.map(group=>')&&
 watchCatalog.includes('colorsFor(group.rows).map(color=>')&&
 watchCatalog.includes('color.rows.map(row=>'),
 'Client3 must group execution -> dial color -> exact watch SKU')
assert(watchCatalog.includes('catalog-execution-price-row')&&
 watchCatalog.includes("group.braceletMaterial==='leather'?(row.braceletColor||''):'standard'"),
 'Shared prices must be one per canonical execution: leather strap color is a separate price')
assert(watchCatalog.includes('catalog-execution-summary')&&
 watchCatalog.includes('kind="execution"')&&watchCatalog.includes('kind="product"')&&
 watchCatalog.includes('kind="variant"'),
 'Deletion actions must remain inside Main product, execution and exact-SKU context')
assert(watchCatalog.includes('label="Удалить исполнение"')&&
 watchCatalog.includes('label="Удалить позицию"')&&
 watchCatalog.includes('label="Удалить товар"'),
 'All three deletion controls must survive UX refactor')
assert(watchCatalog.includes('editingModel&&<section className="catalog-detail-editor catalog-product-editor-inline"')&&
 watchCatalog.includes('<WatchModelAliases key={brand+'),
 'Aliases belong inside explicit product edit mode, not above all executions')
assert(watchCatalog.indexOf('onOpenStock(selected.name)')>0&&
 shell.includes("onOpenStock={name=>{setCatalogStockFocus(name);goTo('warehouse')}}"),
 'Main find-in-stock action must navigate with current model name')
assert(watchEdit.includes("buttonLabel='Изменить характеристики'")&&
 watchCatalog.includes('buttonLabel="Редактировать"'),
 'Exact SKU contextual action should fit Main compact watch cards')
assert(watchCss.includes('client3-watch-execution-card')&&
 watchCss.includes('client3-watch-sku-row')&&
 watchCss.includes('catalog-detail-actions')&&
 watchCss.includes('catalog-execution-prices'),
 'Main-style watch card layout and button hierarchy must be styled')
assert(!watchCss.includes('.client3-watch-sku-actions button{'),
 'Compact row control CSS must not leak into nested delete confirmations')

for(const x of ['stock-v13-execution-list','stock-v13-execution-title','stock-v13-colors',
  'stock-v13-color','stock-v13-size-grid','stock-v13-zero-disclosure']){
 assert(mainStockCss.includes(x),'Main stock visual layer is missing '+x)
 assert(watchStock.includes(x),'Client3 stock view must actually render '+x)
}
assert(watchStock.includes('data-main-stock-groups="true"')&&
 watchStock.includes('grouped(available).map')&&
 watchStock.includes('grouped(empty).map')&&
 watchStock.includes('onCorrect({source,watchProductId:row.watchProductId'),
 'Stock must separate available and zero SKUs, preserving both arrival and count corrections')
assert(watchStockCss.includes('.client3-stock-tile-actions')&&
 watchStockCss.includes('.client3-stock-zero-content'),
 'Stock tile controls and zero-stock details must have scoped styles')
assert(!watchCatalog.includes('Размер:')&&!watchStock.includes('sizeLabel'),
 'Do not invent clothing-specific lengths or sizes in watches')
console.log('CLIENT3_MAIN_CATALOG_AND_STOCK_VISUAL_PARITY_PASS: product toolbar, execution/color groups, price scope, archived deletion actions, compact watch SKUs, stock view with zeros')
