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
type Sheet={name:string;rows:Cell[][];widths:number[];freeze:number;filter?:string;merges?:string[]}
const T=(x:string,style=0):Cell=>({value:x,style})
const N=(x:number,style=4):Cell=>({value:x,style})
const MONEY=(x:number):Cell=>N(x,5)
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
function values(rows:WarehouseDemandRow[],key:keyof WarehouseDemandRow){
  const groups=new Map<string,{sold:number;net:number;returned:number;priced:number;revenue:number}>()
  for(const row of rows){
    const name=String(row[key]||'Не указано')
    const old=groups.get(name)||{sold:0,net:0,returned:0,priced:0,revenue:0}
    old.sold+=row.sold;old.net+=row.net;old.returned+=row.returned
    old.priced+=row.pricedQuantity;old.revenue+=row.knownRevenue
    groups.set(name,old)
  }
  return [...groups].map(([name,v])=>({name,...v})).sort((a,b)=>b.net-a.net||b.sold-a.sold||a.name.localeCompare(b.name,'ru'))
}
function dimensionSheet(name:string,key:keyof WarehouseDemandRow,rows:WarehouseDemandRow[],description:string){
  return reportSheet(name,name,description,['Значение','Заказано, шт.','Без возвратов, шт.','Возвраты, шт.','Оценено, шт.','Стоимость позиций, ₸','Средняя цена, ₸'],
    values(rows,key).map(g=>[T(g.name),N(g.sold),N(g.net),N(g.returned),N(g.priced),MONEY(g.revenue),g.priced?MONEY(g.revenue/g.priced):T('Нет цены')]),
    [44,19,22,18,18,25,23])
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
  ].join('')
  const fills=[
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF194A65"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF4EF"/></patternFill></fill>',
  ].join('')
  const xfs=[[0,0,0],[1,0,0],[2,0,0],[3,2,0],[0,0,3],[0,0,164],[4,3,164]]
  return head+'<styleSheet xmlns="'+ns+'"><numFmts count="1"><numFmt numFmtId="164" formatCode="'+xml('#,##0 "₸";[Red](#,##0 "₸");0 "₸"')+'"/></numFmts>'+
    '<fonts count="5">'+fonts+'</fonts><fills count="4">'+fills+'</fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="'+xfs.length+'">'+xfs.map(([font,fill,format])=>'<xf numFmtId="'+format+'" fontId="'+font+'" fillId="'+fill+'" borderId="0" xfId="0" applyNumberFormat="1"/>').join('')+
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
}
function sheetXml(sheet:Sheet){
  const rowXml=sheet.rows.map((cells,i)=>'<row r="'+(i+1)+'">'+cells.map((cell,j)=>{
    const attr=' r="'+col(j)+(i+1)+'" s="'+(cell.style||0)+'"'
    if(typeof cell.value==='number'){
      if(!Number.isFinite(cell.value))throw Error('Отчёт содержит некорректное число')
      return '<c'+attr+'><v>'+cell.value+'</v></c>'
    }
    return '<c'+attr+' t="inlineStr"><is><t xml:space="preserve">'+xml(cell.value)+'</t></is></c>'
  }).join('')+'</row>').join('')
  const widths=sheet.widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')
  const freeze='<sheetViews><sheetView workbookViewId="0"><pane ySplit="'+sheet.freeze+'" topLeftCell="A'+(sheet.freeze+1)+'" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
  const merges=sheet.merges?.length?'<mergeCells count="'+sheet.merges.length+'">'+sheet.merges.map(m=>'<mergeCell ref="'+m+'"/>').join('')+'</mergeCells>':''
  const filter=sheet.filter?'<autoFilter ref="'+sheet.filter+'"/>':''
  return head+'<worksheet xmlns="'+ns+'"><dimension ref="A1:'+col(sheet.widths.length-1)+sheet.rows.length+'"/>'+freeze+
    '<sheetFormatPr defaultRowHeight="20"/><cols>'+widths+'</cols><sheetData>'+rowXml+'</sheetData>'+filter+merges+
    '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>'
}
function capitalModels(rows:WarehouseCapitalRow[]){
  const map=new Map<string,{name:string;quantity:number;free:number;reserved:number;capital:number;retail:number;costKnown:number;saleKnown:number}>()
  for(const item of rows){
    const old=map.get(item.product)||{name:item.product,quantity:0,free:0,reserved:0,capital:0,retail:0,costKnown:0,saleKnown:0}
    old.quantity+=item.quantity;old.reserved+=item.reserved;old.free+=item.free
    if(item.costValue!==null){old.capital+=item.costValue;old.costKnown+=item.quantity}
    if(item.retailValue!==null){old.retail+=item.retailValue;old.saleKnown+=item.quantity}
    map.set(item.product,old)
  }
  return [...map.values()].sort((a,b)=>b.capital-a.capital||b.quantity-a.quantity)
}
export function buildWarehouseReportXlsx(args:{
  demand:WarehouseDemandResponse; choice:WarehouseReportChoice;
  capital?:WarehouseCapitalSnapshot|null; generatedAt?:string
}):Uint8Array{
  const {demand,choice,capital}=args
  if(!demand.ok||demand.truncated||!demand.rows)throw Error('Неполные данные статистики нельзя выгружать')
  const generatedAt=args.generatedAt||new Date().toISOString()
  const rows=demand.rows.filter(row=>(choice.source==='all'||row.source===choice.source)&&
    (choice.category==='all'||row.category===choice.category))
  const sold=rows.reduce((s,r)=>s+r.sold,0),net=rows.reduce((s,r)=>s+r.net,0)
  const returned=rows.reduce((s,r)=>s+r.returned,0)
  const priced=rows.reduce((s,r)=>s+r.pricedQuantity,0)
  const knownRevenue=rows.reduce((s,r)=>s+r.knownRevenue,0)
  const scopeText=choice.scope==='shipped'?'Только отправленные':'Все оформленные'
  const subtitle=choice.start+' — '+choice.end+' · '+scopeText+
    ' · источник '+choice.source+' · категория '+choice.category
  const overviewRows:Cell[][]=[
    [T('Дата формирования'),T(generatedAt)],
    [T('Период'),T(choice.start+' — '+choice.end)],
    [T('Режим'),T(scopeText)],
    [T('Источник'),T(choice.source)],
    [T('Категория'),T(choice.category)],
    [T('Заказано/отправлено, шт.'),N(sold)],
    [T('После возвратов, шт.'),N(net)],
    [T('Возвращено, шт.'),N(returned)],
    [T('С ценами позиций, шт.'),N(priced)],
    [T('Стоимость по известным ценам позиций'),MONEY(knownRevenue)],
    [T('Средняя цена по известным позициям'),priced?MONEY(knownRevenue/priced):T('Нет данных')],
    [T('Неполнота цен'),T(priced<net?'Цены известны не для всех позиций':'Нет пропусков по ценам')],
    [T('Методика'),T('Сумма позиций — не поступившие платежи и не чистая прибыль')],
    [T('Исторические изменения'),T('Обмены могут менять состав старых заказов; это не неизменяемый журнал продаж')],
  ]
  if(capital){
    const t=capital.totals
    overviewRows.push(
      [T('Остатки: оценка на'),T(capital.capturedAt)],
      [T('В наличии физически, шт.'),N(t.quantity)],
      [T('Из них зарезервировано, шт.'),N(t.reserved)],
      [T('Свободно, шт.'),N(t.free)],
      [T('Стоимость остатков по известной себестоимости'),MONEY(t.knownCost)],
      [T('Потенциальная выручка по известным ценам'),MONEY(t.knownSale)],
      [T('Потенциальная валовая маржа (по обеим ценам)'),MONEY(t.knownGrossPotential)],
      [T('Себестоимость известна для, шт.'),N(t.pricedCostQuantity)],
      [T('Цена продажи известна для, шт.'),N(t.pricedSaleQuantity)],
      [T('При обеих ценах, шт.'),N(t.bothPricedQuantity)],
      [T('Важно'),T('Оценка по текущим ценам каталога; не исторические закупки и не гарантированная выручка')],
    )
  }
  const sheets:Sheet[]=[
    reportSheet('Сводка','СТАТИСТИКА И ФИНАНСЫ СКЛАДА',subtitle,['Показатель','Значение'],overviewRows,[53,90]),
    dimensionSheet('Модели','product',rows,subtitle),
    dimensionSheet('Цвета','color',rows,subtitle),
    dimensionSheet('Размеры','size',rows,subtitle),
    dimensionSheet('Материалы','material',rows,subtitle),
    dimensionSheet('Длина','length',rows,subtitle),
    dimensionSheet('Пол','gender',rows,subtitle),
    reportSheet('Варианты спроса','ВСЕ ВАРИАНТЫ СПРОСА',subtitle,
      ['Модель','Цвет','Размер','Материал','Длина','Пол','Категория','Источник','Заказано','Возвращено','Без возвратов','По цене, шт.','Стоимость, ₸','Цена мин., ₸','Цена макс., ₸'],
      rows.map(r=>[T(r.product),T(r.color),T(r.size),T(r.material),T(r.length),T(r.gender),T(r.category),T(r.source),
        N(r.sold),N(r.returned),N(r.net),N(r.pricedQuantity),MONEY(r.knownRevenue),
        r.minPrice===null?T('Неизвестно'):MONEY(r.minPrice),r.maxPrice===null?T('Неизвестно'):MONEY(r.maxPrice)]),
      [33,18,15,21,18,14,16,16,14,14,17,17,21,19,19]),
  ]
  if(capital){
    sheets.push(reportSheet('Стоимость запасов','ОЦЕНКА ФИЗИЧЕСКИХ ОСТАТКОВ',
      'По текущим ценам каталога · '+capital.capturedAt+' · только положительные остатки',
      ['Источник','Модель','Пол','Цвет','Материал','Длина','Размер','Категория','На месте, шт.','Резерв, шт.','Свободно, шт.',
        'Себестоимость/шт., ₸','Цена/шт., ₸','Стоимость по себ., ₸','Возможная выручка, ₸','Потенц. маржа, ₸','Особенности'],
      capital.rows.map(r=>[T(r.source),T(r.product),T(r.gender),T(r.color),T(r.material),T(r.length),T(r.size),T(r.category),
        N(r.quantity),N(r.reserved),N(r.free),r.costPrice===null?T('Неизвестна'):MONEY(r.costPrice),
        r.salePrice===null?T('Неизвестна'):MONEY(r.salePrice),
        r.costValue===null?T('Не оценено'):MONEY(r.costValue),
        r.retailValue===null?T('Не оценено'):MONEY(r.retailValue),
        r.grossPotential===null?T('Не оценено'):MONEY(r.grossPotential),
        T([r.archived?'Архивная позиция':'',r.overReserved?'Резерв больше остатка':'',r.variantId===null?'Нет связанного SKU':''].filter(Boolean).join('; '))]),
      [15,36,15,19,19,16,15,15,17,15,17,22,22,24,25,23,35]))
    sheets.push(reportSheet('Капитал по моделям','КРУПНЕЙШИЕ ТОВАРНЫЕ ЗАПАСЫ',capital.capturedAt,
      ['Модель','На месте, шт.','Свободно, шт.','Резерв, шт.','Оценено по себ., шт.','Себестоимость, ₸','Оценено по цене, шт.','Потенц. выручка, ₸'],
      capitalModels(capital.rows).map(m=>[T(m.name),N(m.quantity),N(m.free),N(m.reserved),N(m.costKnown),
        MONEY(m.capital),N(m.saleKnown),MONEY(m.retail)]),
      [43,18,18,18,22,25,22,26]))
    const t=capital.totals
    sheets.push(reportSheet('Качество данных','ПОЛНОТА И ОГРАНИЧЕНИЯ ОЦЕНКИ',capital.capturedAt,
      ['Проверка','Количество','Комментарий'],[
        [T('Товаров с положительным остатком, шт.'),N(t.quantity),T('Физическое количество включает зарезервированные товары')],
        [T('Оценено по себестоимости, шт.'),N(t.pricedCostQuantity),T('Без неизвестных себестоимостей')],
        [T('Оценено по продажной цене, шт.'),N(t.pricedSaleQuantity),T('Только текущая цена исполнения')],
        [T('Оценено по обеим ценам, шт.'),N(t.bothPricedQuantity),T('Только они участвуют в потенциальной марже')],
        [T('Без себестоимости, шт.'),N(t.missingCostQuantity),T('Не заменяется средними ценами')],
        [T('Без цены продажи, шт.'),N(t.missingSaleQuantity),T('Не заменяется историческими суммами заказов')],
        [T('Строки с нулём'),N(t.zeroRows),T('Исключены из денежной оценки')],
        [T('Строки с отрицательным остатком'),N(t.negativeRows),T('Исключены из денежной оценки; требуют отдельной сверки')],
        [T('Строки, где резерв больше физического остатка'),N(t.overReservedRows),T('Резерв ограничен физическим количеством для денежной оценки')],
        [T('Положительные позиции без связанного варианта'),N(t.unlinkedPositiveRows),T('Включены количественно, но часто без цены')],
        [T('Есть таблица текущих цен'),T(capital.pricesAvailable?'Да':'Нет'),T('При отсутствии таблицы все суммы останутся неизвестными')],
        [T('Метод расчёта'),T('Текущая оценка'),T('Не является бухгалтерской закупочной стоимостью или прогнозом фактической выручки')],
      ],[50,24,96]))
  }
  if(sheets.length>25)throw Error('Слишком много листов')
  const files:Record<string,Uint8Array>={}
  const relationshipId=sheets.length+1
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
    '<Relationship Id="rId'+relationshipId+'" Type="'+relNs+'/styles" Target="styles.xml"/></Relationships>')
  files['xl/styles.xml']=strToU8(stylesXml())
  sheets.forEach((sheet,i)=>{files['xl/worksheets/sheet'+(i+1)+'.xml']=strToU8(sheetXml(sheet))})
  return zipSync(files,{level:6})
}
