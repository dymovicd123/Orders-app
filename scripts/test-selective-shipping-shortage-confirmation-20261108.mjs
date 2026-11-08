import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shipping-shortage-'))
const entries=[
 'worker/domains/order-dispatch-confirmation.ts',
 'worker/domains/order-shipment-plan.ts'
]
await build({entryPoints:entries,bundle:true,format:'esm',platform:'node',target:'node20',
 outdir:dir,outExtension:{'.js':'.mjs'},logLevel:'error'})
const confirm=await import(pathToFileURL(path.join(dir,'order-dispatch-confirmation.mjs')).href)
const {buildOrderShipmentPlan}=await import(pathToFileURL(path.join(dir,'order-shipment-plan.mjs')).href)
const oldLine={
 id:15,quantity:1,productName:'ШАПАН',color:'БЕЖЕВЫЙ',size:'56',
 sourceType:'warehouse',stockWriteoffStatus:'reserved',variantId:45,
 shipmentSentQuantity:0,isWorkshop:false,
}
const order={
 id:4,external_id:'ORD-TEST',created_at:'2026-11-08T02:00:00Z',
 order_status:'active',shipping_status:'not_sent',items:[oldLine],
}
const activeReservation=[{order_item_id:15,status:'active',quantity:1,variant_id:45,inventory_source:'warehouse'}]
const active=buildOrderShipmentPlan(order,activeReservation)
assert.equal(active.lines[0].selectable,true,'Existing reservation is shippable even if the free stock is zero')
assert.equal(active.lines[0].readyQuantity,1)
assert.equal(active.lines[0].reservationStatus,'active')
const unresolved=buildOrderShipmentPlan({
 ...order,items:[{...oldLine,stockWriteoffStatus:'pending_reservation'}],
},[{...activeReservation[0],status:'unresolved'}])
assert.equal(unresolved.lines[0].selectable,true,'Known SKU with an unresolved shortage must offer actual dispatch')
assert.equal(unresolved.lines[0].needsStockConfirmation,true)
assert.equal(unresolved.lines[0].reservationStatus,'unresolved')
assert.equal(unresolved.lines[0].selectedQuantity,1)
const unresolvedUnknown=buildOrderShipmentPlan({
 ...order,items:[{...oldLine,stockWriteoffStatus:'catalog_unresolved'}],
},[{...activeReservation[0],status:'unresolved',variant_id:null}])
assert.equal(unresolvedUnknown.lines[0].selectable,false,'Do not ship an unknown product identity')
const fulfilled=buildOrderShipmentPlan({...order,shipping_status:'sent',items:[{...oldLine,stockWriteoffStatus:'fulfilled',shipmentSentQuantity:1}]},
 [{...activeReservation[0],status:'fulfilled'}])
assert.equal(fulfilled.lines[0].selectable,false,'No duplicate shipment allowed')
const replacement=buildOrderShipmentPlan({
 ...order,shipping_status:'sent',items:[{...oldLine,stockWriteoffStatus:'reserved',pendingExchangeDispatchId:14}],
},activeReservation)
assert.equal(replacement.lines[0].selectable,true,'New replacement is shippable after original order sent')
for(const [before,qty,reserved,active,after,deducted,unaccounted,reservedAfter] of [
 [0,1,0,0,0,0,1,0],
 [0,1,1,1,0,0,1,0],
 [1,1,1,1,0,1,0,0],
 [1,2,1,1,0,1,1,0],
 [4,1,4,0,3,1,0,4],
 [4,1,4,1,3,1,0,3]
]){
 const x=confirm.boundedDispatchStock(before,qty,reserved,active)
 assert.equal(x.after,after)
 assert.equal(x.deducted,deducted)
 assert.equal(x.unaccounted,unaccounted)
 assert.equal(x.reservedAfter,reservedAfter)
}
assert.equal(confirm.normalizeDispatchStockConfirmations([{
 source:'warehouse',variantId:45,expectedQuantity:0,operationQuantity:1
}]).length,1)
assert.throws(()=>confirm.normalizeDispatchStockConfirmations([{
 source:'warehouse',variantId:45,expectedQuantity:0,operationQuantity:1
},{source:'warehouse',variantId:45,expectedQuantity:0,operationQuantity:1}]),/несколько раз/)
assert.throws(()=>confirm.normalizeDispatchStockConfirmations([{
 source:'warehouse',variantId:45,expectedQuantity:-1,operationQuantity:1
}]))
const dispatch=fs.readFileSync('worker/domains/order-dispatch.ts','utf8')
const cancel=fs.readFileSync('worker/domains/order-dispatch-cancel.ts','utf8')
const route=fs.readFileSync('worker/index.ts','utf8')
const ui=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(dispatch.includes('DispatchStockConfirmationRequired(requiredConfirmations)'))
assert(dispatch.includes('quantity=?,reserved_quantity=?'),'No negative stock quantities after confirmation')
assert(dispatch.includes("stock_writeoff_status='fulfilled'"),'Keep exact fulfillment status')
assert(dispatch.includes('inventory_operation_evidence'),'Record discrepancy evidence')
assert(cancel.includes('restoreQty=restorePhysical?accountedQuantity:0'),'No phantom stock restoration on undo')
assert(route.includes("code:error.code,message:error.message,items:error.items"))
assert(ui.includes("data.code==='dispatch_stock_confirmation_required'"))
assert(ui.includes("askStockResolution({"))
console.log('SELECTIVE_SHIPPING_SHORTAGE_PASS: free=0, shortage known SKU, bounded physical deduction, no other-reservation deletion, explicit confirmation, cancellation and no double issue')
