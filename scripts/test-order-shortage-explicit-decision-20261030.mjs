import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { assertCreateOrderShortageDecisions, OrderStockShortageError } from '../worker/domains/order-reservations.ts'
import { normalizeOrderItems } from '../worker/domains/order-core.ts'

const db = new DatabaseSync(':memory:')
db.exec([
  'CREATE TABLE inventory_stock (inventory_source TEXT, variant_id INTEGER, quantity INTEGER, reserved_quantity INTEGER)',
  "INSERT INTO inventory_stock VALUES ('warehouse', 101, 2, 0), ('boutique', 101, 1, 0), ('warehouse', 102, 0, 0)",
  'CREATE TABLE inventory_reservations (id INTEGER PRIMARY KEY, order_id INTEGER, inventory_source TEXT, variant_id INTEGER, status TEXT, quantity INTEGER)',
].join(';'))
// Real in-memory SQLite execution via D1's asynchronous shape, never remote.
const d1 = {prepare(sql) {return {bind(...params) {return {
  async all() {return {results: db.prepare(sql).all(...params)}},
}}}}}
const item=(quantity=1,sourceType='warehouse',extra={})=>({
  productName:'Кебек', gender:'МУЖ', color:'БЕЖ', material:'СТАНДАРТ',
  length:'СТАНДАРТ', size:'50', sourceType, quantity, ...extra,
})
const decision=(quantity,physical,reserved,source='warehouse',variant=101)=>({
  inventorySource:source,variantId:variant,requestedQuantity:quantity,
  physicalQuantity:physical,reservedQuantity:reserved,
})
const check=(lines,variants,opts)=>assertCreateOrderShortageDecisions(d1,normalizeOrderItems(lines,'warehouse'),variants.map(variantId=>({productId:11,variantId})),opts)
const mustShortage=async(fn, expected)=>{
  try {await fn();assert.fail('Expected a real server shortage decision')}catch(error){
    assert(error instanceof OrderStockShortageError, String(error))
    assert.equal(error.code,'order_stock_shortage')
    if(expected!==undefined)assert.equal(error.shortages[0].shortage,expected)
    return error.shortages
  }
}
const quantity=()=>db.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=101").get()
const before=quantity()
await check([item()],[101]) // adequate stock: no extra click
assert.deepEqual(quantity(),before,'Order preflight must not mutate Physical or Reserved')
db.exec("INSERT INTO inventory_reservations VALUES (1,999,'warehouse',101,'active',2)")
const shortage=await mustShortage(()=>check([item()],[101]),1)
assert.equal(shortage[0].inventorySource,'warehouse')
assert.equal(shortage[0].variantId,101)
assert.deepEqual(shortage[0].inputIndexes,[0])
assert.deepEqual(shortage[0].physicalQuantity,2)
assert.deepEqual(shortage[0].reservedQuantity,2)
// A forged/stale Boolean from an old client is never sufficient.
await mustShortage(()=>check([item(1,'warehouse',{shortageAcknowledged:true})],[101]),1)
await mustShortage(()=>check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,1)})],[101]),1)
await mustShortage(()=>check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,2,'boutique')})],[101]),1)
await mustShortage(()=>check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,2,'warehouse',102)})],[101]),1)
await check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,2)})],[101])
db.exec("INSERT INTO inventory_reservations VALUES (2,998,'warehouse',101,'active',1)")
await mustShortage(()=>check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,2)})],[101]),2)
await check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,3)})],[101])
// Duplicate lines for the same SKU must agree on the GROUP total and snapshot.
const lines=[item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(2,2,3)}),item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(2,2,3)})]
await check(lines,[101,101])
assert.deepEqual((await mustShortage(()=>check([lines[0],item()],[101,101]),3))[0].inputIndexes,[0,1])
await check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,3)})],[101])
// Source-specific: boutique remains free; no warehouse shortage should leak.
await check([item(1,'boutique')],[101])
await mustShortage(()=>check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,3)})],[102]),1)
// Zero-stock SKU and an entirely missing inventory_stock row both need consent.
await mustShortage(()=>check([item()],[102]),1)
await mustShortage(()=>check([item()],[103]),1)
// The new retired-generation marker (variant=0) must NOT authorize ordinary SKU=101.
await mustShortage(()=>check([item(1,'warehouse',{shortageAcknowledged:true,shortageDecision:decision(1,2,3,'warehouse',0)})],[101]),2)
// Editor re-write excludes this order's own reserved obligation.
await check([item(1,'warehouse')],[101],{excludeOrderId:999})
await check([item(2,'workshop')],[null])
assert.deepEqual(quantity(),before,'Server shortage check must never change the shelf')
const reserve=fs.readFileSync('worker/domains/order-reservations.ts','utf8')
const view=fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx','utf8')
const app=fs.readFileSync('src/App.tsx','utf8')
const write=fs.readFileSync('worker/domains/orders-write.ts','utf8')
assert.match(write,/const retiredGroups = new Map/, 'Retired SKU must aggregate duplicate order lines BEFORE recreation')
assert.match(write,/approvedRetiredInputIndexes/, 'Retired SKU consent must be checked before catalog mutation')
assert.match(write,/item.shortageDecision = \{ \.\.\.item.shortageDecision, variantId: resolved.variantId \}/, 'Validated retired consent must link to the new canonical SKU')
assert.doesNotMatch(write,/shortageAcknowledged\s*:\s*true/, 'Create/Edit must never silently override employee decision')
assert.doesNotMatch(write,/item\.shortageAcknowledged\s*=\s*true/, 'No forced edit acknowledgement')
assert.match(reserve,/confirmedAtCurrentSnapshot/,'Server must compare current precise shortage state')
assert.match(view,/Подтвердить резерв при нехватке/,'Employee must have an explicit shortage action')
assert.match(app,/shortageDecision: item\.sourceType !== 'workshop'/,'Create/Edit payload must send precise decision')
assert.match(app,/shortageDecision = null/,'Identity/quantity change must clear previous decision')
console.log('ORDER_SHORTAGE_EXPLICIT_DECISION_PASSED — SQLite free/deficit/duplicate/source/edit/stale-state, no auto-ack, visible employee choice and no physical writes')
