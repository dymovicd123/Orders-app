import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {clampDispatchQuantity,dispatchSelectionError} from '../src/features/orders/shippingSelection.ts'
import {projectOrderShipmentDisplay,isOrderShipmentCompleteForActions} from '../src/app/orderShipmentProjection.ts'

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
const contextSource=fs.readFileSync('src/features/orders/orderTableSectionContext.ts','utf8')
assert(!src.includes('@ts-nocheck'), 'Order table must remain compiled under TypeScript')
assert(!/[:<,|]\s*any\b|\bas\s+any\b|\bany\s*\[\s*\]/.test(src), 'Order table must not revert to unchecked any-based drafts')
assert(!/[:<,|]\s*any\b|\bas\s+any\b|\bany\s*\[\s*\]/.test(contextSource), 'Order table contract must remain precisely typed')
assert(src.includes('type SectionContext = OrderTableSectionContext'), 'Order table must consume the typed context')
assert(contextSource.includes("ReturnType<typeof createOrderShippingHandoverActions>"),
  'Stock and shipment callback signatures must remain derived from the real action owners')
assert(contextSource.includes("ReturnType<typeof createOrderDependentCancellationActions>"),
  'Return/exchange cancellation contract must remain tied to the actual CAS owner')

const actionsSource=fs.readFileSync('src/features/orders/orderTableDispatchActions.ts','utf8')
const modalSource=fs.readFileSync('src/features/orders/OrderTableDispatchModal.tsx','utf8')
assert(src.includes('<OrderTableDispatchModal'),'OrdersTable must wire the typed shipping modal')
assert(src.includes('createOrderTableDispatchActions({'),
  'OrdersTable must use the typed dispatch controller rather than duplicate HTTP actions')
assert(actionsSource.includes('const selectionError=dispatchSelectionError(d.plan?.lines||[],d.selected)'),
  'Submit preflight must reject invalid quantity before POST')
assert(modalSource.includes('const quantity=clampDispatchQuantity('),
  'Numeric input must clamp to the ready quantity')
assert(modalSource.includes("disabled={dispatchDraft.submitting||line.sourceType==='workshop'||line.dispatchPriorIssued}"),
  'Workshop and already-issued quantities must not be partially editable')
assert(modalSource.includes('Boolean(dispatchSelectionError(dispatchDraft.plan?.lines||[],dispatchDraft.selected))'),
  'Invalid selected quantities must disable confirmation')
assert(actionsSource.includes('body:JSON.stringify({requestId:d.requestId,items,stockConfirmations})'),
  'Same idempotency requestId must survive an uncertain POST response and shortage confirmation')
assert(actionsSource.includes('let {res,data}=await submit()') && actionsSource.includes('({res,data}=await submit(data.items.map('),
  'Shortage acknowledgement must retry with the original request ID rather than create a new dispatch')
assert(actionsSource.includes('submitting:false,\n          error:e instanceof Error?e.message'),
  'On uncertain error keep the same draft/requestId for safe retry')
// Exchange Set can retain the old order item as quantity=0 before a new line.
// The order table still displays original item positions. A filtered shipment
// projection must not attach the new item's badge to the old zero-qty row.
const exchangedOrder={
  shipping_status:'not_sent',
  items:[
    {id:21,productName:'Old replacement',quantity:0,sourceType:'warehouse',shipmentSentQuantity:null},
    {id:22,productName:'New sent',quantity:1,sourceType:'warehouse',shipmentSentQuantity:1},
    {id:23,productName:'Other pending',quantity:2,sourceType:'warehouse',shipmentSentQuantity:0},
  ],
}
const displayAfterExchange=projectOrderShipmentDisplay(exchangedOrder)
assert.equal(displayAfterExchange.state,'partial')
assert.deepEqual(displayAfterExchange.lines.map(line=>line.sourceIndex),[1,2],
  'Shipment statuses must retain original item positions when a zero-quantity row remains')
const badgesByOriginalIndex=new Map(displayAfterExchange.lines.map(line=>[line.sourceIndex,line]))
assert.equal(badgesByOriginalIndex.get(0),undefined,'A replaced zero-quantity row is not a shipped line')
assert.equal(badgesByOriginalIndex.get(1)?.label,'Отправлен')
assert.equal(badgesByOriginalIndex.get(2)?.label,'Не отправлен')
assert.equal(isOrderShipmentCompleteForActions(exchangedOrder),false)
const fullySentAfterExchange={...exchangedOrder,items:exchangedOrder.items.slice(0,2)}
assert.equal(projectOrderShipmentDisplay(fullySentAfterExchange).state,'sent',
  'A retained zero-quantity old item cannot force a fully shipped order into partial status')
