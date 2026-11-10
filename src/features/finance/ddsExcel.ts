import { strToU8, zipSync } from 'fflate'
import { DDS_CATEGORIES } from '../../../shared/dds-categories'
import { ddsKindLabel, ddsSignedAmount, ddsMonthLabel, type DdsReport } from './ddsTypes'

// Minimal real OOXML workbook. Comments stay text (never formulas); amounts are Excel numbers.
type Cell={value:string|number;style?:number;date?:boolean}
type Sheet={name:string;rows:Array<Array<Cell|null>>;widths:number[];merges?:string[];freeze?:number;filter?:string}
const C=(value:string|number,style=0):Cell=>({value,style})
const M=(value:number,style=5)=>C(value,style)
const E=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
const H='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RN='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PN='http://schemas.openxmlformats.org/package/2006/relationships'
const letter=(i:number)=>{let text='';for(let n=i+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text}
const serial=(value:string)=>Math.round(Date.parse(value+'T00:00:00Z')/86400000)+25569

function sheetXml(s:Sheet){
  const rows=s.rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>{
    if(!v)return ''
    const att=' r="'+letter(j)+(i+1)+'" s="'+(v.style||0)+'"'
    if(v.date)return '<c'+att+'><v>'+serial(String(v.value))+'</v></c>'
    if(typeof v.value==='number'){
      if(!Number.isFinite(v.value))throw new Error('Неверная сумма в отчёте')
      return '<c'+att+'><v>'+v.value+'</v></c>'
    }
    return '<c'+att+' t="inlineStr"><is><t xml:space="preserve">'+E(v.value)+'</t></is></c>'
  }).join('')+'</row>').join('')
  const cols=s.widths.map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>').join('')
  const view=s.freeze?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="'+s.freeze+'" topLeftCell="A'+(s.freeze+1)+'" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>':'<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const merges=s.merges?.length?'<mergeCells count="'+s.merges.length+'">'+s.merges.map(x=>'<mergeCell ref="'+x+'"/>').join('')+'</mergeCells>':''
  const filter=s.filter?'<autoFilter ref="'+s.filter+'"/>':''
  return H+'<worksheet xmlns="'+NS+'"><dimension ref="A1:'+letter(s.widths.length-1)+s.rows.length+'"/>'+view+
    '<sheetFormatPr defaultRowHeight="19"/><cols>'+cols+'</cols><sheetData>'+rows+'</sheetData>'+filter+merges+
    '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.25" footer="0.25"/></worksheet>'
}

function stylesXml(){
  const fonts=[
    '<font><sz val="11"/><name val="Aptos"/></font>',
    '<font><b/><sz val="18"/><color rgb="FF244F65"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF203748"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF217651"/><name val="Aptos"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFC15C51"/><name val="Aptos"/></font>',
    '<font><sz val="10"/><color rgb="FF728196"/><name val="Aptos"/></font>',
  ]
  const fills=[
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF244F65"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F5F8"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF4EF"/></patternFill></fill>',
  ]
  // default,title,muted,header,label,money,positive,negative,tableHeader,date,group,plainMoney,percentage
  const xfs:Array<[number,number,number]>=[
    [0,0,0],[1,0,0],[6,0,0],[2,2,0],[3,3,0],[3,0,164],[4,4,164],
    [5,0,164],[3,3,0],[0,0,165],[3,3,0],[0,0,164],[0,0,10]
  ]
  return H+'<styleSheet xmlns="'+NS+'"><numFmts count="2">'+
    '<numFmt numFmtId="164" formatCode="'+E('#,##0 "₸";[Red](#,##0 "₸");0 "₸"')+'"/>'+
    '<numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>'+
    '<fonts count="'+fonts.length+'">'+fonts.join('')+'</fonts>'+
    '<fills count="'+fills.length+'">'+fills.join('')+'</fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="'+xfs.length+'">'+xfs.map(([f,l,n])=>'<xf numFmtId="'+n+'" fontId="'+f+'" fillId="'+l+
    '" borderId="0" xfId="0" applyNumberFormat="1"/>').join('')+'</cellXfs>'+
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
}

