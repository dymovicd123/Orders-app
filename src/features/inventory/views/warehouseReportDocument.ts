import {
  AlignmentType,Document,Footer,HeadingLevel,Packer,Paragraph,Table,TableCell,TableRow,
  TextRun,WidthType,ShadingType,
} from 'docx'
import type {WarehouseCapitalRow,WarehouseCapitalSnapshot} from '../../../../shared/warehouse-capital-types.ts'
import type {
  WarehouseDemandResponse,WarehouseDemandRow,WarehouseReportChoice,WarehouseFinanceChoice,
} from './warehouseReportExcel.ts'
import {
  labelCategory,labelCharacteristic,labelScope,labelSource,labelSourceFilter,
  dateTimeRu,integerRu,moneyRu,percentRu,
} from './warehouseReportLocale.ts'

/** A print version of the *same hierarchy* as the two inventory pages:
 * period and filters -> key numbers -> rankings -> model -> execution -> exact variants.
 * The same filtered response powers the UI and the document; no arbitrary top-N limits.
 */
const palette={
  ink:'1B334A',blue:'27578A',green:'1C775E',muted:'64778A',white:'FFFFFF',
  paleBlue:'EDF4FB',paleGreen:'EAF5EF',pale:'F4F7FA',line:'DFE7EE',barEmpty:'CBD7E3',
}
const run=(value:string,opts?:{bold?:boolean;color?:string,size?:number})=>
  new TextRun({text:value,bold:opts?.bold,color:opts?.color||palette.ink,
    size:opts?.size||19,font:'Aptos'})
const paragraph=(value:string,opts?:{bold?:boolean;color?:string,size?:number,
  before?:number,after?:number})=>
  new Paragraph({children:[run(value,opts)],spacing:{
    before:opts?.before||0,after:opts?.after??75,
  }})
const heading=(value:string)=>new Paragraph({
  heading:HeadingLevel.HEADING_2,keepNext:true,
  children:[run(value,{bold:true,size:27})],
  spacing:{before:235,after:105},
})
const modelHeading=(value:string)=>new Paragraph({
  heading:HeadingLevel.HEADING_3,keepNext:true,
  children:[run(value,{bold:true,size:24,color:palette.blue})],
  spacing:{before:210,after:80},
})
const executionHeading=(value:string)=>new Paragraph({
  heading:HeadingLevel.HEADING_4,keepNext:true,
  children:[run(value,{bold:true,size:19})],
  spacing:{before:140,after:65},
})
type Line=Paragraph|Table
type Value=string|number
const inkCell=(lines:Paragraph[],fill:string,opts?:{width?:number}):TableCell=>
  new TableCell({
    shading:{type:ShadingType.CLEAR,fill,color:'auto'},
    margins:{top:118,bottom:118,left:130,right:130},
    width:opts?.width?{size:opts.width,type:WidthType.PERCENTAGE}:undefined,
    children:lines,
  })
