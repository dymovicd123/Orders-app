import assert from 'node:assert/strict'
import fs from 'node:fs'
import {confirmedSkuStockDecisions} from '../src/features/sections/verifiedSkuStockDecision.ts'

const place=(location,sourcePhysical,keeperPhysical,reserved=0)=>({
 location,sourcePhysical,keeperPhysical,sourceReserved:reserved,keeperReserved:0,
 combinedPhysical:sourcePhysical+keeperPhysical,reservedTotal:reserved,
 requiresDecision:sourcePhysical>0,needsInvestigation:sourcePhysical>0&&keeperPhysical>0,
})
const preview=(warehouse,boutique,extra={})=>({
 canConsolidate:false,canConsolidateAfterVerifiedSum:true,blockers:[],
 stockReconciliation:{locations:[warehouse,boutique]},...extra,
})
const choice=(method,extra={})=>({method,verified:true,reason:'Физический товар сверили вручную',...extra})
const p=preview(place('warehouse',4,3,1),place('boutique',2,0))
assert.equal(confirmedSkuStockDecisions(p,{}),null,'No decision is preselected')
assert.equal(confirmedSkuStockDecisions(p,{warehouse:choice('sum')}),null,'Warehouse consent does not cover boutique')
assert.equal(confirmedSkuStockDecisions(p,{boutique:choice('sum')}),null)
assert.equal(confirmedSkuStockDecisions(p,{warehouse:{method:'sum',verified:false},boutique:choice('sum')}),null)
assert.equal(confirmedSkuStockDecisions(p,{warehouse:choice('defer'),boutique:choice('sum')}),null,
 'Defer leaves pair untouched: never sends a partial merge')
assert.deepEqual(confirmedSkuStockDecisions(p,{warehouse:choice('sum'),boutique:choice('sum')}),[
 {location:'warehouse',method:'sum',physicallyVerified:true},
 {location:'boutique',method:'sum',physicallyVerified:true},
])
assert.deepEqual(confirmedSkuStockDecisions(p,{warehouse:choice('keep_source'),boutique:choice('sum')}),[
 {location:'warehouse',method:'keep_source',physicallyVerified:true,
  reason:'Физический товар сверили вручную'},
 {location:'boutique',method:'sum',physicallyVerified:true},
])
assert.deepEqual(confirmedSkuStockDecisions(p,{warehouse:choice('keep_keeper'),boutique:choice('sum')}),[
 {location:'warehouse',method:'keep_keeper',physicallyVerified:true,
  reason:'Физический товар сверили вручную'},
 {location:'boutique',method:'sum',physicallyVerified:true},
])
assert.deepEqual(confirmedSkuStockDecisions(p,{
 warehouse:choice('physical_count',{counted:'5'}),boutique:choice('keep_source'),
}),[
 {location:'warehouse',method:'physical_count',physicallyVerified:true,countedQuantity:5,
  reason:'Физический товар сверили вручную'},
 {location:'boutique',method:'keep_source',physicallyVerified:true,
  reason:'Физический товар сверили вручную'},
])
assert.equal(confirmedSkuStockDecisions(p,{warehouse:choice('keep_keeper',{reason:'коротко'}),
 boutique:choice('sum')}),null,'Corrections need a descriptive reason')
assert.equal(confirmedSkuStockDecisions(p,{warehouse:choice('physical_count'),
 boutique:choice('sum')}),null,'Physical count must be explicit')
for(const counted of ['-1','1.5','1e2','7stuff','9007199254740992']){
 assert.equal(confirmedSkuStockDecisions(p,{warehouse:choice('physical_count',{counted}),
  boutique:choice('sum')}),null, 'Reject malformed count '+counted)
}
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',4,3,5),place('boutique',2,0)),{
 warehouse:choice('keep_source'),boutique:choice('sum'),
}),null,'Cannot lower physical quantity below existing reservations')
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',4,3,4),place('boutique',2,0)),{
 warehouse:choice('keep_keeper'),boutique:choice('sum'),
}),null)
assert.equal(confirmedSkuStockDecisions(p,{warehouse:choice('sum'),boutique:choice('sum')})?.length,2)
const onlyWarehouse=preview(place('warehouse',1,4),place('boutique',0,8))
assert.deepEqual(confirmedSkuStockDecisions(onlyWarehouse,{warehouse:choice('keep_keeper')}),[
 {location:'warehouse',method:'keep_keeper',physicallyVerified:true,reason:'Физический товар сверили вручную'},
])
assert.deepEqual(confirmedSkuStockDecisions(preview(place('warehouse',0,4),place('boutique',0,8),
 {canConsolidate:true}),{}),[],'A clean zero-source merge needs no physical approval')
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',0,4),place('boutique',0,8)),{}),null)
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',2,1),place('boutique',1,0),
 {blockers:['Активная ревизия']}),{warehouse:choice('sum'),boutique:choice('sum')}),null)
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',2,1),place('boutique',1,0),
 {canConsolidateAfterVerifiedSum:false}),{warehouse:choice('sum'),boutique:choice('sum')}),null)
assert.equal(confirmedSkuStockDecisions(preview(place('warehouse',2,1),place('warehouse',1,0)),{
 warehouse:choice('sum'),
}),null,'Duplicate locations must be rejected')
assert.equal(confirmedSkuStockDecisions(preview({...place('warehouse',2,1),combinedPhysical:10},
 place('boutique',1,0)),{warehouse:choice('sum'),boutique:choice('sum')}),null)

const ui=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
const backend=fs.readFileSync('worker/domains/catalog-variant-consolidation.ts','utf8')
assert.match(ui,/confirmedSkuStockDecisions\(skuPreview,stockChoices\)/)
assert.match(ui,/setStockChoices\(\{\}\)/)
assert.match(ui,/verifiedStockDecisions,/)
assert.match(ui,/value=\{choice\.method\|\|''\}/)
assert.match(ui,/<option value="physical_count">/)
assert.match(ui,/<option value="keep_source">/)
assert.match(ui,/<option value="keep_keeper">/)
assert.match(ui,/<option value="defer">/)
assert.match(ui,/counted:event\.target\.value,verified:false/)
assert.match(ui,/reason:event\.target\.value,verified:false/)
assert.match(ui,/verified:event\.target\.checked/)
assert.match(ui,/disabled=\{actionBusy \|\| confirmedSkuStockDecisions\(skuPreview,stockChoices\)===null\}/)
assert.match(backend,/decision\.physicallyVerified!==true/)
assert.match(backend,/\['sum','keep_source','keep_keeper','physical_count'\]/)
assert.match(backend,/requiredLocations\.size/)
assert.match(backend,/reason\.length<12/)
assert.match(backend,/snapshotToken\(source,target,stocks,reservations,businessMonthRange\(\)\)!==preview\.stateToken/)
console.log('SKU STOCK CHOICES PASSED — sum, keep source/keeper, count, defer, separate proof per location, corrections and shortages')
