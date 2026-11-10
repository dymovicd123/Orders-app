import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { DDS_CATEGORIES } from '../shared/dds-categories.ts'
import { buildDdsXlsx } from '../src/features/finance/ddsExcel.ts'

const report={
  ok:true,month:'2026-11',currentBalance:91000,openingBalance:0,monthAdded:100000,
  monthSpent:9000,closingBalance:91000,
  categories:DDS_CATEGORIES.map(group=>({
    name:group.name,total:group.name==='Упаковка'?9000:0,
    articles:group.name==='Упаковка'?[{name:'Коробки',amount:9000}]:[],
  })),
  entries:[
    {id:1,kind:'funding',businessDate:'2026-11-01',amount:100000,category:'',article:'',
      comment:'Начальное пополнение',createdAt:'2026-11-01T08:00:00Z',reversesEntryId:null,reversed:0},
    {id:2,kind:'expense',businessDate:'2026-11-10',amount:9000,category:'Упаковка',article:'Коробки',
      comment:'=HYPERLINK("fake") <опасно> & тест',createdAt:'2026-11-10T12:00:00Z',reversesEntryId:null,reversed:0},
  ],
}
const bytes=buildDdsXlsx(report)
assert.equal(bytes[0],0x50)
assert.equal(bytes[1],0x4b)
const files=unzipSync(bytes)
const required=['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/styles.xml',
  'xl/_rels/workbook.xml.rels','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml']
for(const path of required)assert.ok(files[path],'Missing Excel package part '+path)
const read=path=>strFromU8(files[path])
const names=read('xl/workbook.xml')
assert.match(names,/sheet name="Сводка"/)
assert.match(names,/sheet name="Статьи расходов"/)
assert.match(names,/sheet name="Операции"/)
const overview=read('xl/worksheets/sheet1.xml')
assert.match(overview,/СВОДКА|ДДС • ноябрь 2026 г\./i)
assert.match(overview,/91(?:000)?/)
assert.ok(overview.includes('<v>91000</v>'),'Closing balance must be a number, not formatted text')
const articles=read('xl/worksheets/sheet2.xml')
assert.ok(articles.includes('Доставка клиенту')&&articles.includes('Закуп товара')&&articles.includes('Коробки'))
assert.ok(articles.includes('<v>9000</v>'))
const ops=read('xl/worksheets/sheet3.xml')
assert.ok(ops.includes('autoFilter ref="A4:H6"'))
assert.ok(ops.includes('pane ySplit="4"'))
assert.ok(ops.includes('<v>-9000</v>'),'Expense is a signed Excel number')
assert.ok(ops.includes('&lt;опасно&gt; &amp; тест'),'Comments are XML-escaped')
assert.ok(ops.includes('t="inlineStr"'),'Comments must be inline text, never interpreted as Excel formulas')
assert.ok(!ops.includes('<f>'),'No executable formulas from user comments')
assert.ok(!ops.includes('<v>=HYPERLINK'),'No formula injection')
assert.ok(read('xl/styles.xml').includes('numFmtId="164"'))
assert.throws(()=>buildDdsXlsx({...report,entries:Array(2000).fill(report.entries[0])}),/Неполный|2000/)
const ui=readFileSync('src/features/finance/DdsWorkspace.tsx','utf8')
assert.ok(ui.includes("view==='expenses'")&&ui.includes("view==='report'"))
assert.ok(ui.includes("isAdmin&&fundingOpen&&<DdsDialog"),'Admin funding must be a separate dialog')
assert.ok(ui.includes('Скачать Excel (.xlsx)')&&!ui.includes('Скачать для Excel (CSV)'))
assert.ok(ui.includes("await import('./ddsExcel')"),'Spreadsheet writer must load only when exporting')
console.log('DDS_UX_XLSX_PASS: 3 real workbook sheets, Russian labels, dates, numbers, styles, sanitized comments, on-demand export, admin funding dialog')
