import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const main=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const mainCatalog=readFileSync('src/features/inventory/views/renderInventoryCatalogPanel.tsx','utf8')
const mainOrder=readFileSync('src/features/sections/CreateOrderSection.tsx','utf8')
const shell=readFileSync('src/WatchClient3App.tsx','utf8')
const catalog=readFileSync('src/features/client3/WatchCatalogEditor.tsx','utf8')
const create=readFileSync('src/features/client3/WatchOrderForm.tsx','utf8')
const css=readFileSync('src/styles/client3-main-chrome.css','utf8')

for(const selector of ['warehouse-w2-navigation','warehouse-w2-primary']){
  assert(main.includes(selector),'Main missing original warehouse navigation '+selector)
  assert(shell.includes(selector),'Client3 must reuse original warehouse navigation '+selector)
}
assert(!shell.includes('client3-main-erp-inventory-tabs'),'Old full-width stacked warehouse tabs must be removed')
assert(css.includes('flex-direction:row!important'),'Warehouse tabs must stay horizontal')
assert(css.includes('width:auto!important'),'Generic full-width button rule cannot inflate warehouse tabs')
assert(shell.includes("activeSection==='catalog'")&&shell.includes('WatchCatalogEditor'),
  'Catalog tab must open Main-style watch catalog')
for(const selector of ['w6-catalog-toolbar','catalog-master-detail','catalog-master-pane',
  'catalog-master-list','catalog-master-row','catalog-detail-pane','catalog-detail-head',
  'catalog-detail-actions','catalog-detail-editor']){
  assert(mainCatalog.includes(selector),'Missing Main catalog layout '+selector)
  assert(catalog.includes(selector),'Watch catalog must port Main catalog layout '+selector)
}
assert(catalog.includes("if(view==='catalog')"),'Actual products browse should render before legacy editor')
assert(catalog.includes('showNewModel')&&catalog.includes('showNewVariant'),
  'New model / variant fields should be contextual, not always expanded')
assert(!catalog.includes("if(await createModel(e))")===false,
  'Failed product mutation must not silently close editor')
assert(catalog.includes("'/api/client3/watches/catalog/models'")&&
  catalog.includes("'/api/client3/watches/catalog/variants'")&&
  catalog.includes("'/api/client3/watches/catalog/prices'"),
  'Do not mutate Main clothing catalog')
for(const cls of ['create-hero','orders-workspace-kpis create-kpis','order-step-card',
  'order-step-head','order-step-index','order-create-actions']){
  assert(mainOrder.includes(cls)&&create.includes(cls),'Watch create must port Main element '+cls)
}
assert((create.match(/<section className="order-step-card">/g)||[]).length===4,
  'Main create has four functional steps: terms / items / payments / review')
assert(create.includes("useState<WatchBrand|''>('')"),'Brand must be explicitly chosen')
assert(create.includes("useState<WatchSource|''>('')"),'Source must be explicitly chosen')
assert(create.includes("setBrand(e.target.value as WatchBrand);setSource('');setVariantId(0)"),
  'Switching brand must clear the source and selected SKU')
assert(create.includes("setSource(e.target.value as WatchSource);setVariantId(0)"),
  'Switching source must clear selected SKU')
assert(create.includes("!brand||!source?<div className=\"main-watch-create-placeholder\""),
  'SKU options must be invisible before brand and source')
assert(create.includes("rows.filter(x=>x.catalogVariantId&&available(x,source)>0)"),
  'SKU dropdown must show only physically available mapped watches')
assert(create.includes("quantity<=free"),'Quantity must stay bounded by available stock')
assert(create.includes('validateWatchOrderInput'),'Existing server-domain input validation retained')
assert(create.includes('requestRef'),'Create retry must reuse idempotency key')
assert(create.includes('Получено от клиента')&&create.includes('Цена продажи')&&create.includes('ДОЛГ'),
  'Payment and debt must have Main-style standalone steps and review')
assert(!create.includes('размер')&&!create.includes('Длина'),'Watch order must not contain clothing characteristics')
console.log('CLIENT3_MAIN_WAREHOUSE_ORDER_PARITY_PASS: Main horizontal tabs, real master-detail catalog, and brand/source-gated four-step order')
