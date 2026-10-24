import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadOperationStockSources } from '../src/features/inventory/loadOperationStockSources.ts'

const attempts=[]
const result=await loadOperationStockSources(
  ['warehouse','boutique','warehouse'],
  async source => {
    attempts.push(source)
    if(source==='boutique' && attempts.filter(x=>x==='boutique').length===1)return null
    return {ok:true}
  },
  ()=>true,
  async ()=>{},
)
assert.equal(result.status,'ready')
assert.deepEqual(attempts,['warehouse','boutique','boutique'],
  'A retry should only reload failed locations, not discard successful source reads')
let failedCalls=0
const failures=await loadOperationStockSources(
  ['warehouse'],async()=>{failedCalls++;throw Error('Network unavailable')},
  ()=>true,async()=>{},
)
assert.equal(failures.status,'error','Never treat a rejected/incomplete snapshot as loaded')
assert.deepEqual(failures.failedSources,['warehouse'])
assert.equal(failedCalls,2,'Retries must be bounded')
assert.deepEqual(await loadOperationStockSources(
  ['boutique'],async()=>({ok:false}),()=>true,async()=>{},
),{status:'error',failedSources:['boutique']})
let current=true, attemptsAfterSwitch=0
const cancelled=await loadOperationStockSources(
  ['warehouse'],async()=>{attemptsAfterSwitch++;current=false;return null},
  ()=>current,async()=>{},
)
assert.equal(cancelled.status,'cancelled')
assert.equal(attemptsAfterSwitch,1,'Superseded source must not continue retries')
let delays=0
await loadOperationStockSources(['warehouse'],async()=>null,()=>true,async delay=>{
  assert.equal(delay,350);delays++
})
assert.equal(delays,1)

const css=readFileSync('src/styles/w14-simple-stock-controls.css','utf8')
const overview=readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx','utf8')
const stocktake=readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx','utf8')
const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const unified=readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
assert.match(css,/grid-auto-rows: max-content/, 'Large lists must preserve intrinsic row heights')
assert.match(css,/overflow-y: auto/, 'Long model lists must stay scrollable')
assert.match(css,/stock-v13-master-item\s*\{[\s\S]*?min-height: max-content/,
 'Buttons cannot shrink below model names')
assert.match(css,/overflow-wrap: anywhere/, 'Long names must wrap rather than overlap')
assert.doesNotMatch(overview,/renderRoutineCycleCountCue|inventory-stock-routine-disclosure/,
 'Remove passive mini-recount from stock overview')
assert.doesNotMatch(stocktake,/stocktake-selective-recommendations|Рекомендуем проверить/,
 'Manual selection must not be pushed under automatic suggestions')
assert.match(stocktake,/stocktakeStartMode === 'selective'/)
assert.match(stocktake,/stocktakeStartMode === 'full'/)
assert.doesNotMatch(section,/inventoryPanel === 'overview' && cycleCountData/,
 'Entering stock overview cannot start/passively revive recount')
assert.match(section,/loadOperationStockSources\(/)
assert.match(section,/requestId === movementSourceRequestRef\.current/)
assert.match(section,/loadInventoryData\(source, true, '', false\)/,
 'Operation retry cannot use stale, partial source data')
assert.match(unified,/onClick=\{p\.onRefresh\}/,
 'Manual refresh remains available after bounded retry failure')
console.log('W15 PASSED: no overlapping rows, no passive recount, bounded source-specific retry, no stale success')
