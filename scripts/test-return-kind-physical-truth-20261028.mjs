import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'

const utilsSource=readFileSync('src/app/utils.ts','utf8')
const compiled=ts.transpileModule(utilsSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const utils=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const draft=utils.createReturnDraft({
  shipping_status:'sent',
  items:[
    {id:11,productName:'Складской товар',quantity:3,availableOperationQuantity:2,stockWriteoffStatus:'fulfilled',sourceType:'warehouse'},
    {id:12,productName:'Не выдан',quantity:2,availableOperationQuantity:2,stockWriteoffStatus:'reserved',sourceType:'boutique'},
    {id:13,productName:'Цех',quantity:1,availableOperationQuantity:1,stockWriteoffStatus:'workshop',isWorkshop:true,sourceType:'workshop'},
  ]
})
assert.equal(draft.amount,0)
assert.equal(draft.items.find(i=>i.orderItemId===11).quantity,2)
assert.equal(draft.items.find(i=>i.orderItemId===12).quantity,0)
assert.equal(draft.items.find(i=>i.orderItemId===13).quantity,1)
assert(draft.items.every(i=>i.physicalState==='pending'&&i.restock===false))
assert(draft.items.every(i=>i.quantity<=i.maxQuantity))
const noIssued=utils.createReturnDraft({shipping_status:'not_sent',items:[
  {id:20,productName:'Reserved',quantity:1,stockWriteoffStatus:'reserved',sourceType:'warehouse'}
]})
assert.equal(noIssued.items[0].quantity,0,'Never imply a physical return for an unissued item')
const notShippedButIssued=utils.createReturnDraft({shipping_status:'not_sent',items:[
  {id:21,productName:'Выданное отдельной позицией',quantity:2,availableOperationQuantity:2,stockWriteoffStatus:'fulfilled',sourceType:'warehouse'},
  {id:22,productName:'Цех без отправки',quantity:1,availableOperationQuantity:1,stockWriteoffStatus:'fulfilled',sourceType:'workshop'}
]})
assert(notShippedButIssued.items.every(i=>i.quantity===0),'No automatic item selection on an unshipped order')
assert(notShippedButIssued.items.every(i=>i.physicalState==='pending'&&i.restock===false))
const sentAndExhausted=utils.createReturnDraft({shipping_status:'sent',items:[
  {id:23,productName:'Уже вернули всё',quantity:2,availableOperationQuantity:0,stockWriteoffStatus:'fulfilled',sourceType:'warehouse'}
]})
assert.equal(sentAndExhausted.items.length,0,'Never preselect an already returned sold quantity')
assert(draft.items.every(i=>i.quantity===0||i.issuedToClient),'Only issued lines can be preselected')
const db=new DatabaseSync(':memory:')
db.exec([
 'CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER, amount INTEGER, status TEXT);',
 'CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,quantity INTEGER,physical_tracking INTEGER,physical_received_at TEXT,inventory_source TEXT);',
 'CREATE TABLE exchanges(id INTEGER PRIMARY KEY,refund_return_id INTEGER,status TEXT);',
 "INSERT INTO returns VALUES (1,101,100,'completed'),(2,102,0,'completed'),(3,103,500,'completed'),(4,104,300,'completed'),(5,105,400,'completed'),(6,106,100,'cancelled'),(7,107,700,'completed'),(8,108,100,'completed');",
 "INSERT INTO return_items VALUES (20,2,2,1,NULL,NULL),(30,3,2,1,'2026-10-10T12:00:00Z','warehouse'),(40,4,1,1,'2026-10-11T12:00:00Z',NULL),(50,5,1,0,NULL,'warehouse'),(60,6,1,1,NULL,NULL),(70,7,1,1,NULL,NULL),(80,8,1,1,NULL,NULL);",
 "INSERT INTO exchanges VALUES (1,7,'completed');",
].join('\n'))
const source=readFileSync('worker/domains/orders-relations.ts','utf8')
const marker='WITH per_return AS ('
const start=source.indexOf(marker)
assert(start>=0)
const finish=source.indexOf('FROM per_return GROUP BY order_id',start)
assert(finish>start)
const raw=source.slice(start,finish+'FROM per_return GROUP BY order_id'.length)
const sql=raw.replaceAll('${placeholders}',Array(8).fill('?').join(','))
const result=db.prepare(sql).all(...[101,102,103,104,105,106,107,108])
const get=id=>result.find(x=>x.order_id===id)
assert.equal(get(101).money_only_count,1,'Money without goods stays money-only')
assert.equal(get(101).pending_quantity,0)
assert.equal(get(102).goods_only_count,1,'Zero-money goods remain legal')
assert.equal(get(102).pending_quantity,2)
assert.equal(get(103).money_and_goods_count,1)
assert.equal(get(103).received_stock_quantity,2)
assert.equal(get(104).received_no_stock_quantity,1)
assert.equal(get(105).legacy_unknown_quantity,1,'Unknown legacy receipt is not confirmed stock')
assert(!get(106),'Cancelled returns excluded')
assert(!get(107),'Exchange-owned refund excluded from standalone returns')
assert.equal(get(108).pending_quantity,1)
assert(/Возврат только денег/.test(readFileSync('src/features/sections/OrderReturnsSection.tsx','utf8')))
assert(/window\.confirm\(/.test(readFileSync('src/App.tsx','utf8')))
assert(/Физический возврат вещей не зафиксирован/.test(readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')))
db.close()
console.log('PASS return truth: preselect issued on sent orders only, no auto receipt, 3 kinds, physical groups, excluded cancelled/exchange, confirmation')
