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

const ui=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(ui.includes('Уже отправлено — повторная отправка не нужна'))
assert(ui.includes('По учёту отправка уже проведена'))
assert(ui.includes('Исправить ошибочную отправку'))
assert(ui.includes('Отправлено: {x.dispatchedAt'))
assert(ui.includes("String(part).trim().toUpperCase()!=='СТАНДАРТ'"))
const shipping=fs.readFileSync('worker/domains/order-dispatch.ts','utf8')
assert(shipping.includes("cleanText(order.shipping_status)==='sent'"),'Must not relax no-repeat shipping guard')
const correction=fs.readFileSync('worker/domains/order-dispatch-cancel.ts','utf8')
assert(correction.includes('restorePhysical'),'Correcting mistaken shipment must still reconcile actual stock movements')
console.log('MAIN_SHIPPING_ALREADY_SENT_PASS: sent lines are blocked, active reserved lines selectable, closed distinct, manager sees explicit correction and time, duplicate issue prohibited')