function makeSheets(data:DdsReport):Sheet[]{
  const month=ddsMonthLabel(data.month)
  const overview:Sheet['rows']=[
    [C('ДДС • '+month,1)],[C('Отчёт по выделенным средствам за месяц',2)],[],
    [C('На начало',4),M(data.openingBalance),C('Пополнено',4),M(data.monthAdded)],
    [C('Израсходовано',4),M(data.monthSpent,7),C('На конец',4),M(data.closingBalance,6)],
    [],[C('РАСХОДЫ ПО КАТЕГОРИЯМ',3)],[C('Категория',8),C('Сумма',8),C('Доля расходов',8)],
    ...data.categories.map(x=>[C(x.name),M(x.total,11),C(data.monthSpent>0?x.total/data.monthSpent:0,12)]),
    [],[C('ВСЕГО РАСХОДОВ',4),M(data.monthSpent),C(data.monthSpent>0?1:0,12)],
    [],[C('Остаток переносится между месяцами. Пополнений в течение месяца может быть несколько.',2)]
  ]
  const articles:Sheet['rows']=[
    [C('Статьи расходов • '+month,1)],[C('Утверждённый список и фактические суммы по каждой статье',2)],
    [],[C('Категория / статья',8),C('Сумма',8),C('Примечание',8)]
  ]
  DDS_CATEGORIES.forEach(group=>{
    const current=data.categories.find(x=>x.name===group.name)
    articles.push([C(group.name,10),M(current?.total||0),C('Категория',2)])
    group.articles.forEach(name=>{
      const value=current?.articles.find(x=>x.name===name)?.amount||0
      articles.push([C('    '+name),M(value,11),C(value!==0?'Были расходы':'',2)])
    })
    articles.push([])
  })
  articles.push([C('ИТОГО',4),M(data.monthSpent),C('С учётом отмен',2)])
  const operations:Sheet['rows']=[
    [C('История операций • '+month,1)],[C('Пополнения, расходы и исправления; суммы хранятся числом, даты — датой',2)],
    [],[C('Дата',8),C('Операция',8),C('Категория',8),C('Статья',8),C('Комментарий',8),C('Сумма',8),C('Статус',8),C('№',8)]
  ]
  for(const entry of [...data.entries].reverse()){
    const sum=ddsSignedAmount(entry)
    operations.push([{value:entry.businessDate,style:9,date:true},C(ddsKindLabel[entry.kind]),C(entry.category||''),
      C(entry.article||''),C(entry.comment||''),M(sum,sum>=0?6:7),C(entry.reversed?'Отменено':'Проведено'),C(entry.id)])
  }
  if(!data.entries.length)operations.push([C('За выбранный месяц операций нет',2)])
  return [
    {name:'Сводка',rows:overview,widths:[43,20,28,20],merges:['A1:D1','A2:D2','A7:D7','A'+overview.length+':D'+overview.length]},
    {name:'Статьи расходов',rows:articles,widths:[48,20,24],merges:['A1:C1','A2:C2'],freeze:4},
    {name:'Операции',rows:operations,widths:[16,24,29,33,52,20,17,10],
      merges:['A1:H1','A2:H2'],freeze:4,filter:'A4:H'+Math.max(4,operations.length)}
  ]
}
export function buildDdsXlsx(data:DdsReport):Uint8Array{
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(data.month))throw new Error('Некорректный месяц ДДС')
  if(data.entries.length>=2000)throw new Error('Журнал содержит 2000+ операций. Неполный отчёт скачивать нельзя.')
  const sheets=makeSheets(data)
  const contentTypes=[
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
  ]
  const book=H+'<workbook xmlns="'+NS+'" xmlns:r="'+RN+'"><sheets>'+
    sheets.map((s,i)=>'<sheet name="'+E(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+
    '</sheets></workbook>'
  const rels=H+'<Relationships xmlns="'+PN+'">'+sheets.map((_,i)=>
    '<Relationship Id="rId'+(i+1)+'" Type="'+RN+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
    '<Relationship Id="rId4" Type="'+RN+'/styles" Target="styles.xml"/></Relationships>'
  const files:Record<string,Uint8Array>={
    '[Content_Types].xml':strToU8(H+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+contentTypes.join('')+'</Types>'),
    '_rels/.rels':strToU8(H+'<Relationships xmlns="'+PN+'"><Relationship Id="rId1" Type="'+RN+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml':strToU8(book),
    'xl/_rels/workbook.xml.rels':strToU8(rels),
    'xl/styles.xml':strToU8(stylesXml())
  }
  sheets.forEach((s,i)=>{files['xl/worksheets/sheet'+(i+1)+'.xml']=strToU8(sheetXml(s))})
  return zipSync(files,{level:6})
}
