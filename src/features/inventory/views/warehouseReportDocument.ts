import {
  AlignmentType,Document,Footer,HeadingLevel,Packer,Paragraph,Table,TableCell,TableRow,
  TextRun,WidthType,ShadingType,
} from 'docx'
import type {WarehouseCapitalRow,WarehouseCapitalSnapshot} from '../../../../shared/warehouse-capital-types.ts'
import type {WarehouseDemandResponse,WarehouseDemandRow,WarehouseReportChoice,WarehouseFinanceChoice}
  from './warehouseReportExcel.ts'
import {
  labelCategory,labelCharacteristic,labelScope,labelSource,labelSourceFilter,
  dateTimeRu,integerRu,moneyRu,percentRu,
} from './warehouseReportLocale.ts'

/** Formatted, readable report for Word/PDF export, not a second source of statistics.
 * Detailed, filterable raw rows remain available in XLSX. No order-level customer data.
 */
const C={ink:'203D52',green:'177A65',muted:'62788A',pale:'EAF5F0',light:'F3F7F9',
  white:'FFFFFF',line:'DFE8ED',amber:'FFF3DA'}
type CellValue=string|number
const t=(text:string,options?:{bold?:boolean;color?:string,size?:number})=>
  new TextRun({text,bold:options?.bold,color:options?.color||C.ink,
    size:options?.size||20,font:'Aptos'})
const para=(text:string,opts?:{bold?:boolean,color?:string,size?:number,after?:number})=>
  new Paragraph({children:[t(text,opts)],spacing:{after:opts?.after??90},breakLine:false})
const title=(text:string)=>new Paragraph({children:[t(text,{bold:true,size:42})],
  spacing:{before:150,after:140},keepNext:true})
const h=(text:string)=>new Paragraph({children:[t(text,{bold:true,size:27})],
  heading:HeadingLevel.HEADING_2,spacing:{before:270,after:90},keepNext:true})
const minor=(text:string)=>new Paragraph({children:[t(text,{bold:true,size:22})],
  spacing:{before:180,after:70},keepNext:true})
const note=(text:string)=>new Paragraph({children:[t(text,{color:C.muted,size:17})],
  spacing:{after:125}})
