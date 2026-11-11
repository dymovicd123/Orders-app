import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {unzipSync} from 'fflate'
import {buildDemandStatisticsXlsx,buildWarehouseCapitalXlsx} from '../src/features/inventory/views/warehouseReportExcel.ts'

const item={product:'=HYPERLINK("evil")',color:'Красный',size:'46',material:'Замша',
  length:'Стандарт',gender:'Женский',category:'adult',source:'warehouse',
  sold:5,returned:1,net:4,pricedQuantity:4,knownRevenue:160000,
  priceDiscrepancyQuantity:0,minPrice:40000,maxPrice:40000}
const demand={ok:true,periodOrderCount:70,periodShippedOrderCount:50,rows:[
  item,{...item,product:'Другой',source:'boutique',sold:100,net:100,knownRevenue:10000000},
  {...item,product:'Ещё модель',sold:2,net:2,returned:0,color:'Белый'},
]}
const choice={start:'2026-11-01',end:'2026-11-30',scope:'orders',source:'warehouse',category:'adult'}
const workbook=unzipSync(buildDemandStatisticsXlsx({choice,demand,generatedAt:'2026-11-11T00:00:00Z'}))
const read=(zip,path)=>new TextDecoder().decode(zip[path])
const statsBook=read(workbook,'xl/workbook.xml')
assert.equal((statsBook.match(/<sheet name=/g)||[]).length,10)
assert.ok(statsBook.includes('Сводка спроса'))
assert.ok(statsBook.includes('Разбор моделей'))
assert.ok(statsBook.includes('Все варианты'))
assert.ok(!statsBook.includes('Сводка запасов'))
assert.ok(!statsBook.includes('Стоимость запасов'))
const statisticsSummary=read(workbook,'xl/worksheets/sheet1.xml')
assert.ok(statisticsSummary.includes('<v>6</v>'),'Totals must be scoped to current source')
assert.ok(statisticsSummary.includes('<v>160000</v>')===false,
  'Summary revenue includes all current filtered variants and is not a single row')
const statsVariant=read(workbook,'xl/worksheets/sheet10.xml')
assert.ok(statsVariant.includes('HYPERLINK'),'Original product name must be included')
assert.ok(statsVariant.includes('t="inlineStr"'),'Catalog values must be literal strings, not formulas')
assert.ok(!statsVariant.includes('<f>'),'Spreadsheet formula injection forbidden')
assert.ok(statsVariant.includes('<v>160000</v>'),'Stored order unit-price values must remain numeric')
assert.ok(!statsVariant.includes('<v>10000000</v>'),'Other source excluded')
const cross=read(workbook,'xl/worksheets/sheet9.xml')
assert.ok(cross.includes('Красный')&&cross.includes('Модель')===false)
assert.ok(cross.includes('Замша'))
assert.ok(cross.includes('<autoFilter ref='))

const stock={stockId:1,source:'warehouse',variantId:22,productId:2,product:'Товар',
  gender:'Ж',color:'Белый',size:'46',material:'Замша',length:'СТАНДАРТ',category:'adult',
  quantity:3,reserved:1,free:2,costPrice:10000,salePrice:40000,
  costValue:30000,retailValue:120000,grossPotential:90000,archived:false,overReserved:false}
const capTotals={
  quantity:3,reserved:1,free:2,pricedCostQuantity:3,pricedSaleQuantity:3,
  bothPricedQuantity:3,knownCost:30000,knownSale:120000,knownGrossPotential:90000,
  knownFreeCost:20000,knownReservedCost:10000,missingCostQuantity:0,missingSaleQuantity:0,
  stockRows:1,zeroRows:1,negativeRows:1,overReservedRows:0,unlinkedPositiveRows:0,
}
const capital={ok:true,capturedAt:'2026-11-11T12:00:00Z',pricesAvailable:true,
  rows:[stock,{...stock,stockId:2,source:'boutique',quantity:500,free:500,reserved:0,
    costValue:5000000,retailValue:20000000,grossPotential:15000000}],
  totals:capTotals,bySource:{warehouse:capTotals,boutique:{...capTotals,quantity:500}}}
const financial=unzipSync(buildWarehouseCapitalXlsx({
  capital,choice:{source:'warehouse',category:'adult'},generatedAt:'2026-11-11T13:00:00Z',
}))
const financeBook=read(financial,'xl/workbook.xml')
assert.equal((financeBook.match(/<sheet name=/g)||[]).length,6)
assert.ok(financeBook.includes('Сводка запасов')&&financeBook.includes('Исполнения'))
assert.ok(financeBook.includes('Все остатки')&&financeBook.includes('Качество'))
assert.ok(!financeBook.includes('Разбор моделей'),'Demand analysis must not contaminate capital report')
const financeRows=read(financial,'xl/worksheets/sheet5.xml')
assert.ok(financeRows.includes('<v>30000</v>')&&financeRows.includes('<v>120000</v>'))
assert.ok(!financeRows.includes('<v>5000000</v>'),'Source filter must exclude boutique assets')
assert.ok(financeRows.includes('<autoFilter ref='))
const rel=read(financial,'xl/_rels/workbook.xml.rels')
assert.ok(rel.includes('Id="rId7"')&&rel.includes('Target="styles.xml"'))
assert.throws(()=>buildDemandStatisticsXlsx({choice,demand:{ok:true,truncated:true,rows:[item]}}),
  /Неполные данные/,'Never export truncated statistics as complete')
const stats=readFileSync('src/features/inventory/views/InventoryDemandStatistics.tsx','utf8')
const finance=readFileSync('src/features/inventory/views/WarehouseReportsWorkspace.tsx','utf8')
assert.ok(stats.includes('buildDemandStatisticsXlsx('),'Statistics must own demand export')
assert.ok(stats.includes('demand-download'),'Statistics page must display its download')
assert.ok(finance.includes('buildWarehouseCapitalXlsx('),'Capital page must own finance export')
assert.ok(!finance.includes("fetch('/api/reports/warehouse-demand?'"),'Capital page must not duplicate demand')
console.log('WAREHOUSE_SPECIALIZED_XLSX_PASS: full demand breakdown, exact variants, finance-only export, filters, styled sheets and safe text')
