import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const src=p=>fs.readFileSync(p,'utf8')
const orders=src('src/features/client3/WatchOrdersPanel.tsx')
const editor=src('src/features/client3/WatchOrderCorrections.tsx')
const admin=src('src/features/client3/WatchAdminOrderActions.tsx')
const sagaUI=src('src/features/client3/WatchAdminDeleteChainPanel.tsx')
const sagaServer=src('worker/domains/client3-watch-admin-order.ts')
const paymentServer=src('worker/domains/client3-watch-admin-payment-method.ts')
const router=src('worker/domains/client3-watches.ts')
const app=src('src/WatchClient3App.tsx')
const ordersRead=src('worker/domains/client3-watch-orders-read.ts')

for(const phrase of ['watch-main-edit-workspace','deletingOrder?<section','watch-order-delete-direct',
 'Полное редактирование','Удалить заказ</button>']){
 assert(orders.includes(phrase),'Main-style order edit/delete must be visible: '+phrase)
}
for(const phrase of ['Оплаты, менеджер и удаление','Реквизиты','Записанная цена',
 'Состав товаров','Отменить возврат','Отменить обмены']){
 assert(editor.includes(phrase),'Editor missing '+phrase)
}
assert(admin.includes('WatchAdminDeleteChainPanel')&&!admin.includes('setAck('))
for(const token of ['delete-chain','delete-physical-confirm',"for(let n=0;n<125;n++)",
 "status==='completed'","['planned','running','ready_for_final_delete']"]){
 assert(sagaUI.includes(token),'Saga UI is not safely resumable: '+token)
}
for(const token of ['readActiveAdminDeleteChain','executeAdminDeleteChainStep',
 'correctPhysicalBeforeAdminDelete','WATCH_DELETE_SAGA_SCHEMA_REQUIRED',
 "actor?.role==='admin'","watchOrder(db,brandId,orderId)"]){
 assert(sagaServer.includes(token),'Brand/auth-scoped saga server missing '+token)
}
for(const token of ['correctClient3AdminRecordedPayment','expectedPaymentDate',
 'expectedOrderDate','paymentCorrections']){
 assert(paymentServer.includes(token),'Recorded payment safety check missing '+token)
}
for(const token of ['client3AdminDeleteChain(db','client3AdminDeletePhysicalConfirm(db',
 'correctClient3AdminRecordedPayment(db']){
 assert(router.includes(token),'Order route unconnected: '+token)
}
assert(ordersRead.includes('committedReturnCount')&&ordersRead.includes('committedExchangeCount'),
 'Order history totals must be available to role editor')
assert(app.includes('workflow="returns"')&&app.includes('workflow="exchange"'),
 'Both return and exchange order selection must use explicit workflow mode')
assert(orders.includes('<WatchDebtPaymentForm')&&orders.includes("setDebtOrderId"),
 'Existing in-order debt closure must remain accessible')
const server=await createServer({
 configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error',
})
try{
 const {WatchOrdersPanel}=await server.ssrLoadModule('/src/features/client3/WatchOrdersPanel.tsx')
 const orderView=renderToStaticMarkup(React.createElement(WatchOrdersPanel,{
  allowedBrands:['TAUWACH','WACHIZEN'],isAdmin:true,
 }))
 assert(orderView.includes('Список заказов'))
 const {WatchOrderCorrections}=await server.ssrLoadModule('/src/features/client3/WatchOrderCorrections.tsx')
 const order={
  orderId:777,externalId:'W-777',orderDate:'2026-11-05',managerId:1,
  recipientName:'QA',recipientPhone:'777',city:'Алматы',deliveryMethod:'Курьер',
  canonicalCustomerName:'QA',canonicalCustomerPhone:'777',
  canonicalCity:'Алматы',canonicalDeliveryType:'Курьер',orderComment:'',
  shippingStatus:'not_sent',orderStatus:'active',deliveryAddress:'Улица 7',
  postalCode:'050000',urgent:0,shippingDeadlineAt:'2026-11-06T12:00:00Z',
  totalAmount:10000,receivedAmount:0,debtAmount:10000,returnAmount:0,
  committedReturnCount:1,committedExchangeCount:1,paymentLines:'[]',
  itemLines:JSON.stringify([{id:11,productName:'ARYSTAN',quantity:1,
   unitPrice:10000,lineTotal:10000,source:'warehouse',
   catalogPriceSnapshot:10000,engravingText:''}])
 }
 const adminView=renderToStaticMarkup(React.createElement(WatchOrderCorrections,{
  brand:'TAUWACH',order,isAdmin:true,onDone:()=>{},onCancel:()=>{},
 }))
 assert(adminView.includes('Оплаты, менеджер и удаление'))
 assert(adminView.includes('Отменить обмены'))
 const managerView=renderToStaticMarkup(React.createElement(WatchOrderCorrections,{
  brand:'TAUWACH',order,isAdmin:false,onDone:()=>{},onCancel:()=>{},
 }))
 assert(!managerView.includes('Оплаты, менеджер и удаление'))
 console.log('CLIENT3_RELEASE_ORDER_EDITOR_DELETE_ROLE_SCOPE_PASS')
}finally{
 await server.close()
}
