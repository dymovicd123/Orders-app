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
const src=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(src.includes('const selectionError=dispatchSelectionError(d.plan?.lines||[],d.selected)'),
  'Submit preflight must reject invalid quantity before POST')
assert(src.includes('const quantity=clampDispatchQuantity('),
  'Numeric input must clamp to the ready quantity')
assert(src.includes("disabled={dispatchDraft.submitting||line.sourceType==='workshop'}"),
  'Workshop quantity must not be partially editable')
assert(src.includes('Boolean(dispatchSelectionError(dispatchDraft.plan?.lines||[],dispatchDraft.selected))'),
  'Invalid selected quantities must disable confirmation')
assert(src.includes('body:JSON.stringify({requestId:d.requestId,items,stockConfirmations})'),
  'Initial shipment and confirmed retry must share the original idempotency requestId')
assert(src.includes('let {res,data}=await submit()') && src.includes('({res,data}=await submit(data.items.map('),
  'Confirmation must retry the same selected items through the same requestId and only add exact stock proof')
const submitBlock=src.slice(src.indexOf('  const submitSelectedDispatch=()=>{'),src.indexOf('  const confirmIssuedOnlyDispatch=()=>{'))
assert(!submitBlock.includes('newDispatchRequestId()'),
  'Uncertain shipment response or physical confirmation must never generate a fresh requestId')
assert(src.includes('submitting:false,\n          error:e instanceof Error?e.message'),
  'On uncertain error keep the same draft/requestId for safe retry')
console.log('STAGE5_CLIENT_QUANTITY_AND_RETRY_ID_PASS')
