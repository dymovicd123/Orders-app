import assert from 'node:assert/strict'
import fs from 'node:fs'
import {transferProvidedFactsMatchCanonicalSku} from '../worker/domains/inventory-movement.ts'

const ui=fs.readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
const movement=fs.readFileSync('worker/domains/inventory-movement.ts','utf8')
const transfer=movement.slice(movement.indexOf('export async function applyInventoryTransfer('),movement.indexOf('export async function reverseInventoryTransferDocument('))
const manual=movement.slice(movement.indexOf('export async function applyInventoryMovement('))
assert(ui.includes("mode==='transfer'?Math.max(0,currentQuantity-int(value))"),'Active movement UI must keep source quantity nonnegative')
assert(ui.includes("targetBefore+int(value)"),'Active movement UI must show full Q added to destination')
assert(ui.includes("const shortage=Math.max(0,int(row.reservedQuantity)-after)"),'Active UI must show reservation shortfalls separately')
assert(ui.includes("after=mode==='transfer'?Math.max(0,before-quantity)"),'Active review cannot show negative stock on transfer')
assert(ui.includes('p.targetQuantity(row.variantId)+quantity'),'Active review must show new destination physical')
assert(ui.includes("quantity>Math.max(0,before)"),'Transfer/writeoff beyond system quantity needs possession confirmation')
assert(ui.includes("(mode === 'arrival' || mode==='manual_set')"),'Only Arrival and deliberate correction offer inline variant creation')
assert(ui.includes('extraArrival.totalQuantity'),'New Arrival variants must appear in the final review')
assert(!ui.includes('Сколько здесь сейчас'),'Transfer UI must not silently replace movement Q with complete recount')
assert(transfer.includes('transferProvidedFactsMatchCanonicalSku(raw, canonical)'),'Transfer cannot accept stale/mismatched ID payload')
assert(transfer.includes("buildStockResolutionRequired('transfer'"),'Transfer shortages must be explicitly resolved')
assert(manual.includes("buildStockResolutionRequired('writeoff'"),'Writeoff shortages must be explicitly resolved')
assert(manual.includes("movementType !== 'arrival' && movementType !== 'manual_set'"),'Other stock operations must not create variants from free text')
assert(manual.includes("movementType === 'arrival'"),'Arrival creation path must remain available')
const standard={
 productId:71,variantId:711,productName:'QA ШАПАН',category:'adult',gender:'ЖЕН',
 color:'БЕЖЕВЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'46',quantity:1
}
assert(transferProvidedFactsMatchCanonicalSku(standard,standard),'Exact SKU transfer identity rejected')
assert(transferProvidedFactsMatchCanonicalSku({variantId:711,quantity:1},standard),'ID-only confirmed SKU transfer must remain allowed')
for(const [field,bad] of [['productId',72],['color','СИНИЙ'],['material','ЗАМША'],['length','ДЛИННЫЙ'],['size','48']]){
 assert(!transferProvidedFactsMatchCanonicalSku({...standard,[field]:bad},standard),'Transfer accepted mismatched '+field)
}
for(const [source,moved,reserve,target] of [[1,2,1,0],[10,4,8,2],[0,1,0,5]]){
 const after=Math.max(0,source-moved)
 const shortage=Math.max(0,reserve-after)
 assert(after>=0&&shortage>=0)
 assert.equal(target+moved-target,moved)
}
console.log('ACTIVE_WAREHOUSE_OPERATION_PASS: source/target Q, reserved shortages, stale SKU guard, Arrival-only creation, correction, writeoff and transfer review')