function cell(value:Value,fill:string,bold=false,color=palette.ink,width?:number){
  return inkCell([paragraph(String(value),{bold,color,size:17,after:0})],fill,{width})
}
function table(headers:string[],records:Value[][],widths?:number[]):Table{
  if(headers.length<1||headers.length>6)throw Error('Слишком широкая таблица отчёта')
  const row=(values:Value[],i:number,head=false)=>new TableRow({
    cantSplit:true,
    tableHeader:head,
    children:values.map((v,j)=>cell(v,head?palette.ink:i%2?palette.white:palette.pale,
      head,head?palette.white:palette.ink,widths?.[j])),
  })
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},
    rows:[row(headers,0,true),...records.map((v,i)=>row(v,i))]})
}
function metric(label:string,value:string,details:string,fill:string):TableCell{
  return inkCell([
    paragraph(label,{color:palette.muted,size:17,after:105}),
    paragraph(value,{bold:true,size:29,color:palette.ink,after:105}),
    paragraph(details,{color:palette.muted,size:16,after:0}),
  ],fill)
}
function metricGrid(items:{label:string;value:string;details:string;fill:string}[],columns=2):Table{
  const rows:TableRow[]=[]
  for(let i=0;i<items.length;i+=columns){
    const cells=items.slice(i,i+columns).map(x=>metric(x.label,x.value,x.details,x.fill))
    while(cells.length<columns)cells.push(metric('','','',palette.white))
    rows.push(new TableRow({cantSplit:true,children:cells}))
  }
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},rows})
}
function sectionBanner(value:string,detail:string):Line[]{
  return [heading(value),paragraph(detail,{color:palette.muted,size:17,after:105})]
}
function banner(type:string,title:string,subtitle:string,when:string,filters:[string,string][]):Line[]{
  const mast=new Paragraph({spacing:{after:55},children:[
    run(type.toUpperCase(),{bold:true,color:palette.green,size:17}),
  ]})
  const main=new Paragraph({heading:HeadingLevel.HEADING_1,
    children:[run(title,{bold:true,color:palette.ink,size:39})],
    spacing:{before:50,after:90},keepNext:true})
  const sub=paragraph(subtitle,{color:palette.muted,size:19,after:135})
  const filterRows=filters.map(([key,value])=>[key,value])
  return [mast,main,sub,table(['Выборка','Значение'],
    [...filterRows,['Сформировано',dateTimeRu(when)]],[29,71])]
}
function document(children:Line[],subject:string){
  return new Document({
    creator:'Система заказов',title:subject,subject,
    styles:{default:{document:{run:{font:'Aptos',size:19,color:palette.ink},
      paragraph:{spacing:{after:70}}}}},
    sections:[{
      properties:{page:{margin:{top:760,right:760,bottom:790,left:760}}},
      footers:{default:new Footer({children:[new Paragraph({
        alignment:AlignmentType.RIGHT,
        children:[run('Система заказов  ·  '+subject,{size:14,color:palette.muted})],
      })]})},
      children,
    }],
  })
}
type DemandTotal={sold:number;net:number;returned:number;priced:number;revenue:number}
const emptyDemand=():DemandTotal=>({sold:0,net:0,returned:0,priced:0,revenue:0})
const addDemand=(v:DemandTotal,r:WarehouseDemandRow)=>{v.sold+=r.sold;v.net+=r.net;
  v.returned+=r.returned;v.priced+=r.pricedQuantity;v.revenue+=r.knownRevenue;return v}
