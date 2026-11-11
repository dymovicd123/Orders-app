import {labelCategory,labelCharacteristic,labelScope,labelSource,labelSourceFilter} from './warehouseReportLocale.ts'
import { strToU8, zipSync } from 'fflate'
import type { WarehouseCapitalSnapshot, WarehouseCapitalRow } from '../../../../shared/warehouse-capital-types.ts'

// Generates a real multi-sheet XLSX with numeric values, freezing and filters.
// Uses the same warehouse-demand response as the unchanged Statistics page.
// Untrusted catalog strings always remain inline strings, never Excel formulas.
export type WarehouseDemandRow = {
  product:string; color:string; size:string; material:string; length:string; gender:string;
  category:string; source:string; sold:number; returned:number; net:number; pricedQuantity:number;
  knownRevenue:number; priceDiscrepancyQuantity:number; minPrice:number|null; maxPrice:number|null;
}
export type WarehouseDemandResponse = {
  ok:boolean; truncated?:boolean; rows?:WarehouseDemandRow[];
  periodOrderCount?:number; periodShippedOrderCount?:number
}
export type WarehouseReportChoice={
  start:string; end:string; scope:'orders'|'shipped'; source:string; category:string
}
type Cell={value:string|number;style?:number}
type Sheet={name:string;rows:Cell[][];widths:number[];freeze:number;filter?:string;merges?:string[];bars?:string[];tabColor?:string;overview?:boolean}
const T=(x:string,style=0):Cell=>({value:x,style})
const N=(x:number,style=4):Cell=>({value:x,style})
const MONEY=(x:number):Cell=>N(x,5)
const COUNT=(x:number):Cell=>N(x,12)
const xml=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
const head='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const pkgNs='http://schemas.openxmlformats.org/package/2006/relationships'
const col=(i:number)=>{let r='';for(let k=i+1;k;k=Math.floor((k-1)/26))r=String.fromCharCode(65+(k-1)%26)+r;return r}
function reportSheet(name:string,title:string,subtitle:string,headers:string[],records:Cell[][],widths:number[]):Sheet{
  return {
    name,widths,freeze:4,filter:'A4:'+col(headers.length-1)+(records.length+4),
    merges:['A1:'+col(headers.length-1)+'1','A2:'+col(headers.length-1)+'2'],
    rows:[[T(title,1)],[T(subtitle,2)],[],headers.map(h=>T(h,3)),...records],
  }
}
function workbookXml(sheets:Sheet[]){
  const cols=sheets.map((s,i)=>'<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')
  return head+'<workbook xmlns="'+ns+'" xmlns:r="'+relNs+'"><sheets>'+cols+'</sheets></workbook>'
}
function stylesXml(){
  const fonts=[
    '<font><sz val="11"/><name val="Aptos"/></font>',
    '<font><b/><sz val="17"/><color rgb="FF183B54"/><name val="Aptos"/></font>',
    '<font><sz val="10"/><color rgb="FF607387"/><name val="Aptos"/></font>',
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF206B4B"/><name val="Aptos"/></font>',
    '<font><b/><sz val="10"/><color rgb="FF456177"/><name val="Aptos"/></font>',
    '<font><b/><sz val="21"/><color rgb="FF183B54"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF1C775E"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF1B334A"/><name val="Aptos"/></font>',
  ].join('')
  const fills=[
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF194A65"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF4EF"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF4FB"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FA"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF27578A"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>',
  ].join('')
  // Keep old style indices stable for existing full-detail sheets.
  // Cells use actual numbers (never strings) with a custom currency/count display format.
  const xfs=[
    [0,0,0], [1,0,0], [2,0,0], [3,2,0], [0,0,3],
    [0,0,164], [4,3,164], [7,6,0], [5,3,0],
    [6,3,166], [6,4,164], [2,0,0], [8,0,166],
    [9,0,0], [0,5,0], [0,5,3], [0,5,164], [8,0,165],
  ]
  const formats=[
    '<numFmt numFmtId="164" formatCode="'+xml('#,##0 "₸";[Red](#,##0 "₸");0 "₸"')+'"/>',
    '<numFmt numFmtId="165" formatCode="'+xml('0.0" %"')+'"/>',
    '<numFmt numFmtId="166" formatCode="'+xml('#,##0" шт."')+'"/>',
  ].join('')
  return head+'<styleSheet xmlns="'+ns+'"><numFmts count="3">'+formats+'</numFmts>'+
    '<fonts count="10">'+fonts+'</fonts><fills count="8">'+fills+'</fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="'+xfs.length+'">'+xfs.map(([font,fill,format])=>
      '<xf numFmtId="'+format+'" fontId="'+font+'" fillId="'+fill+
      '" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1">'+
      '<alignment vertical="center" wrapText="1"/></xf>').join('')+
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/>'+
    '</cellStyles></styleSheet>'
}
function sheetXml(sheet:Sheet){
  const rowXml=sheet.rows.map((cells,i)=>{
    const height=sheet.overview?(i===0?34:i===1?29:i===4?40:
      i===3||i===6?30:26):(i===0?32:i===1?25:i===3?39:24)
    return '<row r="'+(i+1)+'" ht="'+height+'" customHeight="1">'+
      cells.map((cell,j)=>{
        const attr=' r="'+col(j)+(i+1)+'" s="'+(cell.style||0)+'"'
        if(typeof cell.value==='number'){
          if(!Number.isFinite(cell.value))throw Error('Отчёт содержит некорректное число')
          return '<c'+attr+'><v>'+cell.value+'</v></c>'
        }
        return '<c'+attr+' t="inlineStr"><is><t xml:space="preserve">'+
          xml(cell.value)+'</t></is></c>'
      }).join('')+'</row>'
  }).join('')
  const widths=sheet.widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+
    '" width="'+w+'" customWidth="1"/>').join('')
  const freeze=sheet.freeze>0?'<pane ySplit="'+sheet.freeze+'" topLeftCell="A'+
    (sheet.freeze+1)+'" activePane="bottomLeft" state="frozen"/>':''
  const views='<sheetViews><sheetView workbookViewId="0" showGridLines="0">'+freeze+
    '</sheetView></sheetViews>'
  const merges=sheet.merges?.length?'<mergeCells count="'+sheet.merges.length+'">'+
    sheet.merges.map(m=>'<mergeCell ref="'+m+'"/>').join('')+'</mergeCells>':''
  const filter=sheet.filter?'<autoFilter ref="'+sheet.filter+'"/>':''
  const bars=(sheet.bars||[]).map((ref,i)=>
    '<conditionalFormatting sqref="'+ref+'"><cfRule type="dataBar" priority="'+(i+1)+'">'+
    '<dataBar showValue="1"><cfvo type="min"/><cfvo type="max"/>'+
    '<color rgb="FF70BAA0"/></dataBar></cfRule></conditionalFormatting>').join('')
  const sheetPr=sheet.tabColor?'<sheetPr><tabColor rgb="FF'+sheet.tabColor+'"/></sheetPr>':''
  return head+'<worksheet xmlns="'+ns+'">'+sheetPr+
    '<dimension ref="A1:'+col(sheet.widths.length-1)+sheet.rows.length+'"/>'+
    views+'<sheetFormatPr defaultRowHeight="24"/><cols>'+widths+'</cols>'+
    '<sheetData>'+rowXml+'</sheetData>'+filter+merges+bars+
    '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'+
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>'
}
function packageSheets(sheets:Sheet[]):Uint8Array{
  if(sheets.length<1||sheets.length>25)throw Error('Неверное количество листов')
  const names=new Set<string>()
  for(const s of sheets){
    if(s.name.length>31||names.has(s.name))throw Error('Некорректное или повторное имя листа: '+s.name)
    names.add(s.name)
    if(s.rows.length>65001)throw Error('Слишком много строк в Excel. Период необходимо сократить.')
  }
  const files:Record<string,Uint8Array>={}
  files['[Content_Types].xml']=strToU8(head+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
    sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>')
  files['_rels/.rels']=strToU8(head+'<Relationships xmlns="'+pkgNs+'"><Relationship Id="rId1" Type="'+relNs+'/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  files['xl/workbook.xml']=strToU8(workbookXml(sheets))
  files['xl/_rels/workbook.xml.rels']=strToU8(head+'<Relationships xmlns="'+pkgNs+'">'+
    sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+relNs+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
    '<Relationship Id="rId'+(sheets.length+1)+'" Type="'+relNs+'/styles" Target="styles.xml"/></Relationships>')
  files['xl/styles.xml']=strToU8(stylesXml())
  sheets.forEach((sheet,i)=>{files['xl/worksheets/sheet'+(i+1)+'.xml']=strToU8(sheetXml(sheet))})
  return zipSync(files,{level:6})
}
const DIMENSIONS=[
  ['Цвета','color'],['Размеры','size'],['Материалы','material'],
  ['Длина','length'],['Пол','gender'],
] as const
const safeText=(value:string|undefined|null)=>labelCharacteristic(String(value||''))
const ratio=(numerator:number,denominator:number)=>denominator?N(Math.round(numerator/denominator*10000)/100):T('—')
function groupedDemand(rows:WarehouseDemandRow[],field:keyof WarehouseDemandRow){
  const entries=new Map<string,{sold:number;net:number;returned:number;priced:number;revenue:number}>()
  for(const row of rows){
    const name=field==='source'?labelSource(String(row[field]??'')):
      field==='category'?labelCategory(String(row[field]??'')):safeText(String(row[field]??''))
    const entry=entries.get(name)||{sold:0,net:0,returned:0,priced:0,revenue:0}
    entry.sold+=row.sold;entry.net+=row.net;entry.returned+=row.returned
    entry.priced+=row.pricedQuantity;entry.revenue+=row.knownRevenue
    entries.set(name,entry)
  }
  return [...entries].map(([name,v])=>({name,...v})).sort((a,b)=>b.net-a.net||b.sold-a.sold||a.name.localeCompare(b.name,'ru'))
}
function demandRankSheet(name:string,field:keyof WarehouseDemandRow,rows:WarehouseDemandRow[],subtitle:string,totalNet:number){
  const groups=groupedDemand(rows,field)
  return reportSheet(name,'РЕЙТИНГ · '+name.toUpperCase(),subtitle,
    ['№','Наименование','Заказано, шт.','Без возвратов, шт.','Возвращено, шт.','Доля спроса, %',
      'Цена известна, шт.','Стоимость по ценам заказов, ₸','Средняя цена, ₸','Охват цен, %'],
    groups.map((g,i)=>[N(i+1),T(g.name),N(g.sold),N(g.net),N(g.returned),ratio(g.net,totalNet),
      N(g.priced),MONEY(g.revenue),g.priced?MONEY(g.revenue/g.priced):T('Неизвестна'),ratio(g.priced,g.net)]),
    [9,37,17,21,20,20,22,30,24,19])
}
/** Same summary rows, scope and filters as the existing Statistics screen.
 * Detail is exported as filterable model→property and exact variant rows; no private order list.
 */
export function buildDemandStatisticsXlsx(args:{
  demand:WarehouseDemandResponse;choice:WarehouseReportChoice;generatedAt?:string
}):Uint8Array{
  const {demand,choice}=args
  if(!demand.ok||demand.truncated||!Array.isArray(demand.rows))
    throw Error('Неполные данные статистики нельзя выгружать')
  const rows=demand.rows.filter(r=>(choice.source==='all'||r.source===choice.source)&&
    (choice.category==='all'||r.category===choice.category))
  const totals=rows.reduce((a,r)=>({
    sold:a.sold+r.sold,net:a.net+r.net,returned:a.returned+r.returned,
    priced:a.priced+r.pricedQuantity,knownRevenue:a.knownRevenue+r.knownRevenue,
    inconsistent:a.inconsistent+r.priceDiscrepancyQuantity,
  }),{sold:0,net:0,returned:0,priced:0,knownRevenue:0,inconsistent:0})
  const subtitle=choice.start+' — '+choice.end+' · '+(choice.scope==='shipped'?'Отправленные':'Оформленные')+
    ' · '+labelSource(choice.source)+' · '+labelCategory(choice.category)
  const summary:[string,Cell][]=[
    ['Сформировано',T(args.generatedAt||new Date().toISOString())],
    ['Начало периода',T(choice.start)],['Конец периода',T(choice.end)],
    ['Режим',T(labelScope(choice.scope))],
    ['Источник',T(labelSource(choice.source))],['Категория',T(labelCategory(choice.category))],
    ['Число оформленных заказов за период (общая выборка)',N(demand.periodOrderCount||0)],
    ['Число отправленных заказов за период (общая выборка)',N(demand.periodShippedOrderCount||0)],
    ['Количество позиций, шт.',N(totals.sold)],
    ['После возвратов, шт.',N(totals.net)],
    ['Возвраты, шт.',N(totals.returned)],
    ['Стоимость по сохранённым ценам позиций, ₸',MONEY(totals.knownRevenue)],
    ['Средняя цена известной позиции, ₸',totals.priced?MONEY(totals.knownRevenue/totals.priced):T('Неизвестна')],
    ['Известна цена, шт.',N(totals.priced)],
    ['Охват ценами, %',ratio(totals.priced,totals.net)],
    ['С расхождением старой строки цены, шт.',N(totals.inconsistent)],
    ['Методика',T('Срез состава заказов в выбранном периоде; история обменов может влиять на старые периоды')],
    ['Важно',T('Стоимость позиций не равна поступлениям, валовой или чистой прибыли')],
  ]
  const sheets:Sheet[]=[
    reportSheet('Сводка спроса','СТАТИСТИКА СПРОСА',subtitle,['Показатель','Значение'],
      summary.map(([name,cell])=>[T(name),cell]),[64,88]),
    demandRankSheet('Модели','product',rows,subtitle,totals.net),
  ]
  for(const [name,field] of DIMENSIONS)sheets.push(demandRankSheet(name,field,rows,subtitle,totals.net))
  sheets.push(demandRankSheet('Источники','source',rows,subtitle,totals.net))
  const breakdown=new Map<string,{model:string;dimension:string;value:string;sold:number;net:number;returned:number;priced:number;revenue:number}>()
  for(const r of rows)for(const [label,field] of [['Цвет','color'],['Размер','size'],['Материал','material'],
    ['Длина','length'],['Пол','gender'],['Источник','source']] as const){
    const key=[r.product,label,r[field]].join('\u001f')
    const prev=breakdown.get(key)||{model:r.product,dimension:label,value:field==='source'?labelSource(r[field]):labelCharacteristic(r[field]),sold:0,net:0,returned:0,priced:0,revenue:0}
    prev.sold+=r.sold;prev.net+=r.net;prev.returned+=r.returned
    prev.priced+=r.pricedQuantity;prev.revenue+=r.knownRevenue
    breakdown.set(key,prev)
  }
  const modelNet=new Map(groupedDemand(rows,'product').map(x=>[x.name,x.net]))
  const breakdownRows=[...breakdown.values()].sort((a,b)=>a.model.localeCompare(b.model,'ru')||
    a.dimension.localeCompare(b.dimension,'ru')||b.net-a.net)
  sheets.push(reportSheet('Разбор моделей','МОДЕЛИ И ХАРАКТЕРИСТИКИ',subtitle,
    ['Модель','Характеристика','Значение','Заказано, шт.','Без возвратов, шт.','Возвращено, шт.',
      'Доля внутри модели, %','С известной ценой, шт.','Стоимость позиций, ₸','Средняя цена, ₸'],
    breakdownRows.map(r=>[T(r.model),T(r.dimension),T(r.value),N(r.sold),N(r.net),N(r.returned),
      ratio(r.net,modelNet.get(r.model)||0),N(r.priced),MONEY(r.revenue),
      r.priced?MONEY(r.revenue/r.priced):T('Неизвестна')]),
    [37,25,26,18,23,18,23,22,28,23]))
  sheets.push(reportSheet('Все варианты','ТОЧНЫЕ ВАРИАНТЫ ТОВАРОВ',subtitle,
    ['Модель','Цвет','Размер','Материал','Длина','Пол','Категория','Источник',
      'Заказано, шт.','Возвращено, шт.','Без возвратов, шт.','Доля всего спроса, %',
      'С известной ценой, шт.','Стоимость позиций, ₸','Средняя цена, ₸','Цена мин., ₸','Цена макс., ₸',
      'Расхождение цены, шт.'],
    [...rows].sort((a,b)=>a.product.localeCompare(b.product,'ru')||b.net-a.net).map(r=>[
      T(r.product),T(labelCharacteristic(r.color)),T(labelCharacteristic(r.size)),T(labelCharacteristic(r.material)),T(labelCharacteristic(r.length)),T(labelCharacteristic(r.gender)),T(labelCategory(r.category)),T(labelSource(r.source)),
      N(r.sold),N(r.returned),N(r.net),ratio(r.net,totals.net),N(r.pricedQuantity),MONEY(r.knownRevenue),
      r.pricedQuantity?MONEY(r.knownRevenue/r.pricedQuantity):T('Неизвестна'),
      r.minPrice===null?T('Неизвестна'):MONEY(r.minPrice),
      r.maxPrice===null?T('Неизвестна'):MONEY(r.maxPrice),N(r.priceDiscrepancyQuantity)]),
    [34,20,16,22,19,17,17,17,17,20,23,23,23,29,24,22,22,24]))
  return packageSheets(sheets)
}
type FinancialSource='all'|'warehouse'|'boutique'
export type WarehouseFinanceChoice={source:FinancialSource;category:string}
function capitalFiltered(snapshot:WarehouseCapitalSnapshot,choice:WarehouseFinanceChoice){
  return snapshot.rows.filter(r=>(choice.source==='all'||r.source===choice.source)&&
    (choice.category==='all'||r.category===choice.category))
}
function capitalTotals(rows:WarehouseCapitalRow[]){
  return rows.reduce((t,r)=>{
    t.quantity+=r.quantity;t.reserved+=r.reserved;t.free+=r.free
    if(r.costPrice!==null){t.costQty+=r.quantity;t.cost+=r.costValue||0;
      t.freeCost+=r.free*r.costPrice;t.reservedCost+=r.reserved*r.costPrice}
    else t.unknownCostQty+=r.quantity
    if(r.salePrice!==null){t.saleQty+=r.quantity;t.sale+=r.retailValue||0;
      t.freeSale+=r.free*r.salePrice;t.reservedSale+=r.reserved*r.salePrice}
    else t.unknownSaleQty+=r.quantity
    if(r.grossPotential!==null&&r.salePrice!==null){t.bothQty+=r.quantity;t.gross+=r.grossPotential;t.comparableSale+=r.quantity*r.salePrice}
    return t
  },{quantity:0,reserved:0,free:0,costQty:0,saleQty:0,bothQty:0,cost:0,sale:0,gross:0,
    freeCost:0,reservedCost:0,freeSale:0,reservedSale:0,comparableSale:0,unknownCostQty:0,unknownSaleQty:0})
}
const financeGroups=(rows:WarehouseCapitalRow[],fields:(keyof WarehouseCapitalRow)[])=>
  [...rows.reduce((map,r)=>{
    const key=fields.map(f=>String(r[f]??'—')).join('\u001f')
    const prev=map.get(key)||{labels:fields.map(f=>f==='source'?labelSource(String(r[f]??'')):
      f==='category'?labelCategory(String(r[f]??'')):f==='product'?String(r[f]??''):
      labelCharacteristic(String(r[f]??''))),items:[] as WarehouseCapitalRow[]}
    prev.items.push(r);map.set(key,prev);return map
  },new Map<string,{labels:string[];items:WarehouseCapitalRow[]}>()).values()]
  .map(r=>({...r,summary:capitalTotals(r.items)}))
  .sort((a,b)=>b.summary.cost-a.summary.cost||b.summary.quantity-a.summary.quantity)
/** Financial inventory is a snapshot, not period sales; no orders or demand sheets. */
export function buildWarehouseCapitalXlsx(args:{
  capital:WarehouseCapitalSnapshot;choice:WarehouseFinanceChoice;generatedAt?:string
}):Uint8Array{
  const {capital,choice}=args
  if(!capital.ok||!Array.isArray(capital.rows))throw Error('Нет полной оценки склада')
  const rows=capitalFiltered(capital,choice)
  const v=capitalTotals(rows)
  const captured=capital.capturedAt
  const subtitle='Снимок '+captured+' · источник '+labelSourceFilter(choice.source)+' · категория '+labelCategory(choice.category)+
    ' · только положительные остатки'
  const val=(n:number)=>MONEY(n)
  const summary:[string,Cell][]=[
    ['Время оценки остатков',T(captured)],['Сформирован файл',T(args.generatedAt||new Date().toISOString())],
    ['Источник',T(labelSourceFilter(choice.source))],['Категория',T(labelCategory(choice.category))],
    ['Физически на месте, шт.',N(v.quantity)],['Из них в резерве, шт.',N(v.reserved)],
    ['Свободно к продаже, шт.',N(v.free)],
    ['Стоимость по известной себестоимости, ₸',val(v.cost)],
    ['Потенциальная продажная стоимость, ₸',val(v.sale)],
    ['Потенциальная валовая маржа (где известны обе цены), ₸',val(v.gross)],
    ['Охват себестоимостью, %',ratio(v.costQty,v.quantity)],
    ['Охват продажной ценой, %',ratio(v.saleQty,v.quantity)],
    ['Маржа на сопоставимых позициях, %',ratio(v.gross,v.comparableSale)],
    ['Свободно по известной себестоимости, ₸',val(v.freeCost)],
    ['Резерв по известной себестоимости, ₸',val(v.reservedCost)],
    ['Свободно по известной цене продажи, ₸',val(v.freeSale)],
    ['Резерв по известной цене продажи, ₸',val(v.reservedSale)],
    ['Без известной себестоимости, шт.',N(v.unknownCostQty)],
    ['Без известной продажной цены, шт.',N(v.unknownSaleQty)],
    ['Важно',T('Текущая оценка по каталогу, не исторические закупки, не реальные платежи и не чистая прибыль')],
    ['Качество неотрицательных остатков',T('Исключённые 0/минус и аномалии показаны на листе «Качество»')],
  ]
  const sheets:Sheet[]=[
    reportSheet('Сводка запасов','ДЕНЬГИ В ТОВАРНЫХ ОСТАТКАХ',subtitle,
      ['Показатель','Значение'],summary.map(([label,value])=>[T(label),value]),[66,95]),
  ]
  function financialGroupSheet(name:string,fields:(keyof WarehouseCapitalRow)[],headers:string[]){
    const entries=financeGroups(rows,fields)
    return reportSheet(name,name.toUpperCase(),subtitle,
      [...headers,'Физически, шт.','Резерв, шт.','Свободно, шт.','Себ. известна, шт.',
        'Стоимость по себ., ₸','Цена известна, шт.','Возможная выручка, ₸',
        'Обе цены, шт.','Возможная маржа, ₸','Возможная маржа, %','Охват себ., %','Охват цены, %'],
      entries.map(e=>[...e.labels.map(l=>T(l)),N(e.summary.quantity),N(e.summary.reserved),
        N(e.summary.free),N(e.summary.costQty),MONEY(e.summary.cost),N(e.summary.saleQty),
        MONEY(e.summary.sale),N(e.summary.bothQty),MONEY(e.summary.gross),ratio(e.summary.gross,e.summary.comparableSale),
        ratio(e.summary.costQty,e.summary.quantity),ratio(e.summary.saleQty,e.summary.quantity)]),
      [...fields.map(()=>33),18,18,18,23,28,23,28,20,28,22,20,20])
  }
  sheets.push(financialGroupSheet('Модели',['product'],['Модель']))
  sheets.push(financialGroupSheet('Исполнения',['product','gender','material','length','category'],
    ['Модель','Пол','Материал','Длина','Категория']))
  sheets.push(financialGroupSheet('Источники',['source'],['Источник']))
  sheets.push(reportSheet('Все остатки','ВСЕ ТОВАРЫ В НАЛИЧИИ',subtitle,
    ['Источник','Модель','Пол','Материал','Длина','Категория','Цвет','Размер','Физически, шт.',
      'Резерв, шт.','Свободно, шт.','Себестоимость / шт., ₸','Цена / шт., ₸',
      'Стоимость по себ., ₸','Возможная выручка, ₸','Возможная маржа, ₸',
      'Свободно по цене, ₸','Резерв по цене, ₸','Статус'],
    [...rows].sort((a,b)=>a.product.localeCompare(b.product,'ru')||a.material.localeCompare(b.material,'ru')||
      a.color.localeCompare(b.color,'ru')).map(r=>[
      T(labelSource(r.source)),T(r.product),T(labelCharacteristic(r.gender)),T(labelCharacteristic(r.material)),T(labelCharacteristic(r.length)),T(labelCategory(r.category)),T(labelCharacteristic(r.color)),T(labelCharacteristic(r.size)),
      N(r.quantity),N(r.reserved),N(r.free),
      r.costPrice===null?T('Неизвестна'):MONEY(r.costPrice),
      r.salePrice===null?T('Неизвестна'):MONEY(r.salePrice),
      r.costValue===null?T('Не оценено'):MONEY(r.costValue),
      r.retailValue===null?T('Не оценено'):MONEY(r.retailValue),
      r.grossPotential===null?T('Не оценено'):MONEY(r.grossPotential),
      r.salePrice===null?T('Не оценено'):MONEY(r.free*r.salePrice),
      r.salePrice===null?T('Не оценено'):MONEY(r.reserved*r.salePrice),
      T([r.overReserved?'Резерв превышает количество':'',r.archived?'Архивная модель или вариант':'',
        r.variantId===null?'Нет связанного варианта':''].filter(Boolean).join('; ')||'—')]),
    [16,37,15,21,19,18,20,15,18,18,18,27,25,28,29,27,25,25,42]))
  const global=capital.totals
  sheets.push(reportSheet('Качество','ПОЛНОТА ДАННЫХ И ИСКЛЮЧЕНИЯ',
    'Качество 0/минус и аномалий — глобально по всем источникам. Цена и количество — по выбранным фильтрам.',
    ['Показатель','Число','Описание'],[
      [T('Положительный физический остаток, шт.'),N(v.quantity),T('Включая резерв; после выбранных фильтров')],
      [T('Неизвестная себестоимость, шт.'),N(v.unknownCostQty),T('Не оценивается по себестоимости')],
      [T('Неизвестная цена продажи, шт.'),N(v.unknownSaleQty),T('Не оценивается по цене продажи')],
      [T('Известны обе цены, шт.'),N(v.bothQty),T('Только они входят в потенциальную валовую маржу')],
      [T('Строк с нулевым остатком (все источники)'),N(global.zeroRows),T('Исключены из расчёта')],
      [T('Строк с отрицательным остатком (все источники)'),N(global.negativeRows),T('Исключены из расчёта')],
      [T('Резерв превышает остаток (все источники)'),N(global.overReservedRows),T('Для оценки резерв ограничен физическим запасом')],
      [T('Позиция без каталожного варианта (все источники)'),N(global.unlinkedPositiveRows),T('Физическое количество учитывается')],
      [T('Цены каталога доступны'),T(capital.pricesAvailable?'Да':'Нет'),T('При отсутствии цен суммы являются частичными')],
      [T('Методика'),T('Оценочная'),T('Не бухгалтерская стоимость закупок и не гарантированная выручка')],
    ],[58,26,96]))
  return packageSheets(sheets)
}
