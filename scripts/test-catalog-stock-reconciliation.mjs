import assert from 'node:assert/strict'
import { buildStockReconciliationPlan } from '../worker/domains/catalog-stock-reconciliation.ts'

const inputs=[
 {location:'warehouse',sourcePhysical:8,targetPhysical:5,sourceReserved:2,targetReserved:1},
 {location:'boutique',sourcePhysical:0,targetPhysical:3,sourceReserved:0,targetReserved:1},
]
const checks=[
 {variantId:10,location:'warehouse',countedQuantity:8,checkedAt:'2026-10-05T09:00:00Z',checkType:'full_stocktake',checkedBy:'manager'},
 {variantId:11,location:'warehouse',countedQuantity:5,checkedAt:'2026-10-08T09:00:00Z',checkType:'quick_stocktake',checkedBy:'admin'},
]
const plan=buildStockReconciliationPlan(inputs,checks,10,11)
assert.equal(plan.requiresHumanStockDecision,true)
assert.equal(plan.canRunLegacyAdditiveMerge,false)
assert.equal(plan.requiresSeparateAuditedStockAdjustment,true)
assert.equal(plan.locations.length,2)
const warehouse=plan.locations[0],boutique=plan.locations[1]
assert.equal(warehouse.combinedPhysical,13)
assert.equal(warehouse.reservedTotal,3)
assert.equal(warehouse.lastSourceCount?.checkedBy,'manager')
assert.equal(warehouse.lastKeeperCount?.checkedAt,'2026-10-08T09:00:00Z')
assert.equal(warehouse.needsInvestigation,true)
assert.deepEqual(warehouse.scenarios.map(x=>x.method),
 ['sum','keep_source','keep_keeper','physical_count','defer'])
assert.deepEqual(warehouse.scenarios.map(x=>x.resultingPhysical),[13,8,5,null,null])
assert.deepEqual(warehouse.scenarios.map(x=>x.changeFromSum),[0,-5,-8,null,null])
assert.ok(warehouse.scenarios.every(x=>x.isExecutableNow===false))
assert.equal(boutique.requiresDecision,false,'No source units to add at boutique')
assert.equal(boutique.lastSourceCount,null,'Do not invent a physical count')
assert.equal(boutique.scenarios[2].resultingPhysical,3)
const shortage=buildStockReconciliationPlan([
 {location:'warehouse',sourcePhysical:2,targetPhysical:3,sourceReserved:4,targetReserved:2},
 {location:'boutique',sourcePhysical:0,targetPhysical:0,sourceReserved:0,targetReserved:0},
],[],10,11)
assert.equal(shortage.locations[0].reservedTotal,6)
assert.equal(shortage.locations[0].scenarios[0].reservedShortage,1)
assert.equal(shortage.locations[0].scenarios[2].reservedShortage,3,
 'Never erase a customer reservation when keeping the second quantity')
const untouched=buildStockReconciliationPlan([
 {location:'warehouse',sourcePhysical:0,targetPhysical:12,sourceReserved:0,targetReserved:0},
 {location:'boutique',sourcePhysical:0,targetPhysical:0,sourceReserved:0,targetReserved:0},
],[],10,11)
assert.equal(untouched.canRunLegacyAdditiveMerge,true,
 'A zero-source transfer does not add any physical stock')
for(const malformed of [
 [{location:'warehouse',sourcePhysical:-1,targetPhysical:0,sourceReserved:0,targetReserved:0},
  {location:'boutique',sourcePhysical:0,targetPhysical:0,sourceReserved:0,targetReserved:0}],
 [inputs[0],inputs[0]],
 [inputs[0]],
])assert.throws(()=>buildStockReconciliationPlan(malformed,[],10,11),/Некорректные/)
assert.throws(()=>buildStockReconciliationPlan([
 {...inputs[0],sourcePhysical:Number.MAX_SAFE_INTEGER}, inputs[1]],[],10,11),
 /безопасный диапазон/)
assert.deepEqual(inputs[0],{location:'warehouse',sourcePhysical:8,targetPhysical:5,sourceReserved:2,targetReserved:1},
 'Preview must not mutate stock input')
console.log('CATALOG STOCK RECONCILIATION PASSED — 5 distinct human decisions, both locations, reserve shortage, evidence, no automatic selection')