const txt=(value:CellValue)=>String(value)
function cell(text:string,fill?:string,bold=false):TableCell{
  return new TableCell({
    shading:{type:ShadingType.CLEAR,color:'auto',fill:fill||C.white},
    margins:{top:115,bottom:115,left:125,right:125},
    children:[new Paragraph({children:[t(text,{bold,color:fill===C.ink?C.white:C.ink,size:17})],
      spacing:{after:0}})],
  })
}
function table(headers:string[],rows:CellValue[][],limit=250):Table{
  if(headers.length>7)throw Error('Печатный отчёт должен содержать не более семи столбцов')
  const selected=rows.slice(0,limit)
  const body=[
    new TableRow({children:headers.map(k=>cell(k,C.ink,true)),tableHeader:true}),
    ...selected.map((row,i)=>new TableRow({children:row.map(v=>cell(txt(v),i%2?C.white:C.light))})),
  ]
  return new Table({rows:body,width:{size:100,type:WidthType.PERCENTAGE}})
}
function keyValue(items:[string,string][]):Table{
  return new Table({rows:items.map(([key,value],i)=>new TableRow({children:[
    cell(key,i%2?C.white:C.light,true),cell(value,i%2?C.white:C.light),
  ]})),width:{size:100,type:WidthType.PERCENTAGE}})
}
function cover(eyebrow:string,heading:string,subtitle:string,time:string){
  return [
    new Paragraph({children:[t(eyebrow.toUpperCase(),{bold:true,color:C.green,size:19})],
      spacing:{after:110}}),
    title(heading),
    para(subtitle,{color:C.muted,size:22,after:180}),
    new Paragraph({children:[t('СФОРМИРОВАНО  ·  '+dateTimeRu(time),
      {color:C.muted,size:17})],spacing:{after:220}}),
  ]
}
function doc(children:Array<Paragraph|Table>,subject:string){
  return new Document({
    creator:'Система заказов',title:subject,subject,
    styles:{default:{document:{run:{font:'Aptos',size:20,color:C.ink},
      paragraph:{spacing:{after:90}}}}},
    sections:[{
      properties:{page:{margin:{top:760,right:760,bottom:840,left:760}}},
      footers:{default:new Footer({children:[new Paragraph({
        alignment:AlignmentType.RIGHT,children:[t('Система заказов  •  '+subject,
          {size:15,color:C.muted})],
      })]})},
      children,
    }],
  })
}
function totals(rows:WarehouseDemandRow[]){
  return rows.reduce((v,r)=>({
    sold:v.sold+r.sold,net:v.net+r.net,returned:v.returned+r.returned,
    priced:v.priced+r.pricedQuantity,revenue:v.revenue+r.knownRevenue,
  }),{sold:0,net:0,returned:0,priced:0,revenue:0})
}
function demandRank(rows:WarehouseDemandRow[],key:keyof WarehouseDemandRow){
  const m=new Map<string,WarehouseDemandRow[]>()
  for(const r of rows){
    const value=String(r[key]||'')
    const name=key==='source'?labelSource(value):
      key==='category'?labelCategory(value):labelCharacteristic(value)
    m.set(name,[...(m.get(name)||[]),r])
  }
  return [...m].map(([name,values])=>({name,...totals(values)}))
    .sort((a,b)=>b.net-a.net||b.sold-a.sold||a.name.localeCompare(b.name,'ru'))
}
function ranked(name:string,values:ReturnType<typeof demandRank>,total:number,limit:number){
  const max=Math.max(1,...values.map(v=>v.net))
  const rows=values.slice(0,limit).map((v,i)=>[
    String(i+1),v.name,integerRu(v.net),percentRu(v.net,total),
    '■'.repeat(Math.max(1,Math.round(Math.max(0,v.net)/max*11))),
  ])
  return [h(name),table(['№','Наименование','Без возвратов','Доля','Спрос'],rows,limit),
    values.length>limit?note('Показаны первые '+limit+' из '+values.length+
      '. Полный список, суммы и цены содержатся в Excel.'):
      note('Рейтинг построен по количеству после возвратов.') ]
}
/** Full overview and legible breakdown for humans; complete data rows remain in XLSX. */
export async function buildDemandStatisticsDocx(args:{
  demand:WarehouseDemandResponse;choice:WarehouseReportChoice;generatedAt?:string
}):Promise<Blob>{
  const {demand,choice}=args
  if(!demand.ok||demand.truncated||!demand.rows)
    throw Error('Неполные данные спроса нельзя включать в отчёт')
  const rows=demand.rows.filter(r=>(choice.source==='all'||r.source===choice.source)&&
    (choice.category==='all'||r.category===choice.category))
  const v=totals(rows)
  const generated=args.generatedAt||new Date().toISOString()
  const children:Array<Paragraph|Table>=[
    ...cover('Аналитический отчёт · Склад','Какие товары пользуются спросом',
      'Понятная картина спроса: модели, характеристики, точные варианты и цены.',
      generated),
    keyValue([
      ['Период',choice.start+' — '+choice.end],
      ['Учитываются',labelScope(choice.scope)],
      ['Источник',labelSource(choice.source)],
      ['Категория',labelCategory(choice.category)],
    ]),
    h('Главное за выбранный период'),
    keyValue([
      ['Товаров в выборке',integerRu(v.sold)+' шт.'],
      ['Без возвратов',integerRu(v.net)+' шт.'],
      ['Возвраты',integerRu(v.returned)+' шт.'],
      ['Стоимость по известным ценам позиций',moneyRu(v.revenue)],
      ['Средняя цена товара с известной ценой',v.priced?moneyRu(v.revenue/v.priced):'Нет данных'],
      ['Цена известна для',integerRu(v.priced)+' из '+integerRu(v.net)+' шт. ('+percentRu(v.priced,v.net)+')'],
    ]),
    note('Суммы отражают сохранённые цены позиций, не полученные платежи и не прибыль. Состав прошлых заказов может измениться после обменов.'),
  ]
  for(const [name,key] of [
    ['Модели','product'],['Цвета','color'],['Размеры','size'],
    ['Материалы','material'],['Длина','length'],['Пол','gender'],
  ] as const)children.push(...ranked(name,demandRank(rows,key),v.net,name==='Модели'?20:12))
  children.push(h('Подробно по моделям'))
  const modelRows=demandRank(rows,'product')
  for(const model of modelRows.slice(0,35)){
    const items=rows.filter(r=>r.product===model.name)
    children.push(minor(model.name+'  ·  '+integerRu(model.net)+' шт. ('+percentRu(model.net,v.net)+')'))
    children.push(table(['Исполнение','Цвет / размер','Источник','Без возвратов','Средняя цена'],items
      .sort((a,b)=>b.net-a.net).slice(0,12).map(r=>[
        [labelCharacteristic(r.material),labelCharacteristic(r.length)].join(' · '),
        labelCharacteristic(r.color)+' / '+labelCharacteristic(r.size),
        labelSource(r.source),integerRu(r.net),
        r.pricedQuantity?moneyRu(r.knownRevenue/r.pricedQuantity):'Неизвестна',
      ]),12))
    if(items.length>12)children.push(note('Показаны 12 ведущих вариантов из '+items.length+
      '. Остальные варианты доступны в Excel.'))
  }
  children.push(h('О чём важно помнить'))
  children.push(para('Отчёт показывает спрос по текущему составу заказов, а не неизменяемую историю выдач. Цены учитываются только там, где они известны.'))
  children.push(para('Excel содержит полные рейтинги и все сочетания характеристик для дальнейшего анализа, включая редко покупаемые варианты.'))
  return Packer.toBlob(doc(children,'Статистика спроса'))
}
function capitalSum(rows:WarehouseCapitalRow[]){
  return rows.reduce((v,r)=>{
    v.qty+=r.quantity;v.res+=r.reserved;v.free+=r.free
    if(r.costPrice===null)v.noCost+=r.quantity
    else {v.costQty+=r.quantity;v.cost+=r.costValue||0;
      v.freeCost+=r.free*r.costPrice;v.resCost+=r.reserved*r.costPrice}
    if(r.salePrice===null)v.noSale+=r.quantity
    else {v.saleQty+=r.quantity;v.sale+=r.retailValue||0;
      v.freeSale+=r.free*r.salePrice;v.resSale+=r.reserved*r.salePrice}
    if(r.costPrice!==null&&r.salePrice!==null){v.bothQty+=r.quantity;
      v.marg+=r.grossPotential||0;v.bothSale+=r.retailValue||0}
    return v
  },{qty:0,res:0,free:0,cost:0,sale:0,marg:0,costQty:0,saleQty:0,bothQty:0,
    bothSale:0,noCost:0,noSale:0,freeCost:0,resCost:0,freeSale:0,resSale:0})
}
function groupedCapital(rows:WarehouseCapitalRow[],key:(r:WarehouseCapitalRow)=>string){
  const m=new Map<string,WarehouseCapitalRow[]>()
  for(const r of rows){const k=key(r);m.set(k,[...(m.get(k)||[]),r])}
  return [...m].map(([name,items])=>({name,items,...capitalSum(items)}))
    .sort((a,b)=>b.cost-a.cost||b.qty-a.qty)
}
export async function buildWarehouseCapitalDocx(args:{
  capital:WarehouseCapitalSnapshot;choice:WarehouseFinanceChoice;generatedAt?:string
}):Promise<Blob>{
  const {capital,choice}=args
  if(!capital.ok||!Array.isArray(capital.rows))throw Error('Нет полного снимка остатков')
  const rows=capital.rows.filter(r=>(choice.source==='all'||r.source===choice.source)&&
    (choice.category==='all'||r.category===choice.category))
  const v=capitalSum(rows)
  const modelGroups=groupedCapital(rows,r=>r.product)
  const bySource=groupedCapital(rows,r=>labelSource(r.source))
  const priced=pctText(v.costQty,v.qty)
  const generated=args.generatedAt||new Date().toISOString()
  const children:Array<Paragraph|Table>=[
    ...cover('Финансовая аналитика · Склад','Сколько средств находится в товарах',
      'Оценка капитала, возможной выручки и структуры текущих запасов.',
      generated),
    keyValue([
      ['Снимок остатков',dateTimeRu(capital.capturedAt)],
      ['Источник',labelSourceFilter(choice.source)],
      ['Категория',labelCategory(choice.category)],
      ['Учитываются','Только положительные физические остатки'],
    ]),
    h('Самое важное'),
    keyValue([
      ['Средства в товарах по известной себестоимости',moneyRu(v.cost)],
      ['Потенциальная выручка по известным ценам',moneyRu(v.sale)],
      ['Потенциальная валовая разница, где есть обе цены',moneyRu(v.marg)],
      ['В наличии / резерв / свободно',integerRu(v.qty)+' / '+integerRu(v.res)+' / '+integerRu(v.free)+' шт.'],
    ]),
    h('Насколько полная эта оценка'),
    keyValue([
      ['Себестоимость известна для',integerRu(v.costQty)+' из '+integerRu(v.qty)+' шт. · '+priced],
      ['Продажная цена известна для',integerRu(v.saleQty)+' из '+integerRu(v.qty)+' шт. · '+pctText(v.saleQty,v.qty)],
      ['Обе цены известны для',integerRu(v.bothQty)+' шт.'],
      ['Без себестоимости',integerRu(v.noCost)+' шт.'],
      ['Без продажной цены',integerRu(v.noSale)+' шт.'],
    ]),
    para('Это стоимость только той части запасов, для которой известны соответствующие цены. Полную стоимость всех товаров эти суммы не обещают.',
      {color:C.green,bold:true,after:150}),
    h('Какая часть товара свободна'),
    keyValue([
      ['Свободный запас по известной себестоимости',moneyRu(v.freeCost)],
      ['Зарезервированный по известной себестоимости',moneyRu(v.resCost)],
      ['Свободный запас по известной цене продажи',moneyRu(v.freeSale)],
      ['Зарезервированный по известной цене продажи',moneyRu(v.resSale)],
    ]),
    note('Резервы входят в физический остаток, повторно не добавляются. Возможная выручка — не прогноз фактических продаж.'),
    h('Как распределены средства между складом и бутиком'),
    table(['Источник','В наличии','Себестоимость известной части','Возможная выручка'],
      bySource.map(r=>[r.name,integerRu(r.qty)+' шт.',moneyRu(r.cost),moneyRu(r.sale)]),20),
    h('В каких моделях сосредоточены деньги'),
    table(['№','Модель','Шт.','Известная себестоимость','Доля известной суммы'],
      modelGroups.slice(0,30).map((r,i)=>[i+1,r.name,integerRu(r.qty),
        moneyRu(r.cost),pctText(r.cost,v.cost)]),30),
    note('Рейтинг по известной себестоимости. Если цена модели отсутствует, её место в рейтинге может быть занижено.'),
    h('Ключевые модели: исполнения и остатки'),
  ]
  for(const model of modelGroups.slice(0,20)){
    children.push(minor(model.name+' · '+integerRu(model.qty)+' шт. · '+moneyRu(model.cost)))
    const variants=groupedCapital(model.items,r=>[
      labelCharacteristic(r.material),labelCharacteristic(r.length),
      labelCharacteristic(r.gender),labelCategory(r.category),
    ].join(' · '))
    children.push(table(['Исполнение','В наличии','Резерв','Известная себестоимость','Возможная выручка'],
      variants.slice(0,12).map(g=>[g.name,integerRu(g.qty),integerRu(g.res),
        moneyRu(g.cost),moneyRu(g.sale)]),12))
    if(variants.length>12)children.push(note('Показаны 12 исполнений из '+variants.length+
      '. Все исполнения и размеры доступны в Excel.'))
  }
  children.push(h('Точные остатки · выборка для проверки'))
  children.push(table(['Модель','Исполнение','Цвет / размер','Количество / резерв','Себестоимость / цена'],
    [...rows].sort((a,b)=>a.product.localeCompare(b.product,'ru')||b.quantity-a.quantity)
      .slice(0,180).map(r=>[
        r.product,[labelCharacteristic(r.material),labelCharacteristic(r.length)].join(' · '),
        labelCharacteristic(r.color)+' / '+labelCharacteristic(r.size),
        integerRu(r.quantity)+' / '+integerRu(r.reserved),
        (r.costPrice===null?'Неизвестна':moneyRu(r.costPrice))+' / '+
        (r.salePrice===null?'Неизвестна':moneyRu(r.salePrice)),
      ]),180))
  if(rows.length>180)children.push(note('В документе показаны первые 180 позиций из '+rows.length+
    '. Полная финансовая инвентаризация каждой позиции находится в Excel.'))
  children.push(h('Достоверность и методика'))
  children.push(keyValue([
    ['Нулевые строки в системе',integerRu(capital.totals.zeroRows)],
    ['Отрицательные строки в системе',integerRu(capital.totals.negativeRows)],
    ['Резерв превышает наличие',integerRu(capital.totals.overReservedRows)],
  ]))
  children.push(para('Нулевые и отрицательные количества исключены. Текущая себестоимость из каталога не всегда равна фактической стоимости прошлых закупок. Возможная маржа не равна чистой прибыли.'))
  return Packer.toBlob(doc(children,'Стоимость товарных запасов'))
}
const pctText=percentRu
