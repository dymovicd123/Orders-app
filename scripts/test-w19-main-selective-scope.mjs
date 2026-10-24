import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const baseline='c34998de90a1112db7cb58cfb4babc41365db000'
const old=(path)=>execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'})
const now=(path)=>fs.readFileSync(path,'utf8')
const oldApp=old('src/App.tsx')
const newApp=now('src/App.tsx')
const noteGuard=/      if \(\(inventoryDraft\.movementType === 'writeoff' \|\| inventoryDraft\.movementType === 'manual_set'\) && !inventoryDraft\.comment\.trim\(\)\) \{\n        throw new Error\(inventoryDraft\.movementType === 'writeoff' \? 'Укажите причину списания\.' : 'Укажите причину корректировки\.'\)\n      \}\n/
assert.equal((oldApp.match(noteGuard)||[]).length,1,'Baseline must include one old mandatory-note guard')
assert.equal(newApp,oldApp.replace(noteGuard,''),'App changes must ONLY remove mandatory comment guard: orders/shipping/history unchanged')
const oldSection=old('src/features/sections/InventorySection.tsx')
const newSection=now('src/features/sections/InventorySection.tsx')
const block=(s,begin,end)=>{const a=s.indexOf(begin);const b=s.indexOf(end,a+begin.length);assert(a>=0&&b>a,begin+' missing');return s.slice(a,b)}
for(const [start,end] of [
  ['{renderInventoryAttentionPanel({','{renderInventoryOverviewPanel({'],
  ['{renderInventoryHistoryPanel({','</section>'],
]){
  assert.equal(block(newSection,start,end),block(oldSection,start,end),
    'Warehouse issue or history sections must not be ported')
}
for(const path of [
 'worker/index.ts',
 'worker/domains/inventory-movement.ts',
 'worker/domains/inventory-stocktake.ts',
 'src/features/inventory/views/renderInventoryAttentionPanel.tsx',
 'src/features/inventory/views/renderInventoryHistoryPanel.tsx',
 'src/features/inventory/views/renderInventoryStocktakePanel.tsx',
 'src/features/sections/OrdersHeaderSection.tsx',
 'src/features/inventory/views/renderInventoryMovementPanel.tsx',
]){
  assert.equal(now(path),old(path),'Protected source changed: '+path)
}
const overview=now('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const section=newSection
const workspace=now('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx')
assert.match(overview,/stock-v13-browse/)
assert.match(overview,/stock-v14-master-controls/)
assert.match(overview,/stock-v16-source-control/)
assert.match(overview,/<StockBrowseDetail/)
assert.match(section,/selectStockOverviewModels/)
assert.match(section,/loadOperationStockSources/)
assert.match(section,/loadInventoryData\(source, true, '', false\)/)
assert.match(section,/simpleStockSourceRefresh\.status === 'ready'/)
assert.match(workspace,/const ready = changed > 0/)
assert.doesNotMatch(workspace,/focusVariant|findCorrectionFocusGroup/,'Issue-to-correction integration remains branch2 only')
assert.doesNotMatch(workspace,/Укажите причину операции\./)
assert.match(overview,/input type="text" value=\{simpleStockSearch\}/)
console.log('W19 SCOPE PASSED: main orders, shipping, stock issues, history and check flows byte-for-byte untouched')
