import assert from 'node:assert/strict'
import {unzipSync} from 'fflate'
import {buildDemandStatisticsDocx,buildWarehouseCapitalDocx} from '../src/features/inventory/views/warehouseReportDocument.ts'
import {buildDemandStatisticsXlsx,buildWarehouseCapitalXlsx} from '../src/features/inventory/views/warehouseReportExcel.ts'
import {labelCategory,labelSource,labelCharacteristic} from '../src/features/inventory/views/warehouseReportLocale.ts'

assert.equal(labelSource('all'),'Все источники')
assert.equal(labelSource('warehouse'),'Склад')
assert.equal(labelSource('boutique'),'Бутик')
assert.equal(labelCategory('child'),'Детские')
assert.equal(labelCategory('unknown'),'Не указано')
assert.equal(labelCharacteristic('female'),'Женский')
assert.equal(labelCharacteristic('unisex'),'Унисекс')
assert.equal(labelCharacteristic('БАЯН СУЛУ'),'БАЯН СУЛУ')
const demand={ok:true,periodOrderCount:12,periodShippedOrderCount:9,rows:[
  {product:'БАЯН СУЛУ ЖИЛЕТ',color:'Бежевый',size:'46',material:'Замша',length:'standard',
    gender:'female',category:'adult',source:'warehouse',
    sold:8,returned:1,net:7,pricedQuantity:7,knownRevenue:210000,
    priceDiscrepancyQuantity:0,minPrice:30000,maxPrice:30000},
  {product:'БАЯН СУЛУ ЖИЛЕТ',color:'Зелёный',size:'48',material:'Джинса',length:'standard',
    gender:'female',category:'adult',source:'boutique',
    sold:2,returned:0,net:2,pricedQuantity:2,knownRevenue:70000,
    priceDiscrepancyQuantity:0,minPrice:35000,maxPrice:35000},
]}
const choice={start:'2026-11-01',end:'2026-11-30',scope:'orders',source:'all',category:'adult'}
const doc=await buildDemandStatisticsDocx({demand,choice,generatedAt:'2026-11-11T08:00:00Z'})
assert.ok(doc.size>1500)
const xml=new TextDecoder().decode(unzipSync(new Uint8Array(await doc.arrayBuffer()))['word/document.xml'])
for(const phrase of ['Какие товары пользуются спросом','Главное за выбранный период','Подробно по моделям',
  'БАЯН СУЛУ ЖИЛЕТ','Бежевый','Склад','Бутик','Взрослые']){
  assert.ok(xml.includes(phrase), 'Demand DOCX omitted '+phrase)
}
assert.ok(!xml.includes('>warehouse<')&&!xml.includes('>all<')&&!xml.includes('>boutique<'),
  'Internal English codes must never appear as document values')
assert.ok(!xml.includes('Стоимость товарных запасов'),'Demand report contains hidden capital data')
const demandFile=buildDemandStatisticsXlsx({demand,choice,generatedAt:'2026-11-11T08:00:00Z'})
const demandBook=unzipSync(demandFile)
const worksheets=Object.entries(demandBook).filter(([name])=>name.startsWith('xl/worksheets/'))
const joined=worksheets.map(([,bytes])=>new TextDecoder().decode(bytes)).join('\n')
assert.ok(joined.includes('Склад')&&joined.includes('Бутик'))
assert.ok(!joined.includes('<t xml:space="preserve">warehouse</t>'))
assert.ok(!joined.includes('<t xml:space="preserve">adult</t>'))
assert.ok(!joined.includes('<t xml:space="preserve">all</t>'))
const base={stockId:1,source:'warehouse',variantId:3,productId:4,product:'БАЯН СУЛУ ЖИЛЕТ',
  gender:'female',color:'Бежевый',size:'46',material:'Замша',length:'standard',category:'adult',
  quantity:8,reserved:1,free:7,costPrice:10000,salePrice:30000,
  costValue:80000,retailValue:240000,grossPotential:160000,archived:false,overReserved:false}
const totals={quantity:10,reserved:1,free:9,pricedCostQuantity:8,pricedSaleQuantity:8,
  bothPricedQuantity:8,knownCost:80000,knownSale:240000,knownGrossPotential:160000,
  knownFreeCost:70000,knownReservedCost:10000,missingCostQuantity:2,missingSaleQuantity:2,
  stockRows:2,zeroRows:1,negativeRows:1,overReservedRows:0,unlinkedPositiveRows:0}
const capital={ok:true,capturedAt:'2026-11-11T08:00:00Z',pricesAvailable:true,
  rows:[base,{...base,stockId:2,source:'boutique',color:'Синий',quantity:2,reserved:0,free:2,
    costPrice:null,salePrice:null,costValue:null,retailValue:null,grossPotential:null}],
  totals,bySource:{warehouse:{...totals,quantity:8},boutique:{...totals,quantity:2}}}
const cChoice={source:'all',category:'all'}
const report=await buildWarehouseCapitalDocx({capital,choice:cChoice,generatedAt:'2026-11-11T08:00:00Z'})
assert.ok(report.size>1500)
const zip=unzipSync(new Uint8Array(await report.arrayBuffer()))
const financialXml=new TextDecoder().decode(zip['word/document.xml'])
for(const phrase of ['Сколько средств находится в товарах','Насколько полная эта оценка',
  'Без себестоимости','Склад','Бутик','Какая часть товара свободна',
  'Ключевые модели','Точные остатки','БАЯН СУЛУ ЖИЛЕТ']){
  assert.ok(financialXml.includes(phrase),'Capital DOCX omitted '+phrase)
}
assert.ok(financialXml.includes('8 из 10 шт.'),'Coverage must not present partial cost as complete')
assert.ok(!financialXml.includes('>warehouse<')&&!financialXml.includes('>all<'))
const capitalFile=buildWarehouseCapitalXlsx({capital,choice:cChoice,generatedAt:'2026-11-11T08:00:00Z'})
const capSheets=Object.entries(unzipSync(capitalFile)).filter(([name])=>name.startsWith('xl/worksheets/'))
const capJoined=capSheets.map(([,bytes])=>new TextDecoder().decode(bytes)).join('\n')
assert.ok(capJoined.includes('Склад')&&capJoined.includes('Бутик'))
assert.ok(!capJoined.includes('<t xml:space="preserve">warehouse</t>'))
assert.ok(!capJoined.includes('<t xml:space="preserve">boutique</t>'))
assert.ok(!capJoined.includes('<t xml:space="preserve">all</t>'))
console.log('WAREHOUSE_REPORT_DOCX_LOCALE_PASS: native Russian Word, XLSX labels, financial coverage and separate scope')
