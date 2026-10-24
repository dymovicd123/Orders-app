import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildStockVariantTimeline, stockCheckHasDifference } from '../src/features/inventory/stockVariantTimelineModel.ts'

const movement = (id, source, variantId, moment, quantityDelta, quantityAfter) => ({
  id, inventorySource:source, variantId, createdAt:moment, quantityDelta, quantityAfter,
  movementType:'arrival', referenceId:String(id), comment:'',
})
const check = (id, source, moment, expectedQuantity, countedQuantity) => ({
  id:String(id), source, checkedAt:moment, expectedQuantity, countedQuantity, kind:'check',
})
const moves = [
  movement(6,'warehouse',55,'2026-10-21T11:00:00Z',-2,8),
  movement(2,'warehouse',55,'2026-10-19T12:00:00Z',4,10),
  movement(3,'boutique',55,'2026-10-18T09:00:00Z',8,8),
  movement(4,'warehouse',56,'2026-10-20T08:00:00Z',100,100),
]
const checks = [
  check(10,'warehouse','2026-10-20T11:00:00Z',10,8),
  check(11,'boutique','2026-10-17T11:00:00Z',4,1),
  check(12,'warehouse','2026-10-18T11:00:00Z',6,6),
  check(13,'warehouse','2026-10-22T11:00:00Z',8,7),
]
const result=buildStockVariantTimeline(moves,checks,'warehouse',55)
assert.deepEqual(result.events.map(event=>event.key),['c-12','m-2','c-10','m-6','c-13'],
 'Timeline must sort exact SKU events ascending without other sources or variants')
assert.equal(result.firstObservedDifference.id,'10',
 'The earliest loaded discrepancy, not the latest mismatch, must be highlighted')
assert.equal(stockCheckHasDifference(checks[2]),false)
assert.equal(stockCheckHasDifference(checks[0]),true)
assert.equal(stockCheckHasDifference({...checks[0],countedQuantity:undefined}),false)
assert.equal(buildStockVariantTimeline(moves,checks,'boutique',55).events.length,2,
 'Boutique and warehouse movements are independent')
assert.equal(buildStockVariantTimeline([],[], 'warehouse', 55).firstObservedDifference,null)
assert.equal(result.events.find(event=>event.key==='m-6').movement.quantityAfter
 - result.events.find(event=>event.key==='m-6').movement.quantityDelta,10,
 'Movement before-quantity must reconstruct from committed after and delta')

const read = file => fs.readFileSync(file,'utf8')
const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const inventory = read('src/features/sections/InventorySection.tsx')
const history = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
const timeline = read('src/features/inventory/views/StockVariantTimeline.tsx')
const issues = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const header = read('src/features/sections/OrdersHeaderSection.tsx')
const ops = read('src/styles/193-unified-inventory-operations.css')

assert.match(overview,/inventory-stock-flat-table/, 'SKU rows must be a flat table')
assert.match(overview,/simpleStockPhysical\(row\)/)
assert.match(overview,/simpleStockReserved\(row\)/)
assert.match(overview,/simpleStockQuantity\(row\)/)
assert.doesNotMatch(overview,/buildStockBrowseHierarchy/, 'Old multi-level stock accordion must not reappear')
assert.match(overview,/setSimpleStockSource\(simpleStockSource\)/, 'Selected source can be manually refreshed')
assert.match(inventory,/loadInventoryData\(source, true, '', false\)/)
assert.match(history,/<StockVariantTimeline/)
assert.match(timeline,/buildStockVariantTimeline/)
assert.match(issues,/openAttentionHistory\(item\)/)
assert.match(header,/shortageCount/);assert.match(header,/shippedCount/)
for (const mode of ['arrival','writeoff','manual_set','transfer'])
  assert.match(ops,new RegExp('data-unified-operation="'+mode+'"'),
    'Every operation needs a semantic accent')
console.log('W12 STOCK CLARITY PASSED — exact identity, chronological checks/movements, discrepancy, source isolation, flat UI and issue links')
