import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'orders-shipped-status-'))
const output=path.join(root,'plan.mjs')
await build({entryPoints:['worker/domains/order-shipment-plan.ts'],
 bundle:true,format:'esm',platform:'node',target:'node20',outfile:output,logLevel:'error'})
const {buildOrderShipmentPlan}=await import(pathToFileURL(output).href)
const displayOutput=path.join(root,'display.mjs')
await build({entryPoints:['src/app/orderShipmentProjection.ts'],
 bundle:true,format:'esm',platform:'node',target:'node20',outfile:displayOutput,logLevel:'error'})
const {isOrderShipmentCompleteForActions,projectOrderShipmentDisplay}=await import(pathToFileURL(displayOutput).href)

const guardOutput=path.join(root,'latest-orders-read.mjs')
await build({entryPoints:['src/app/latestRequestGuard.ts'],bundle:true,format:'esm',
 platform:'node',target:'node20',outfile:guardOutput,logLevel:'error'})
const {createLatestRequestGuard}=await import(pathToFileURL(guardOutput).href)
const latest=createLatestRequestGuard()
const published=[]
let resolveOld
let resolveNew
const older=new Promise(resolve=>{resolveOld=resolve})
const newer=new Promise(resolve=>{resolveNew=resolve})
const take=async(response)=>{
 const token=latest.begin()
 const value=await response
 if(latest.isCurrent(token))published.push(value)
}
const oldPending=take(older)
const newPending=take(newer)
resolveNew('sent-after-dispatch')
await newPending
resolveOld('not-sent-before-dispatch')
await oldPending
assert.deepEqual(published,['sent-after-dispatch'],
 'A slower pre-dispatch read must not restore the old shipment status after a newer refresh')
const blockedToken=latest.begin()
assert(latest.isCurrent(blockedToken),'Latest read can commit normally')
latest.begin()
assert(!latest.isCurrent(blockedToken),'Changing filters invalidates a previously started list load')

const labelsOutput=path.join(root,'shipment-a11y.mjs')
await build({entryPoints:['src/features/orders/shippingSelection.ts'],bundle:true,format:'esm',
 platform:'node',target:'node20',outfile:labelsOutput,logLevel:'error'})
const {dispatchLineAccessibleName}=await import(pathToFileURL(labelsOutput).href)
const firstVariant={orderItemId:41,productName:'БАЯН СҰЛУ ШАПАН',sourceType:'warehouse',
 color:'ОРАНЖЕВЫЙ',size:'52',material:'МЯГКАЯ ТКАНЬ',length:'УКОРОЧЕННЫЙ'}
const secondVariant={...firstVariant,orderItemId:42,color:'БЕЖЕВЫЙ',size:'48',length:'СТАНДАРТ',sourceType:'boutique'}
assert.equal(dispatchLineAccessibleName(firstVariant),
 'БАЯН СҰЛУ ШАПАН · ОРАНЖЕВЫЙ · 52 · МЯГКАЯ ТКАНЬ · УКОРОЧЕННЫЙ · Склад · позиция №41')
assert.notEqual(dispatchLineAccessibleName(firstVariant),dispatchLineAccessibleName(secondVariant))
assert.notEqual(dispatchLineAccessibleName(firstVariant),dispatchLineAccessibleName({...firstVariant,orderItemId:43}),
 'Two identically configured order lines still need different accessible labels')


const item={
 id:5537,quantity:1,productName:'ҚОЗЫ КӨРПЕШ ШАПАН',
 color:'СВЕТЛО-БЕЖЕВЫЙ',size:'56',material:'ЗАМША ВЕЛЮР',
 length:'СТАНДАРТ',sourceType:'warehouse',variantId:145,
 stockWriteoffStatus:'fulfilled',shipmentSentQuantity:1,
 isWorkshop:false
}
const order={
 id:2326,external_id:'ORD-20261107074906-85953D6C',
 order_status:'active',shipping_status:'sent',created_at:'2026-11-07T07:49:06.607Z',
 updated_at:'2026-11-08T06:54:59.160Z',items:[item]
}
const shipped=buildOrderShipmentPlan(order,[
 {order_item_id:5537,quantity:1,status:'fulfilled',variant_id:145,inventory_source:'warehouse'}
])
assert.equal(shipped.lines.length,1)
assert.equal(shipped.selectedCount,0)
assert.equal(shipped.lines[0].readyQuantity,0)
assert.equal(shipped.lines[0].selectable,false,'Already sent SKU must not be dispatchable again')
assert.equal(shipped.lines[0].reason,'Уже отмечено как отправленное')
assert.equal(shipped.canConfirmIssuedOnly,false)

const closed=buildOrderShipmentPlan({...order,order_status:'deleted'},[])
assert.equal(closed.lines[0].reason,'Заказ закрыт')
const ready=buildOrderShipmentPlan(
 {...order,shipping_status:'not_sent',items:[{...item,stockWriteoffStatus:'reserved',shipmentSentQuantity:0}]},
 [{order_item_id:5537,quantity:1,status:'active',variant_id:145,inventory_source:'warehouse'}])
assert.equal(ready.lines[0].selectable,true,'Unshipped reserved item must remain selectable')
assert.equal(ready.lines[0].readyQuantity,1)

