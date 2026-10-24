import assert from 'node:assert/strict'
import fs from 'node:fs'
import { selectStockOverviewModels } from '../src/features/inventory/stockOverviewSelectors.ts'
import { buildStockBrowseLayout, stockRowHasBalance } from '../src/features/inventory/stockBrowseLayout.ts'
import { loadOperationStockSources } from '../src/features/inventory/loadOperationStockSources.ts'
const read=p=>fs.readFileSync(p,'utf8')
const rows=[{variantId:51,material:'ЗАМША',gender:'МУЖ',color:'БЕЛЫЙ',size:'55',physical:2,reserved:3},
{variantId:52,material:'ЗАМША',gender:'МУЖ',color:'БЕЛЫЙ',size:'56',physical:0,reserved:0}]
const groups=[{key:'1',productName:'БЕЛЫЙ ШАПАН',rows}]
assert.equal(buildStockBrowseLayout(rows)[0].colors[0].rows.length,2)
assert.ok(stockRowHasBalance(0,3,-3),'Reserved shortage must remain visible')
assert.equal(selectStockOverviewModels(groups,'шапан','withStock',r=>r.physical!==0||r.reserved!==0)[0].rows.length,2,
'Searching the model cannot truncate sizes, reserved or zero')
assert.equal(selectStockOverviewModels(groups,'56','all',()=>true).length,0,'Search models only')
let attempts=[]
const loaded=await loadOperationStockSources(['warehouse','boutique'],async source=>{
 attempts.push(source)
 return source==='boutique' && attempts.filter(x=>x==='boutique').length===1 ? null : {ok:true}
},()=>true,async()=>{})
assert.equal(loaded.status,'ready')
assert.deepEqual(attempts,['warehouse','boutique','boutique'])
let calls=0
const rejected=await loadOperationStockSources(['warehouse'],async()=>{calls++;throw Error('offline')},()=>true,async()=>{})
assert.equal(rejected.status,'error')
assert.equal(calls,2)
const overview=read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const section=read('src/features/sections/InventorySection.tsx')
const ui=read('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx')
const app=read('src/App.tsx')
assert.match(overview,/stock-v13-master-list/)
assert.match(overview,/stock-v14-master-controls/)
assert.match(overview,/stock-v16-source-switch/)
assert.match(overview,/placeholder="Найти модель…"/)
assert.match(overview,/<StockBrowseDetail/)
assert.doesNotMatch(overview,/inventory-stock-flat-table|renderRoutineCycleCountCue/)
assert.match(section,/inventoryStocktakeAllGroups \|\| \[\]/)
assert.match(section,/selectStockOverviewModels\(/)
assert.match(section,/loadOperationStockSources\(/)
assert.match(section,/simpleStockSourceRefresh.status === 'ready'/)
assert.match(section,/loadInventoryData\(source, true, '', false\)/)
assert.match(ui,/const ready = changed > 0/)
assert.equal((ui.match(/Комментарий \(необязательно\)/g)||[]).length,2)
assert.doesNotMatch(ui,/Укажите причину операции\./)
assert.doesNotMatch(app,/Укажите причину списания\./)
assert.ok(app.includes('comment: inventoryDraft.comment'))
assert.ok(!overview.includes('saveInventoryMovement('))
console.log('MAIN STOCK AND OPERATIONS PASSED: exact SKU cards, full totals, safe retry, optional notes, no stock writes in overview')