assert.equal(isOrderShipmentCompleteForActions(fullySentAfterExchange),true)

// Exercise the compiled *actual* OrdersTable HTTP controller with a disposable
// fake transport. Existing SQLite Worker tests independently own Physical/Reserved.
const moduleBuild = await build({
  entryPoints: ['src/features/orders/orderTableDispatchActions.ts'],
  bundle: true, platform: 'node', format: 'esm', target: 'es2022',
  write: false, logLevel: 'silent',
})
const {createOrderTableDispatchActions} = await import(
  'data:text/javascript;base64,' + Buffer.from(moduleBuild.outputFiles[0].text).toString('base64')
)
const response = (payload, status=200) => new Response(JSON.stringify(payload), {
  status, headers:{'Content-Type':'application/json'},
})
let modal=null
let message=null
let refresh=0
let refreshOk=true
let approveStock=true
let approveCorrection=true
let shortageMode=false
let staleMode=false
let correctionFail=false
let priorFail=false
let lastSelection = null
let calls=[]
let planLines = [
  {orderItemId:44,productName:'КОСТЮМ',readyQuantity:1,selectedQuantity:1,
    selectable:true,sourceType:'warehouse'},
  {orderItemId:45,productName:'ШАПАН ЦЕХ',readyQuantity:2,selectedQuantity:2,
    selectable:true,sourceType:'workshop'},
]
let canConfirmIssuedOnly=false
let historyRows=[]
const shortageItems=[{
  productName:'КОСТЮМ',source:'warehouse',variantId:123,
  trackedPhysicalQuantity:0,expectedQuantity:0,operationQuantity:1,
}]
const fakeApi=async (url,init) => {
  const method=init?.method || 'GET'
  calls.push({url,method,init})
  if (method==='GET' && url.endsWith('/shipping/plan')) return response({
    ok:true,lines:planLines,canConfirmIssuedOnly,
    selectedCount:canConfirmIssuedOnly?0:planLines.filter(row=>row.selectable).length,
  })
  if (method==='GET' && url.endsWith('/shipping/dispatches')) return response({ok:true,dispatches:historyRows})
  if (method==='POST' && url.endsWith('/shipping/dispatches')) {
    lastSelection=JSON.parse(init.body)
    if(staleMode)return response({ok:false,message:'Заказ изменился'},409)
    if(shortageMode&&!lastSelection.stockConfirmations) return response({
      ok:false,code:'dispatch_stock_confirmation_required',message:'Нужно уточнение',items:shortageItems,
    },409)
    return response({ok:true,shippedQuantity:lastSelection.items.reduce((n,item)=>n+item.quantity,0)})
  }
  if (method==='PATCH' && url.endsWith('/shipping')) {
    if(priorFail)return response({ok:false,message:'Обновите отправку'},409)
    return response({ok:true})
  }
  if (method==='POST' && url.includes('/dispatch-items/')) {
    if(correctionFail)return response({ok:false,message:'Операция изменилась'},409)
    return response({ok:true,needsStockCheck:true})
  }
  throw Error('Unexpected dispatch route: '+method+' '+url)
}
const actions = () => createOrderTableDispatchActions({
  dispatchDraft:modal,
  setDispatchDraft:update=>{modal=typeof update==='function'?update(modal):update},
  apiFetch:fakeApi,
  askStockResolution:async()=>approveStock,
  askActionConfirmation:async()=>approveCorrection,
  setMessage:value=>{message=typeof value==='function'?value(message):value},
  onShipmentChange:async()=>{refresh++;return refreshOk},
})
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const order={id:55,external_id:'ORD-55'}
actions().openDispatchDraft(order)
await flush()
assert.deepEqual(modal.selected,{44:1,45:2},'all ready units selected by default')
const firstId=modal.requestId
assert.match(firstId,/^order-dispatch:/)
assert.deepEqual(calls.slice(0,2).map(c=>c.url),[
  '/api/orders/55/shipping/plan','/api/orders/55/shipping/dispatches',
])
// Block an invalid quantity before any HTTP write.
modal={...modal,selected:{44:2,45:2}}
const beforeInvalid=calls.length
actions().submitSelectedDispatch()
assert.equal(calls.length,beforeInvalid)
assert.match(modal.error,/превышает/)
modal={...modal,selected:{44:1,45:2},error:''}
// A declined stock shortage must not mutate order or create a fresh requestId.
shortageMode=true
approveStock=false
const beforeDeclined=refresh
actions().submitSelectedDispatch()
await flush()
assert.equal(modal.requestId,firstId)
assert.equal(modal.submitting,false)
assert.equal(refresh,beforeDeclined)
assert.match(modal.error,/не проведена/)
const declinedWrites=calls.filter(c=>c.method==='POST'&&c.url.endsWith('/shipping/dispatches'))
assert.equal(declinedWrites.length,1)
assert.equal(JSON.parse(declinedWrites[0].init.body).requestId,firstId)
// Confirm only this exact shortage with the same requestId, not a global stock fix.
approveStock=true
actions().submitSelectedDispatch()
await flush()
const writes=calls.filter(c=>c.method==='POST'&&c.url.endsWith('/shipping/dispatches'))
assert.equal(writes.length,3)
const payloads=writes.map(c=>JSON.parse(c.init.body))
assert(payloads.every(p=>p.requestId===firstId))
assert.deepEqual(payloads.at(-1).items,[
  {orderItemId:44,quantity:1},{orderItemId:45,quantity:2},
])
assert.deepEqual(payloads.at(-1).stockConfirmations,[{
  source:'warehouse',variantId:123,expectedQuantity:0,operationQuantity:1,
}])
assert.equal(modal,null)
assert.equal(refresh,beforeDeclined+1)
assert.match(message,/отправлено 3 шт/)
// A stale 409 leaves the draft and key available for explicit retry.
shortageMode=false
staleMode=true
actions().openDispatchDraft(order)
await flush()
const staleId=modal.requestId
actions().submitSelectedDispatch()
await flush()
assert.equal(modal.requestId,staleId)
assert.equal(modal.submitting,false)
assert.match(modal.error,/Заказ изменился/)
staleMode=false
actions().submitSelectedDispatch()
await flush()
assert.equal(modal,null)
// Legacy prior-issued is confirmation-only: PATCH, never another stock decrement.
planLines=[]
canConfirmIssuedOnly=true
actions().openDispatchDraft(order)
await flush()
const priorId=modal.requestId
priorFail=true
actions().confirmIssuedOnlyDispatch()
await flush()
assert.equal(modal.requestId,priorId)
assert.match(modal.error,/Обновите отправку/)
priorFail=false
actions().confirmIssuedOnlyDispatch()
await flush()
const priorWrites=calls.filter(c=>c.method==='PATCH'&&c.url.endsWith('/shipping'))
assert.equal(priorWrites.length,2)
assert(priorWrites.every(c=>c.init.headers['X-Idempotency-Key']===priorId))
assert(priorWrites.every(c=>{
  const body=JSON.parse(c.init.body)
  return body.confirmAlreadyIssued===true && body.shippingStatus==='sent' &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.shippingDate)
}))
assert.equal(modal,null)
assert.match(message,/без повторного списания/)
// Correction after a mistaken dispatch must reuse its correction key after 409.
canConfirmIssuedOnly=false
planLines=[]
historyRows=[{dispatchItemId:78,orderItemId:44,productName:'КОСТЮМ',
  quantity:1,cancelledQuantity:0}]
