import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

// Main's real business projections and view markup are used by Client3.
const mainTable=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const watchTable=fs.readFileSync('src/features/client3/WatchOrdersPanel.tsx','utf8')
const watchRead=fs.readFileSync('worker/domains/client3-watch-orders-read.ts','utf8')
const watchReturns=fs.readFileSync('worker/domains/client3-watch-returns.ts','utf8')
assert(mainTable.includes('projectOrderOperationalState'))
assert(watchTable.includes('projectWatchOrderLikeMain'))
for(const mechanism of [
 'order-item-card','watch-main-method-chip','order-table-actions',
 'watch-main-finance-col','row-returned','Возврат','Обмен',
 'Отправить','Закрыть долг','Исправить','stockHandoverReviewNeeded',
 'committedReturnCount','committedExchangeCount',
])assert(watchTable.includes(mechanism),'Main operational table parity lacks '+mechanism)
assert(!watchTable.includes('>Подробнее</button>'), 'No redundant detail toggle in six-column orders grid')
assert(!watchTable.includes('>Доп. действия'), 'No nested action menu that hides core operations')
assert(!watchTable.includes('Требует поступления/резерва:'),
 'Availability warnings must not become a customer send-blocking label')
assert(watchRead.includes('committedItemReturnQuantity'))
assert(watchRead.includes('returnedQuantity'))
assert(watchRead.includes('committedExchangeCount'))
assert(watchReturns.includes('items:selected'))
assert(watchReturns.includes('paymentParts:refunds.map'),
 'Client3 must forward exact channels to the Main paymentParts contract')

const server=await createServer({
 configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error',
})
try{
 const {WatchOrdersPanel}=await server.ssrLoadModule('/src/features/client3/WatchOrdersPanel.tsx')
 const {WatchReturnForm}=await server.ssrLoadModule('/src/features/client3/WatchReturnForm.tsx')
 const {projectWatchOrderLikeMain}=await server.ssrLoadModule('/src/features/client3/watchMainOrderProjection.ts')
 const bareOperation=renderToStaticMarkup(React.createElement(WatchOrdersPanel,{
  workflow:'returns',allowedBrands:['TAUWACH'],isAdmin:true,
  onOpenOrders:()=>{},
 }))
 assert(bareOperation.includes('Откройте возврат из таблицы заказов'))
 assert(bareOperation.includes('К заказам'))
 assert(!bareOperation.includes('Поиск по заказу, ФИО или телефону'),
  'Main return workspace must not duplicate order selection table')
 assert(watchTable.includes("workflow==='orders'&&data&&(deletingOrder?<section")&&watchTable.includes("editingOrder?<section")&&watchTable.includes('watch-main-orders-table'),
  'Only All Orders may show the complete Main table and edit form separately')
 const item=(id,shipped,returned=0)=>({
   id,productName:id===1?'ARYSTAN':'ALTYN ZAMAN',quantity:1,
   returnedQuantity:returned,returnableQuantity:returned?0:1,
   shipped,stockWriteoffStatus:shipped?'fulfilled':'pending_reservation',
   source:'warehouse',gender:'male',movement:'quartz',
   braceletMaterial:'steel',dialColor:'black',braceletColor:'',engravingText:'',
 })
 const makeOrder=(lines,receivedAmount=2000,returnAmount=0)=>({
   orderId:10,externalId:'ORD-EXACT-TWO-WATCHES',
   shippingStatus:'not_sent',orderStatus:'active',
   totalAmount:10988,debtAmount:8988,
   receivedAmount,returnAmount,itemLines:JSON.stringify(lines),
   committedReturnCount:returnAmount>0?1:0,
   committedExchangeCount:0,committedItemReturnQuantity:lines.reduce((n,x)=>n+x.returnedQuantity,0),
 })
 const first=makeOrder([item(1,1),item(2,0)])
 const oneShipped=renderToStaticMarkup(React.createElement(WatchReturnForm,{
   brand:'TAUWACH',order:first,onDone:()=>{},onCancel:()=>{},
 }))
 assert(oneShipped.includes('ARYSTAN')&&oneShipped.includes('ALTYN ZAMAN'),
   'Exactly like Main, ALL ordered items must be shown, including the unissued one')
 assert(oneShipped.includes('Эти часы остаются у вас'),'Do not silently hide unissued SKU')
 assert(oneShipped.includes('Не выдавали'),'State of an unissued item must be explicit')
 assert(!oneShipped.includes('Вид возврата'), 'No invalid/blank custom return-type dropdown')
 assert(oneShipped.includes('Параметры возврата'))
 assert(oneShipped.includes('Ещё едет обратно')&&oneShipped.includes('Уже вернули'))
 const bothSent=makeOrder([item(1,1),item(2,1)])
 const both=renderToStaticMarkup(React.createElement(WatchReturnForm,{
   brand:'TAUWACH',order:bothSent,onDone:()=>{},onCancel:()=>{},
 }))
 assert(both.includes('ARYSTAN')&&both.includes('ALTYN ZAMAN'))
 assert.equal((both.match(/class="return-smart-check">✓/g)||[]).length,2,
   'Both previously issued eligible watches are preselected for physical return')
 const afterOne=makeOrder([item(1,1,1),item(2,1)],2000,2000)
 const remaining=renderToStaticMarkup(React.createElement(WatchReturnForm,{
   brand:'TAUWACH',order:afterOne,onDone:()=>{},onCancel:()=>{},
 }))
 assert(remaining.includes('Ранее возвращено: 1 шт.'))
 assert(remaining.includes('ALTYN ZAMAN'))
 assert(remaining.includes('Только товары'),'Refund exhausted must not hide a remaining item')
 const fullyDone=makeOrder([item(1,1,1),item(2,1,1)],2000,2000)
 const exhausted=renderToStaticMarkup(React.createElement(WatchReturnForm,{
   brand:'TAUWACH',order:fullyDone,onDone:()=>{},onCancel:()=>{},
 }))
 assert(exhausted.includes('Повторный возврат не будет создан'))
 assert(!exhausted.includes('<form'),'No empty return form when every physical and money claim is exhausted')
 const projection=projectWatchOrderLikeMain({
   ...afterOne,committedReturnCount:1,committedExchangeCount:1,
 })
 assert(projection.operational.canOpenReturn&&projection.operational.canOpenExchange,
   'Main does not turn prior returns/exchanges into terminal order status')
 assert(projection.operational.hasCommittedDownstreamOperation)
 assert(projection.shipment.state==='sent')
 console.log('CLIENT3_MAIN_RETURN_TABLE_PARITY_PASS: full item visibility, two-item preselect, previously returned, no blank kind, Main projection and direct actions')
}finally{await server.close()}