const totalDemand=(rows:WarehouseDemandRow[])=>rows.reduce(addDemand,emptyDemand())
type Rank={name:string}&DemandTotal
function demandRank(rows:WarehouseDemandRow[],field:keyof WarehouseDemandRow):Rank[]{
  const map=new Map<string,DemandTotal>()
  for(const r of rows){
    const raw=String(r[field]||'')
    const name=field==='source'?labelSource(raw):field==='category'?labelCategory(raw):
      field==='product'?raw:labelCharacteristic(raw)
    const current=map.get(name)||emptyDemand()
    addDemand(current,r);map.set(name,current)
  }
  return [...map].map(([name,v])=>({name,...v}))
    .sort((a,b)=>b.net-a.net||b.sold-a.sold||a.name.localeCompare(b.name,'ru'))
}
function progress(value:number,max:number,blocks=11){
  const n=value>0&&max>0?Math.max(1,Math.round(value/max*blocks)):0
  return [
    run('▰'.repeat(n),{color:palette.green,size:15}),
    run('▱'.repeat(blocks-n),{color:palette.barEmpty,size:15}),
  ]
}
/** Same ranked visual language as the Statistics screen, not an Excel-style grid. */
function ranked(name:string,groups:Rank[],all:DemandTotal):Line[]{
  const lines:Line[]=[heading(name)]
  if(!groups.length){lines.push(paragraph('Нет данных за выбранный период.'));return lines}
  const maximum=Math.max(1,...groups.map(g=>Math.max(0,g.net)))
  const records=groups.map((g,i)=>new TableRow({cantSplit:true,children:[
    cell(String(i+1),i%2?palette.white:palette.pale,true,palette.blue,10),
    inkCell([
      paragraph(g.name,{bold:true,size:18,after:65}),
      new Paragraph({children:progress(Math.max(0,g.net),maximum),
        spacing:{after:0}}),
    ],i%2?palette.white:palette.pale,{width:56}),
    inkCell([
      paragraph(integerRu(g.net)+' шт. · '+percentRu(g.net,all.net),
        {bold:true,size:18,after:50}),
      paragraph(g.priced?'Средняя '+moneyRu(g.revenue/g.priced):
        'Цена неизвестна',{size:16,color:palette.muted,after:0}),
    ],i%2?palette.white:palette.pale,{width:34}),
  ]}))
  lines.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:records}))
  return lines
}
function groupBy<T>(rows:T[],key:(item:T)=>string):Map<string,T[]>{
  const result=new Map<string,T[]>()
  for(const r of rows){const name=key(r);const existing=result.get(name)||[];
    existing.push(r);result.set(name,existing)}
  return result
}
const demandExecution=(r:WarehouseDemandRow)=>[
  labelCharacteristic(r.material),labelCharacteristic(r.length),
  labelCharacteristic(r.gender),labelCategory(r.category),
].join(' · ')
function variantPrice(r:WarehouseDemandRow){
  if(!r.pricedQuantity)return {main:'Нет цены',detail:'Цена неизвестна'}
  const range=r.minPrice===null||r.maxPrice===null?'Диапазон неизвестен':
    r.minPrice===r.maxPrice?'Цена '+moneyRu(r.minPrice):
      moneyRu(r.minPrice)+'–'+moneyRu(r.maxPrice)
  return {
    main:moneyRu(r.knownRevenue/r.pricedQuantity),
    detail:range+' · с ценой '+integerRu(r.pricedQuantity)+' шт.'+
      (r.priceDiscrepancyQuantity>0?' · расхождений '+
        integerRu(r.priceDiscrepancyQuantity):''),
  }
}
function twoLineCell(main:string,detail:string,fill:string,width:number){
  return inkCell([
    paragraph(main,{bold:true,size:18,after:50}),
    paragraph(detail,{size:15,color:palette.muted,after:0}),
  ],fill,{width})
}
function demandVariantTable(rows:WarehouseDemandRow[]):Table{
  const headers=['Цвет / размер','Источник','Количество','Средняя цена']
  const header=new TableRow({tableHeader:true,cantSplit:true,children:
    headers.map((h,i)=>cell(h,palette.ink,true,palette.white,[27,16,23,34][i]))})
  const items=rows.map((r,i)=>{
    const fill=i%2?palette.white:palette.pale
    const price=variantPrice(r)
    return new TableRow({cantSplit:true,children:[
      twoLineCell(labelCharacteristic(r.color)+' · '+labelCharacteristic(r.size),
        labelCharacteristic(r.gender),fill,27),
      cell(labelSource(r.source),fill,false,palette.ink,16),
      twoLineCell(integerRu(r.net)+' шт. без возвратов',
        'Заказано '+integerRu(r.sold)+' · возвратов '+integerRu(r.returned),fill,23),
      twoLineCell(price.main,price.detail,fill,34),
    ]})
  })
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[header,...items]})
}
function capitalVariantTable(rows:WarehouseCapitalRow[]):Table{
  const heads=['Цвет / размер','Место','Остатки','Себестоимость','Цена продажи']
  const widths=[25,12,21,21,21]
  const header=new TableRow({tableHeader:true,cantSplit:true,children:
    heads.map((h,i)=>cell(h,palette.ink,true,palette.white,widths[i]))})
  const items=rows.map((r,i)=>{
    const fill=i%2?palette.white:palette.pale
    return new TableRow({cantSplit:true,children:[
      twoLineCell(labelCharacteristic(r.color)+' · '+labelCharacteristic(r.size),'',fill,25),
      cell(labelSource(r.source),fill,false,palette.ink,12),
      twoLineCell(integerRu(r.quantity)+' шт.',
        'Свободно '+integerRu(r.free)+' · резерв '+integerRu(r.reserved),fill,21),
      twoLineCell(r.costPrice===null?'Неизвестна':moneyRu(r.costPrice)+'/шт.',
        r.costPrice===null?'Цена не заполнена':'Всего '+moneyRu(r.costValue||0),fill,21),
      twoLineCell(r.salePrice===null?'Неизвестна':moneyRu(r.salePrice)+'/шт.',
        r.salePrice===null?'Цена не заполнена':'Всего '+moneyRu(r.retailValue||0),fill,21),
    ]})
  })
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[header,...items]})
}
export async function buildDemandStatisticsDocx(args:{
  demand:WarehouseDemandResponse;choice:WarehouseReportChoice;generatedAt?:string
}):Promise<Blob>{
  const {demand,choice}=args
  if(!demand.ok||demand.truncated||!Array.isArray(demand.rows))
    throw Error('Неполные данные нельзя включать в отчёт')
  const rows=demand.rows.filter(r=>(choice.source==='all'||r.source===choice.source)&&
    (choice.category==='all'||r.category===choice.category))
  const all=totalDemand(rows)
  const when=args.generatedAt||new Date().toISOString()
  const lines:Line[]=[
    ...banner('Статистика товаров','Какие товары пользуются спросом',
      'Модели, цвета и размеры, которые выбирают покупатели.',when,[
        ['Период',choice.start+' — '+choice.end],
        ['Учитываем',labelScope(choice.scope)],
        ['Источник',labelSource(choice.source)],
        ['Категория',labelCategory(choice.category)],
      ]),
    ...sectionBanner('Главное за выбранный период',
      choice.scope==='shipped'?'Только отправленные товары':'Все оформленные заказы'),
    metricGrid([
      {label:choice.scope==='shipped'?'Отправлено товаров':'Заказано товаров',
        value:integerRu(all.sold)+' шт.',details:'',fill:palette.paleBlue},
      {label:'Без возвратов',value:integerRu(all.net)+' шт.',
        details:'Возвратов: '+integerRu(all.returned)+' шт.',fill:palette.paleGreen},
      {label:'Стоимость по ценам позиций',value:all.priced?moneyRu(all.revenue):'Нет данных',
        details:'Цена известна для '+integerRu(all.priced)+' из '+integerRu(all.net)+' шт.',
        fill:palette.pale},
      {label:'Средняя цена товара',value:all.priced?moneyRu(all.revenue/all.priced):'Нет данных',
        details:'По товарам с известной ценой',fill:palette.pale},
    ]),
    ...sectionBanner('Что чаще всего заказывают',
      'Рейтинг каждой характеристики за выбранный период.'),
  ]
  // Preserve the exact hierarchy visible in the Statistics page.
  lines.push(...ranked('Модели',demandRank(rows,'product'),all))
  lines.push(...ranked('Цвета',demandRank(rows,'color'),all))
  lines.push(...ranked('Размеры',demandRank(rows,'size'),all))
  lines.push(...sectionBanner('Другие характеристики товаров',''))
  for(const [name,field] of [
    ['Материалы','material'],['Длина','length'],['Пол','gender'],
  ] as const)lines.push(...ranked(name,demandRank(rows,field),all))
  lines.push(...sectionBanner('Подробности по моделям',
    'Для каждой модели — исполнения и все точные варианты.'))
  const byModel=groupBy(rows,r=>r.product)
  for(const model of demandRank(rows,'product')){
    const variants=byModel.get(model.name)||[]
    lines.push(modelHeading(model.name))
    lines.push(paragraph(
      integerRu(model.net)+' шт. · '+percentRu(model.net,all.net)+' спроса'+
      ' · возвратов '+integerRu(model.returned)+
      ' · средняя цена '+(model.priced?moneyRu(model.revenue/model.priced):'неизвестна'),
      {size:18,color:palette.muted,after:105}))
    const executions=groupBy(variants,demandExecution)
    for(const [execution,items] of executions){
      const sum=totalDemand(items)
      lines.push(executionHeading(execution))
      lines.push(paragraph(integerRu(sum.net)+' шт. без возвратов · '+
        (sum.priced?'средняя цена '+moneyRu(sum.revenue/sum.priced):
          'цена неизвестна'),{color:palette.muted,size:17,after:85}))
      lines.push(demandVariantTable([...items].sort((a,b)=>b.net-a.net||
        a.color.localeCompare(b.color,'ru')||a.size.localeCompare(b.size,'ru'))))
    }
  }
  if(!byModel.size)lines.push(paragraph('Данных за выбранный период нет.'))
  return Packer.toBlob(document(lines,'Статистика спроса'))
}
type CapitalTotal={
  quantity:number;reserved:number;free:number;cost:number;sale:number;
  freeCost:number;reservedCost:number;freeSale:number;reservedSale:number;
  costQty:number;saleQty:number;
}
const emptyCapital=():CapitalTotal=>({quantity:0,reserved:0,free:0,cost:0,sale:0,
  freeCost:0,reservedCost:0,freeSale:0,reservedSale:0,costQty:0,saleQty:0})