actions().openDispatchDraft(order)
await flush()
correctionFail=true
actions().cancelDispatchedLine(historyRows[0])
await flush()
assert.equal(modal.submitting,false)
assert.match(modal.error,/Операция изменилась/)
const correctionId=modal.correctionKey
assert.match(correctionId,/^order-dispatch:/)
correctionFail=false
actions().cancelDispatchedLine(historyRows[0])
await flush()
const corrected=calls.filter(c=>c.method==='POST'&&c.url.includes('/dispatch-items/'))
assert.equal(corrected.length,2)
assert(corrected.every(c=>c.url==='/api/orders/55/shipping/dispatch-items/78/correct'))
assert(corrected.every(c=>JSON.parse(c.init.body).requestId===correctionId))
assert.equal(modal,null)
assert.match(message,/остаток автоматически не увеличен/)
assert.equal(refresh,4,'success-only refresh; stale and declined operations do not refresh')

// Once a POST is committed, a failed list refresh must never offer the same shipment again.
planLines=[{orderItemId:44,productName:'КОСТЮМ',readyQuantity:1,selectedQuantity:1,selectable:true,sourceType:'warehouse'}]
historyRows=[]
actions().openDispatchDraft(order)
await flush()
refreshOk=false
actions().submitSelectedDispatch()
await flush()
assert.equal(modal,null,'Confirmed shipment is closed, not offered for retry when readback fails')
assert.match(message,/отправлено 1 шт/)
assert.match(message,/Список заказов не обновился/)
assert.equal(refresh,5)
refreshOk=true


