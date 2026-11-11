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
for(const phrase of ['Какие товары пользуются спросом','Главное за выбранный период','Все модели и точные варианты',
  'БАЯН СУЛУ ЖИЛЕТ','Бежевый','Склад','Бутик','Взрослые']){
  assert.ok(xml.includes(phrase), 'Demand DOCX omitted '+phrase)
}
assert.ok(!xml.includes('>warehouse<')&&!xml.includes('>all<')&&!xml.includes('>boutique<'),
  'Internal English codes must never appear as document values')
assert.ok(!xml.includes('Стоимость товарных запасов'),'Demand report contains hidden capital data')
// Full Word is not a preview: 45 models and 16 variants each must all be present.
// The former implementation silently clipped after 35 models and 12 variants/model.
const largeRows=[]
for(let model=0;model<45;model++)for(let variant=0;variant<16;variant++){
  largeRows.push({...demand.rows[0],
    product:'МОДЕЛЬ_ПОЛНАЯ_'+String(model).padStart(2,'0'),
    color:'ЦВЕТ_ВАРИАНТА_'+String(variant).padStart(2,'0'),
    size:String(40+variant),sold:1,returned:0,net:1,pricedQuantity:1,knownRevenue:30000})
}
const complete=await buildDemandStatisticsDocx({
  demand:{ok:true,rows:largeRows},choice,generatedAt:'2026-11-11T08:00:00Z',
})
const completeXml=new TextDecoder().decode(unzipSync(new Uint8Array(await complete.arrayBuffer()))['word/document.xml'])
for(const name of ['МОДЕЛЬ_ПОЛНАЯ_00','МОДЕЛЬ_ПОЛНАЯ_35','МОДЕЛЬ_ПОЛНАЯ_44',
  'ЦВЕТ_ВАРИАНТА_00','ЦВЕТ_ВАРИАНТА_12','ЦВЕТ_ВАРИАНТА_15']){
  assert.ok(completeXml.includes(name),'Word report silently omitted '+name)
}
assert.equal((completeXml.match(/ЦВЕТ_ВАРИАНТА_/g)||[]).length>=720,true,
  'All 720 exact variants must be in Word, not only in Excel')
assert.ok(!completeXml.includes('О чём важно помнить'),
  'Do not append rejected editorial commentary')
assert.ok(!completeXml.includes('Показаны первые')&&!completeXml.includes('Остальные варианты доступны в Excel'),
  'Word must not silently shorten rankings or model variants')
const sortedModelNames=[...new Set(largeRows.map(r=>r.product))]
assert.equal(sortedModelNames.length,45)

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