function capitalTotal(rows:WarehouseCapitalRow[]):CapitalTotal{
  return rows.reduce((s,r)=>{
    s.quantity+=r.quantity;s.reserved+=r.reserved;s.free+=r.free
    if(r.costPrice!==null){s.costQty+=r.quantity;s.cost+=r.costValue||0;
      s.freeCost+=r.free*r.costPrice;s.reservedCost+=r.reserved*r.costPrice}
    if(r.salePrice!==null){s.saleQty+=r.quantity;s.sale+=r.retailValue||0;
      s.freeSale+=r.free*r.salePrice;s.reservedSale+=r.reserved*r.salePrice}
    return s
  },emptyCapital())
}
function capitalRank(rows:WarehouseCapitalRow[]){
  return [...groupBy(rows,r=>r.product)].map(([name,items])=>({
    name,items,totals:capitalTotal(items),
  })).sort((a,b)=>b.totals.cost-a.totals.cost||
    b.totals.quantity-a.totals.quantity||a.name.localeCompare(b.name,'ru'))
}
const capitalExecution=(r:WarehouseCapitalRow)=>[
  labelCharacteristic(r.material),labelCharacteristic(r.length),
  labelCharacteristic(r.gender),labelCategory(r.category),
].join(' · ')
/** Same order and concepts as the simplified capital page; all rows are retained. */
export async function buildWarehouseCapitalDocx(args:{
  capital:WarehouseCapitalSnapshot;choice:WarehouseFinanceChoice;generatedAt?:string
}):Promise<Blob>{
  const {capital,choice}=args
  if(!capital.ok||!Array.isArray(capital.rows))throw Error('Нет полного снимка остатков')
  const rows=capital.rows.filter(r=>(choice.source==='all'||r.source===choice.source)&&
    (choice.category==='all'||r.category===choice.category))
  const totals=capitalTotal(rows)
  const models=capitalRank(rows)
  const when=args.generatedAt||new Date().toISOString()
  const lines:Line[]=[
    ...banner('Склад · Финансы','Стоимость товарных запасов',
      'Сколько товаров находится в наличии и какова их стоимость.',when,[
        ['Данные на',dateTimeRu(capital.capturedAt)],
        ['Источник',labelSourceFilter(choice.source)],
        ['Категория',labelCategory(choice.category)],
      ]),
    ...sectionBanner('Главное о запасах','Всего, свободно и в резерве.'),
    metricGrid([
      {label:'Товаров в наличии',value:integerRu(totals.quantity)+' шт.',
        details:'Свободно '+integerRu(totals.free)+' · в резерве '+
          integerRu(totals.reserved),fill:palette.pale},
      {label:'Себестоимость · известная часть',
        value:totals.costQty?moneyRu(totals.cost):'Не оценена',
        details:'Свободно '+moneyRu(totals.freeCost)+' · резерв '+
          moneyRu(totals.reservedCost),fill:palette.paleGreen},
      {label:'Продажная стоимость · известная часть',
        value:totals.saleQty?moneyRu(totals.sale):'Не оценена',
        details:'Свободно '+moneyRu(totals.freeSale)+' · резерв '+
          moneyRu(totals.reservedSale),fill:palette.paleBlue},
    ],3),
    heading('Насколько известны цены'),
    table(['Показатель','Есть цена','Всего','Доля'],[
      ['Себестоимость',integerRu(totals.costQty),integerRu(totals.quantity),
        percentRu(totals.costQty,totals.quantity)],
      ['Цена продажи',integerRu(totals.saleQty),integerRu(totals.quantity),
        percentRu(totals.saleQty,totals.quantity)],
    ],[35,22,21,22]),
  ]
  if(choice.source==='all'){
    const places=[['Склад','warehouse'],['Бутик','boutique']] as const
    lines.push(heading('Где находится товар'))
    lines.push(table(['Место','Количество','Доля'],places.map(([name,source])=>{
      const n=rows.filter(r=>r.source===source).reduce((x,r)=>x+r.quantity,0)
      return [name,integerRu(n)+' шт.',percentRu(n,totals.quantity)]
    }),[48,26,26]))
  }
  lines.push(heading('Стоимость по моделям'))
  if(models.length){
    const max=Math.max(1,...models.map(m=>m.totals.cost))
    const rankedRows=models.map((m,i)=>new TableRow({cantSplit:true,children:[
      cell(String(i+1),i%2?palette.white:palette.pale,true,palette.blue,10),
      inkCell([
        paragraph(m.name,{bold:true,size:18,after:60}),
        new Paragraph({children:progress(m.totals.cost,max),
          spacing:{after:0}}),
      ],i%2?palette.white:palette.pale,{width:53}),
      inkCell([
        paragraph(m.totals.costQty?moneyRu(m.totals.cost):'Не оценено',
          {bold:true,size:18,after:45}),
        paragraph(integerRu(m.totals.quantity)+' шт. · по цене продажи '+
          (m.totals.saleQty?moneyRu(m.totals.sale):'не оценено'),
          {color:palette.muted,size:15,after:0}),
      ],i%2?palette.white:palette.pale,{width:37}),
    ]}))
    lines.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:rankedRows}))
  }
  lines.push(...sectionBanner('Подробности по моделям',
    'Все исполнения, цвета и размеры с фактическими остатками и ценами.'))
  for(const model of models){
    lines.push(modelHeading(model.name))
    lines.push(paragraph(integerRu(model.totals.quantity)+' шт. · свободно '+
      integerRu(model.totals.free)+' · резерв '+integerRu(model.totals.reserved)+
      ' · себестоимость '+(model.totals.costQty?moneyRu(model.totals.cost):'неизвестна')+
      ' · цена продажи '+(model.totals.saleQty?moneyRu(model.totals.sale):'неизвестна'),
    {size:18,color:palette.muted,after:110}))
    const executions=groupBy(model.items,capitalExecution)
    for(const [name,items] of executions){
      const sum=capitalTotal(items)
      lines.push(executionHeading(name))
      lines.push(paragraph(integerRu(sum.quantity)+' шт. · себестоимость '+
        (sum.costQty?moneyRu(sum.cost):'неизвестна')+
        ' · продажная стоимость '+(sum.saleQty?moneyRu(sum.sale):'неизвестна'),
        {color:palette.muted,size:17,after:85}))
      lines.push(capitalVariantTable([...items].sort((a,b)=>
        a.color.localeCompare(b.color,'ru')||a.size.localeCompare(b.size,'ru'))))
    }
  }
  if(!models.length)lines.push(paragraph('Положительных остатков по выбранной категории нет.'))
  return Packer.toBlob(document(lines,'Стоимость запасов'))
}
