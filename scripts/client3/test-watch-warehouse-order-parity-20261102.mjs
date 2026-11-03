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
 assert(shell.includes(selector),'Client3 must reuse the Main warehouse navigation '+selector)
}
assert(!shell.includes('client3-main-erp-inventory-tabs'),'Old stacked tabs must not reappear')
assert(css.includes('flex-direction:row!important')&&css.includes('width:auto!important'),
 'Main compact warehouse tabs remain horizontal')
assert(shell.includes("activeSection==='catalog'")&&shell.includes('WatchCatalogEditor'),
 'Catalog must be reachable and separated from stock operations')
for(const selector of ['w6-catalog-toolbar','catalog-master-detail','catalog-master-pane',
 'catalog-master-list','catalog-master-row','catalog-detail-pane','catalog-detail-head',
 'catalog-detail-actions','catalog-detail-editor']){
 assert(mainCatalog.includes(selector),'Main catalog element missing '+selector)
 assert(catalog.includes(selector),'Watch catalog missing Main element '+selector)
}
assert(catalog.includes("if(view==='catalog')"),'Product browsing precedes editor')
assert(catalog.includes('showNewModel')&&catalog.includes('showNewVariant'),
 'Variant and model creation should use contextual controls')
assert(catalog.includes("'/api/client3/watches/catalog/models'")&&
 catalog.includes("'/api/client3/watches/catalog/variants'")&&
 catalog.includes("'/api/client3/watches/catalog/prices'"),
 'Never post watch variants to Main clothing catalog')
for(const cls of ['create-hero','orders-workspace-kpis create-kpis','order-step-card',
 'order-step-head','order-step-index','order-create-actions']){
 assert(mainOrder.includes(cls)&&create.includes(cls),'Watch create must preserve Main structure '+cls)
}
assert.equal((create.match(/<section className="order-step-card">/g)||[]).length,4,
 'Four stages: terms, line items, payments, confirmation')
assert(create.includes("useState<WatchBrand|''>('')"),
 'Brand must be chosen explicitly')
assert(create.includes("type DraftLine=")&&create.includes("source:WatchSource"),
 'Each order line retains its own stock location rather than a single order-wide source')
assert(create.includes("source:'office'"),'Office is a supported initial stock source')
assert(create.includes('manual:ManualFields')&&create.includes('SmartPickerInput'),
 'Main-style manual model/characteristics and matching must remain available')
assert(!create.includes("rows.filter(x=>x.catalogVariantId&&available(x,source)>0)"),
 'Do not restrict order creation to existing physical stock: workshop/logistics shortages must remain possible')
assert(create.includes('validateWatchOrderInput'),'Use shared server-domain input validation')
assert(create.includes('requestRef'),'Idempotent create retry must be retained')
assert(create.includes('paymentRows')&&create.includes('+ Добавить способ оплаты'),
 'Multiple payment rows are required')
assert(!create.includes('размер')&&!create.includes('Длина'),
 'No clothing-only characteristics in watch form')
console.log('CLIENT3_MAIN_WAREHOUSE_ORDER_PARITY_PASS: Main structure, exact brand/SKU, free input, per-line source and payments')
