import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orders-standard-display-'))
const bundle=path.join(dir,'utils.mjs')
await build({entryPoints:['src/app/utils.ts'],bundle:true,platform:'node',
 format:'esm',target:'node20',outfile:bundle,logLevel:'error'})
const {
 formatOrderItemDetails,
 workshopDetailRows,
 workshopInvoiceProductTitle,
 workshopInvoiceCharacteristics,
}=await import(pathToFileURL(bundle).href)

const standard={
 productName:'АЙБЫН БОМБЕР',audienceType:'ВЗРОСЛЫЙ',gender:'МУЖ',
 color:'ТЕМНО-СИНИЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'46',
 orderId:1,orderItemId:5,quantity:1,comment:'',
}
const standardDescription=formatOrderItemDetails(standard)
assert.equal(standardDescription,'МУЖ · ТЕМНО-СИНИЙ · 46')
const standardChips=workshopDetailRows(standard)
assert.equal(standardChips.some(x=>['Материал','Длина'].includes(x.label)),false)
assert.equal(standardChips.find(x=>x.label==='Размер')?.value,'46')
assert.equal(standardChips.find(x=>x.label==='Цвет')?.value,'ТЕМНО-СИНИЙ')
const standardInvoiceProduct=workshopInvoiceProductTitle(standard)
assert(!standardInvoiceProduct.includes('СТАНДАРТ'),'Invoice product title prints STANDARD')
assert(!standardInvoiceProduct.includes('Обычная длина'),'Invoice product title prints default length')
assert(standardInvoiceProduct.includes('АЙБЫН БОМБЕР'))
assert(standardInvoiceProduct.includes('МУЖ'))
assert.equal(workshopInvoiceCharacteristics(standard),'Цвет: ТЕМНО-СИНИЙ · Размер: 46')

const custom={...standard,material:'ЗАМША ВЕЛЮР',length:'УКОРОЧЕННЫЙ',size:'0'}
assert(formatOrderItemDetails(custom).includes('ЗАМША ВЕЛЮР'))
assert(formatOrderItemDetails(custom).includes('УКОРОЧЕННЫЙ'))
assert(formatOrderItemDetails(custom).includes('0'))
assert(workshopDetailRows(custom).some(x=>x.label==='Материал'&&x.value==='ЗАМША ВЕЛЮР'))
assert(workshopDetailRows(custom).some(x=>x.label==='Длина'&&x.value==='УКОРОЧЕННЫЙ'))
assert(workshopInvoiceProductTitle(custom).includes('ЗАМША ВЕЛЮР'))
assert(workshopInvoiceProductTitle(custom).includes('УКОРОЧЕННЫЙ'))
assert.equal(formatOrderItemDetails({...standard,size:'БЕЗ РАЗМЕРА'}),'МУЖ · ТЕМНО-СИНИЙ · Без размера')
assert.notEqual(formatOrderItemDetails({...standard,size:'0'}),formatOrderItemDetails({...standard,size:'БЕЗ РАЗМЕРА'}))

const table=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const workshop=fs.readFileSync('src/features/sections/WorkshopSection.tsx','utf8')
const app=fs.readFileSync('src/App.tsx','utf8')
const invoices=fs.readFileSync('src/features/workshop/workshopInvoiceActions.ts','utf8')
const view=fs.readFileSync('src/app/controllers/useOperationalViewModel.ts','utf8')
const utils=fs.readFileSync('src/app/utils.ts','utf8')
assert(table.includes('line.details')&&utils.includes('formatOrderItemDetails(item)'), 'Orders table not connected to standard formatter')
assert(workshop.includes('workshopDetailRows(task)'),'Workshop chips not connected to filtered details')
assert(workshop.includes('workshopInvoiceRows.map('),'Invoice screen does not use grouped, formatted rows')
assert(app.includes('createWorkshopInvoiceActions({') && app.includes('invoiceRows: workshopInvoiceRows'), 'App no longer wires actual grouped Workshop rows into invoice export owner')
for(const exportMethod of ['buildWorkshopInvoiceText','buildWorkshopInvoiceHtmlTable','exportWorkshopInvoiceWord','downloadWorkshopInvoicePdf','printWorkshopInvoice']){
 assert(invoices.includes(exportMethod),'Missing export channel '+exportMethod)
}
assert(view.includes('workshopInvoiceProductTitle(task)')&&view.includes('workshopInvoiceCharacteristics(task)'))
assert(view.includes('exactCharacteristicsKey'),'Invoices would risk grouping distinct hidden execution variants together')
for(const file of [
 'src/features/orders/MainPickedOrderLine.tsx',
 'src/features/orders/ItemizedOrderEditorWorkspace.tsx',
 'src/features/sections/CreateOrderSection.tsx',
 'src/features/sections/OrderExchangeSmartSection.tsx',
 'src/features/orders/ExchangeReplacementSelector.tsx',
]){
 const source=fs.readFileSync(file,'utf8')
 assert(!source.includes("'СТАНДАРТ'?'Обычная длина'"),'Default length still visible in basket: '+file)
}
console.log('BRANCH2_STANDARD_DISPLAY_PASS: order list; workshop rows; invoice screen, copy, Word, PDF, print; exact invoice grouping; 0/without-size preserved')
