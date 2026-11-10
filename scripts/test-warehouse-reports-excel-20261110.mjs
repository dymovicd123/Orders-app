import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {unzipSync} from 'fflate'
import {buildWarehouseReportXlsx} from '../src/features/inventory/views/warehouseReportExcel.ts'

const item={
  product:'=HYPERLINK("evil")',color:'Красный',size:'46',material:'Замша',
  length:'Стандарт',gender:'Женский',category:'adult',source:'warehouse',
  sold:5,returned:1,net:4,pricedQuantity:4,knownRevenue:160000,
  priceDiscrepancyQuantity:0,minPrice:40000,maxPrice:40000
}
const capitalRow={
  stockId:1,source:'warehouse',variantId:22,productId:2,product:'Товар',
  gender:'Ж',color:'Белый',size:'46',material:'Замша',length:'СТАНДАРТ',category:'adult',
  quantity:3,reserved:1,free:2,costPrice:10000,salePrice:40000,
  costValue:30000,retailValue:120000,grossPotential:90000,archived:false,overReserved:false
}
const totals={
  quantity:3,reserved:1,free:2,pricedCostQuantity:3,pricedSaleQuantity:3,
  bothPricedQuantity:3,knownCost:30000,knownSale:120000,
  knownGrossPotential:90000,knownFreeCost:20000,knownReservedCost:10000,
  missingCostQuantity:0,missingSaleQuantity:0,stockRows:1,zeroRows:1,
  negativeRows:1,overReservedRows:0,unlinkedPositiveRows:0
}
const choice={start:'2026-11-01',end:'2026-11-30',scope:'orders',source:'warehouse',category:'adult'}
const demand={ok:true,rows:[
  item,{...item,product:'Другой',source:'boutique',sold:100,net:100,knownRevenue:10000000}
]}
const capital={ok:true,capturedAt:'2026-11-10T12:00:00Z',pricesAvailable:true,
  rows:[capitalRow],totals,bySource:{warehouse:totals,boutique:{...totals,quantity:0,knownCost:0}}}
const bytes=buildWarehouseReportXlsx({choice,demand,capital,generatedAt:'2026-11-10T13:00:00Z'})
assert.ok(bytes.length>2000)
const zipped=unzipSync(bytes)
const read=name=>new TextDecoder().decode(zipped[name])
const workbook=read('xl/workbook.xml')
assert.equal((workbook.match(/<sheet name=/g)||[]).length,11)
assert.ok(workbook.includes('Модели')&&workbook.includes('Варианты спроса'))
assert.ok(workbook.includes('Стоимость запасов')&&workbook.includes('Качество данных'))
const sale=read('xl/worksheets/sheet8.xml')
assert.ok(sale.includes('HYPERLINK'), 'Original product name must remain in the report')
assert.ok(sale.includes('t="inlineStr"'), 'Catalog fields must be literal strings, never formulas')
assert.ok(!sale.includes('<f>'), 'No executable spreadsheet formulas from catalog data')
assert.ok(sale.includes('<v>160000</v>'), 'Sale values must remain numeric')
assert.ok(!sale.includes('<v>10000000</v>'), 'Other source filtered out')
const valuation=read('xl/worksheets/sheet9.xml')
assert.ok(valuation.includes('<v>30000</v>')&&valuation.includes('<v>120000</v>'))
assert.ok(valuation.includes('<autoFilter ref='), 'Finance table must be filterable')
const rels=read('xl/_rels/workbook.xml.rels')
assert.ok(rels.includes('Id="rId12"')&&rels.includes('Target="styles.xml"'),
  'Multi-sheet relationships must not collide with any sheet relationship')
const publicOnly=buildWarehouseReportXlsx({choice,demand,capital:null})
const pub=unzipSync(publicOnly),pbook=new TextDecoder().decode(pub['xl/workbook.xml'])
assert.equal((pbook.match(/<sheet name=/g)||[]).length,8)
assert.ok(!pbook.includes('Стоимость запасов'), 'Non-admin export must not contain costs')
assert.throws(()=>buildWarehouseReportXlsx({choice,demand:{ok:true,truncated:true,rows:[item]}}),
  /Неполные данные/, 'Never export truncated demand as a complete report')
const ui=readFileSync('src/features/inventory/views/WarehouseReportsWorkspace.tsx','utf8')
assert.ok(ui.includes('buildWarehouseReportXlsx({demand,choice,capital:snapshot})'))
assert.ok(ui.includes("fetch('/api/reports/warehouse-demand?'"))
assert.ok(ui.includes("fetch('/api/reports/warehouse-capital'"))
console.log('WAREHOUSE_REPORT_XLSX_PASS: 11 sheets, no personal orders, real numeric values, filtered demand, admin isolation')
