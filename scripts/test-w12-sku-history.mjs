import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildStockVariantTimeline, stockCheckHasDifference } from '../src/features/inventory/stockVariantTimelineModel.ts'
const movement=(id,inventorySource,variantId,createdAt,quantityDelta,quantityAfter)=>({id,inventorySource,variantId,createdAt,quantityDelta,quantityAfter,movementType:'arrival'})
const check=(id,source,checkedAt,expectedQuantity,countedQuantity)=>({id:String(id),source,checkedAt,expectedQuantity,countedQuantity,kind:'check'})
const res=buildStockVariantTimeline([
  movement(1,'warehouse',55,'2026-10-20T00:00:00Z',2,10),
  movement(3,'warehouse',55,'2026-10-22T00:00:00Z',-1,9),
  movement(4,'boutique',55,'2026-10-21T00:00:00Z',3,3),
  movement(5,'warehouse',56,'2026-10-21T00:00:00Z',1,8),
],[
  check(7,'warehouse','2026-10-21T00:00:00Z',10,8),
  check(8,'warehouse','2026-10-19T00:00:00Z',8,8),
  check(9,'boutique','2026-10-18T00:00:00Z',5,4),
  check(10,'warehouse','2026-10-23T00:00:00Z',9,8),
],'warehouse',55)
assert.deepEqual(res.events.map(x=>x.key),['c-8','m-1','c-7','m-3','c-10'])
assert.equal(res.firstObservedDifference.id,'7')
assert.equal(stockCheckHasDifference(check(8,'warehouse','',8,8)),false)
assert.equal(stockCheckHasDifference(check(8,'warehouse','',8,undefined)),false)
assert.equal(buildStockVariantTimeline([],[],'warehouse',55).firstObservedDifference,null)
const view=fs.readFileSync('src/features/inventory/views/renderInventoryHistoryPanel.tsx','utf8')
const timeline=fs.readFileSync('src/features/inventory/views/StockVariantTimeline.tsx','utf8')
const section=fs.readFileSync('src/features/sections/InventorySection.tsx','utf8')
assert.match(view,/<StockVariantTimeline/)
assert.match(timeline,/firstObservedDifference/)
assert.match(timeline,/за всю доступную историю проверок/)
assert.match(timeline,/Показать более ранние сверки/)
assert.match(timeline,/Загрузить более ранние события/)
assert.match(timeline,/checksUnavailable/)
assert.match(section,/setHistoryCheckRows\(\[\]\)/)
assert.match(section,/loadInventoryCheckHistory\(\{/)
assert.match(section,/setHistoryChecksUnavailable\(true\)/)
assert.match(section,/requestId !== historyRequestRef.current/)
assert.match(section,/openAttentionHistory: \(item: any\)/, 'Attention list must retain direct exact variant history navigation')
console.log('W12.3 HISTORY PASSED: exact source+variant, sort, earliest observed mismatch, paging, independent check errors')
