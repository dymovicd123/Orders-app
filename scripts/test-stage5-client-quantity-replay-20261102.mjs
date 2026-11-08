import assert from 'node:assert/strict'
import fs from 'node:fs'
import {clampDispatchQuantity,dispatchSelectionError} from '../src/features/orders/shippingSelection.ts'

// Browser type=number max alone is NOT a guard: Work #733 entered 2 when only 1 was ready.
assert.equal(clampDispatchQuantity('2',1),1)
assert.equal(clampDispatchQuantity('1',3),1)
assert.equal(clampDispatchQuantity('8',3),3)
assert.equal(clampDispatchQuantity('0',3),0)
assert.equal(clampDispatchQuantity('-1',3),0)
assert.equal(clampDispatchQuantity('1.5',3),0)
assert.equal(clampDispatchQuantity('',3),0)
assert.equal(clampDispatchQuantity('1',0),0)
assert.equal(clampDispatchQuantity('1',2,true),2)
const stock={orderItemId:11,readyQuantity:1,selectable:true,sourceType:'warehouse'}
const workshop={orderItemId:12,readyQuantity:2,selectable:true,sourceType:'workshop'}
const pending={orderItemId:13,readyQuantity:0,selectable:false,sourceType:'warehouse'}
assert.equal(dispatchSelectionError([stock],{11:1}),'')
assert.equal(dispatchSelectionError([stock],{11:2}).includes('превышает'),true)
assert.equal(dispatchSelectionError([stock],{11:-1}).includes('Количество'),true)
assert.equal(dispatchSelectionError([stock],{11:1.5}).includes('Количество'),true)
assert.equal(dispatchSelectionError([pending],{13:1}).includes('Количество'),true)
assert.equal(dispatchSelectionError([workshop],{12:1}).includes('Количество'),true)
assert.equal(dispatchSelectionError([workshop],{12:2}),'')
const priorIssued={orderItemId:14,readyQuantity:2,selectable:true,sourceType:'warehouse',dispatchPriorIssued:true}
assert.equal(dispatchSelectionError([priorIssued],{14:1}).includes('Количество'),true)
assert.equal(dispatchSelectionError([priorIssued],{14:2}),'')
const unresolved={orderItemId:15,readyQuantity:2,selectable:true,sourceType:'warehouse',needsStockConfirmation:true}
assert.equal(dispatchSelectionError([unresolved],{15:1}),'','Known-SKU shortage can send a subset after confirmation')
assert.equal(dispatchSelectionError([unresolved],{15:2}),'')
assert.equal(dispatchSelectionError([unresolved],{15:0}),'')
const src=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(src.includes('const selectionError=dispatchSelectionError(d.plan?.lines||[],d.selected)'),
  'Submit preflight must reject invalid quantity before POST')
assert(src.includes('const quantity=clampDispatchQuantity('),
  'Numeric input must clamp to the ready quantity')
assert(src.includes("disabled={dispatchDraft.submitting||line.sourceType==='workshop'||line.dispatchPriorIssued}"),
  'Workshop and already-issued quantities must not be partially editable')
assert(src.includes('Boolean(dispatchSelectionError(dispatchDraft.plan?.lines||[],dispatchDraft.selected))'),
  'Invalid selected quantities must disable confirmation')
assert(src.includes('body:JSON.stringify({requestId:d.requestId,items,stockConfirmations})'),
  'Same idempotency requestId must survive an uncertain POST response and shortage confirmation')
assert(src.includes('let {res,data}=await submit()') && src.includes('({res,data}=await submit(data.items.map('),
  'Shortage acknowledgement must retry with the original request ID rather than create a new dispatch')
assert(src.includes('submitting:false,\n          error:e instanceof Error?e.message'),
  'On uncertain error keep the same draft/requestId for safe retry')
console.log('STAGE5_CLIENT_QUANTITY_AND_RETRY_ID_PASS')
