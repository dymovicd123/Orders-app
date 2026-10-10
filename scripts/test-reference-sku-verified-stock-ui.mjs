import assert from 'node:assert/strict'
import fs from 'node:fs'
import {confirmedSkuStockDecisions} from '../src/features/sections/verifiedSkuStockDecision.ts'

const place=(location,sourcePhysical,keeperPhysical,reserved=0)=>({
 location,sourcePhysical,keeperPhysical,sourceReserved:reserved,keeperReserved:0,
 combinedPhysical:sourcePhysical+keeperPhysical,reservedTotal:reserved,
 requiresDecision:sourcePhysical>0,needsInvestigation:sourcePhysical>0&&keeperPhysical>0,
})
const preview=(warehouse,boutique,additional={})=>({
 canConsolidate:false,canConsolidateAfterVerifiedSum:true,blockers:[],
 stockReconciliation:{locations:[warehouse,boutique]},...additional,
})
const p=preview(place('warehouse',4,3,1),place('boutique',2,0,0))
assert.equal(confirmedSkuStockDecisions(p,{}),null,'No default verification is allowed')
assert.equal(confirmedSkuStockDecisions(p,{warehouse:true}),null,'Warehouse consent cannot cover boutique')
assert.equal(confirmedSkuStockDecisions(p,{boutique:true}),null,'Boutique consent cannot cover warehouse')
assert.equal(confirmedSkuStockDecisions(p,{warehouse:true,boutique:false}),null)
assert.deepEqual(confirmedSkuStockDecisions(p,{warehouse:true,boutique:true}),[
 {location:'warehouse',method:'sum',physicallyVerified:true},
 {location:'boutique',method:'sum',physicallyVerified:true},
])
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',4,3),place('boutique',2,0),
 {canConsolidateAfterVerifiedSum:false}),{warehouse:true,boutique:true}),null)
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',4,3),place('boutique',2,0),
 {blockers:['Активная ревизия']}),{warehouse:true,boutique:true}),null)
const justWarehouse=preview(place('warehouse',1,4),place('boutique',0,8),{})
assert.deepEqual(confirmedSkuStockDecisions(justWarehouse,{warehouse:true}),[
 {location:'warehouse',method:'sum',physicallyVerified:true},
])
assert.equal(confirmedSkuStockDecisions(justWarehouse,{}),null)
assert.deepEqual(confirmedSkuStockDecisions(preview(place('warehouse',0,4),place('boutique',0,8),
 {canConsolidate:true}),{}),[], 'Zero-source quantities are still handled by existing guarded endpoint')
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',0,4),place('boutique',0,8)),{}),null,
 'Zero source but non-mergeable server preview cannot be enabled in UI')
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',1,4,6),place('boutique',0,8)),
 {warehouse:true}),null,'Reservations above combined physical cannot be accepted from UI')
const missing=preview(place('warehouse',2,3),place('warehouse',2,3))
assert.equal(confirmedSkuStockDecisions(missing,{warehouse:true}),null,'Duplicate places fail closed')
const malformed=preview({...place('warehouse',4,3),combinedPhysical:100},place('boutique',0,0))
assert.equal(confirmedSkuStockDecisions(malformed,{warehouse:true}),null,'Untrusted arithmetic fails closed')
assert.equal(confirmedSkuStockDecisions({...p,stockReconciliation:{locations:[p.stockReconciliation.locations[0]]}},
 {warehouse:true}),null,'Missing location fails closed')
const ui=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
const backend=fs.readFileSync('worker/domains/catalog-variant-consolidation.ts','utf8')
assert.match(ui,/confirmedSkuStockDecisions\(skuPreview,verifiedLocations\)/)
assert.match(ui,/setVerifiedLocations\(\{\}\)/)
assert.match(ui,/verifiedStockDecisions,/)
assert.match(ui,/onChange=\{event=>setVerifiedLocations/)
assert.match(ui,/Я сверил физически: это разные экземпляры, их можно сложить/)
assert.match(ui,/disabled=\{actionBusy \|\| confirmedSkuStockDecisions\(skuPreview,verifiedLocations\)===null\}/)
assert.match(backend,/decision\.physicallyVerified!==true/)
assert.match(backend,/requiredLocations\.size/)
assert.match(backend,/snapshotToken\(source,target,stocks,reservations,businessMonthRange\(\)\)!==preview\.stateToken/)
console.log('VERIFIED SKU UI PASSED — no defaults, each location verified, shortages/blocks fail closed, explicit sum only')