// The modal itself is now independently TypeScript-checked, and these are
// actual React-rendered branches rather than string-only assertions.
const builtModal = await build({
  entryPoints:['src/features/orders/OrderTableDispatchModal.tsx'],
  bundle:true, platform:'node', format:'esm', jsx:'automatic',
  target:'es2022', write:false, logLevel:'silent',
})
const {OrderTableDispatchModal} = await import(
  'data:text/javascript;base64,' + Buffer.from(builtModal.outputFiles[0].text).toString('base64')
)
const lineWarehouse={orderItemId:44,productName:'КОСТЮМ',readyQuantity:1,
  selectedQuantity:1,selectable:true,sourceType:'warehouse',
  color:'ХАКИ',material:'СТАНДАРТ',size:'50'}
const lineWorkshop={orderItemId:45,productName:'ШАПАН ЦЕХ',readyQuantity:2,
  selectedQuantity:2,selectable:true,sourceType:'workshop',
  color:'ЧЁРНЫЙ',size:'52'}
const baseModalDraft={
  order:{id:55,external_id:'ORD-55'},
  plan:{ok:true,lines:[lineWarehouse,lineWorkshop],selectedCount:2,canConfirmIssuedOnly:false},
  history:[],loading:false,submitting:false,error:'',selected:{44:1,45:2},
  requestId:'order-dispatch:test-id',correctionKey:'',correctionItemId:0,
}
const modalProps = draft => ({
  draft,setDraft:()=>{},submitSelectedDispatch:()=>{},
  confirmIssuedOnlyDispatch:()=>{},cancelDispatchedLine:()=>{},
})
const rendered = draft => renderToStaticMarkup(createElement(OrderTableDispatchModal,modalProps(draft)))
const readyMarkup=rendered(baseModalDraft)
assert(readyMarkup.includes('aria-label="Отправка товаров"'))
assert(readyMarkup.includes('ORD-55'))
assert(readyMarkup.includes('Готово 1 шт.'))
assert(readyMarkup.includes('ШАПАН ЦЕХ'))
const warehouseQtyLabel='aria-label="Количество КОСТЮМ · ХАКИ · 50 · Склад · позиция №44"'
const workshopQtyLabel='aria-label="Количество ШАПАН ЦЕХ · ЧЁРНЫЙ · 52 · Цех · позиция №45"'
assert(readyMarkup.includes(warehouseQtyLabel))
assert(readyMarkup.includes(workshopQtyLabel))
const workshopQty=readyMarkup.slice(readyMarkup.indexOf(workshopQtyLabel),-1)
assert(workshopQty.includes('disabled'),'Workshop number control must stay read-only')
const priorMarkup=rendered({...baseModalDraft,
  plan:{ok:true,lines:[],selectedCount:0,canConfirmIssuedOnly:true},selected:{}})
assert(priorMarkup.includes('Подтвердить отправку без повторного списания'))
assert(priorMarkup.includes('само по себе не подтверждает отправку клиенту'))
const issuedMarkup=rendered({...baseModalDraft,plan:{
  ok:true,lines:[{...lineWarehouse,dispatchPriorIssued:true}],selectedCount:1,
}})
assert(issuedMarkup.includes('По учёту уже выдан'))
assert(issuedMarkup.slice(issuedMarkup.indexOf(warehouseQtyLabel)).includes('disabled'),
  'Prior-issued quantity cannot be partially edited')
const sentHistory={dispatchItemId:99,orderItemId:44,quantity:1,cancelledQuantity:0,
  productName:'КОСТЮМ',dispatchDate:'2026-11-09'}
const correctionMarkup=rendered({...baseModalDraft,history:[sentHistory]})
assert(correctionMarkup.includes('Исправить ошибочную отправку'))
assert(correctionMarkup.includes('Ранее отправлено'))
const returnedMarkup=rendered({...baseModalDraft,history:[{...sentHistory,hasReturn:true}]})
assert(returnedMarkup.includes('Есть возврат'))
assert(!returnedMarkup.includes('Исправить ошибочную отправку'),
  'Already returned unit cannot offer unsafe dispatch correction')
const staleMarkup=rendered({...baseModalDraft,error:'Обновите отправку'})
assert(staleMarkup.includes('role="alert"') && staleMarkup.includes('Обновите отправку'))

console.log('STAGE5_EXCHANGE_ZERO_QUANTITY_STATUS_ALIGNMENT_PASS')
console.log('STAGE5_CLIENT_QUANTITY_AND_RETRY_ID_PASS')