assert.equal(isOrderShipmentCompleteForActions(order),true,'Recorded sent order must have no primary send button')
assert.equal(projectOrderShipmentDisplay(order).state,'sent')
const mixedShipment={...order,shipping_status:'not_sent',items:[
  {...item,shipmentSentQuantity:1},
  {...item,id:5538,stockWriteoffStatus:'reserved',shipmentSentQuantity:0},
]}
assert.equal(projectOrderShipmentDisplay(mixedShipment).state,'partial')
assert.equal(projectOrderShipmentDisplay(mixedShipment).label,'Частично отправлено')
assert.equal(isOrderShipmentCompleteForActions(mixedShipment),false)
assert.equal(isOrderShipmentCompleteForActions({...order,items:[{...item,shipmentSentQuantity:0}]}),true,'Old sent order with stale per-item projection cannot be offered for re-send')
assert.equal(isOrderShipmentCompleteForActions({...order,shipping_status:'not_sent',items:[{...item,stockWriteoffStatus:'reserved',shipmentSentQuantity:0}]}),false)
assert.equal(isOrderShipmentCompleteForActions({
 ...order,
 items:[{...item}, {...item,id:6000,shipmentSentQuantity:0,pendingExchangeDispatchId:985,stockWriteoffStatus:'reserved'}],
}),false,'New exchange replacement must keep its shipment action after a previous order was sent')
assert.equal(isOrderShipmentCompleteForActions({
 ...order,
 items:[{...item,pendingExchangeWorkshopId:778,sourceType:'workshop',isWorkshop:true,shipmentSentQuantity:0}],
}),false,'Later workshop replacement must remain shippable')
assert.equal(isOrderShipmentCompleteForActions({...order,shipping_status:'not_sent',items:[{...item,shipmentSentQuantity:1}]}),true,'All physically dispatched item lines should not offer another shipment')

const app=fs.readFileSync('src/App.tsx','utf8')
const shipmentActions=fs.readFileSync('src/features/orders/orderTableDispatchActions.ts','utf8')
assert(app.includes('const requestId = orderListReadGuardRef.current.begin()'))
assert(app.includes('if (!isCurrentRead()) return null'), 'Do not publish older order responses')
assert(app.includes('if (isCurrentRead()) setBusy(false)'), 'Old loading callbacks must not unlock active reads')
assert(app.includes('return (await loadDashboard(false)) != null'),
 'Confirmed shipment should report whether the current list was refreshed')
assert(shipmentActions.includes('const finishCommittedShipment=async('))
assert(shipmentActions.includes('refreshed=(await onShipmentChange())!==false'))
assert(shipmentActions.includes('Список заказов не обновился'),
 'A committed shipment must not be presented as failed if only list refresh failed')
const ui=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const dispatchModal=fs.readFileSync('src/features/orders/OrderTableDispatchModal.tsx','utf8')
assert(ui.includes('<OrderTableDispatchModal'),'The table must keep the shipment history dialog accessible')
assert(ui.includes('const fullyShipped = isOrderShipmentCompleteForActions(order)'))
assert(ui.includes("fullyShipped ? `Отправлено${order.shipping_date ? ` · ${order.shipping_date}` : ''}` : shipmentDisplay.label"),
  'Delivery column must agree with the item-level partial shipment state')
assert(!ui.includes("order.shipping_status === 'sent' ? `Отправлено"),
  'Legacy whole-order flag cannot label a partial shipment as not sent')
assert(ui.includes('&& !fullyShipped ? ('),'Primary dispatch action must be hidden for sent orders')
assert(ui.includes("fullyShipped ? 'Отправлен' : shipmentDisplay.label"))
assert(ui.includes("fullyShipped && projection.lifecycleLabel === 'Активен'"))
assert(ui.includes('extraActionsOrderId === order.id && fullyShipped'),'Recorded shipment details must remain available only in extra actions')
assert(ui.includes('История отправок / исправить ошибку'))

assert(dispatchModal.includes('Уже отправлено — повторная отправка не нужна'))
assert(dispatchModal.includes('По учёту отправка уже проведена'))
assert(dispatchModal.includes('Исправить ошибочную отправку'))
assert(dispatchModal.includes('Отправлено: {x.dispatchedAt'))
assert(dispatchModal.includes("String(part).trim().toUpperCase()!=='СТАНДАРТ'"))
assert(dispatchModal.includes('Выбрать ${dispatchLineAccessibleName(line)}'))
assert(dispatchModal.includes('Количество ${dispatchLineAccessibleName(line)}'))
assert(!dispatchModal.includes('aria-label={`Выбрать ${line.productName}`}'))

const shipping=fs.readFileSync('worker/domains/order-dispatch.ts','utf8')
assert(shipping.includes("cleanText(order.shipping_status)==='sent'"),'Must not relax no-repeat shipping guard')
const correction=fs.readFileSync('worker/domains/order-dispatch-cancel.ts','utf8')
assert(correction.includes('restorePhysical'),'Correcting mistaken shipment must still reconcile actual stock movements')
console.log('MAIN_SHIPPING_ALREADY_SENT_PASS: sent order has no primary dispatch action, clear sent status, optional history in extra actions, new replacements still shippable, duplicate stock issue prohibited')
