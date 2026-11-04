import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const read=path=>fs.readFileSync(path,'utf8')
const main=read('src/features/sections/OrdersTableSection.tsx')
const editor=read('src/features/client3/WatchOrderCorrections.tsx')
const admin=read('src/features/client3/WatchAdminOrderActions.tsx')
const saga=read('src/features/client3/WatchAdminDeleteChainPanel.tsx')
const adminDomain=read('worker/domains/client3-watch-admin-order.ts')
const adapter=read('worker/domains/client3-watches.ts')
const chain=read('worker/domains/client3-watch-exchange-chain.ts')
const cancelUI=read('src/features/client3/WatchExchangeCancelChainPanel.tsx')
const exchangeUI=read('src/features/client3/WatchExchangeForm.tsx')
const exchangeServer=read('worker/domains/client3-watch-exchange-set.ts')
const orderList=read('src/features/client3/WatchOrdersPanel.tsx')

for(const label of ['Исправить реквизиты','Исправить записанную цену',
 'Отменить обмены','Отменить возврат','Редактировать','Удалить']){
 assert(main.includes(label),'Main editor/operation missing: '+label)
}
for(const label of ['Реквизиты','Записанная цена','Данные часов и логистики',
 'Состав товаров','Оплаты, менеджер и удаление',
 'Отменить возврат','Отменить обмены']){
 assert(editor.includes(label),'Client3 role editor does not expose '+label)
}
assert(orderList.includes('Полное редактирование')&&
 orderList.includes('Доп. действия'),'Admin/manager entry points need separate labels')
assert(admin.includes('WatchAdminDeleteChainPanel')&&
 !admin.includes('setAck('),'Admin deletion must use integrated Main saga, not old one-click form')
assert(saga.includes('delete-chain')&&
 saga.includes('delete-physical-confirm')&&
 saga.includes('for(let n=0;n<125;n++)')&&
 saga.includes("status==='completed'")&&
 saga.includes("['planned','running','ready_for_final_delete']"),
 'Main delete saga must be resumable, strictly progressive and status-gated')
for(const token of ['previewAdminOrderDeletion','readActiveAdminDeleteChain',
 'executeAdminDeleteChainStep','correctPhysicalBeforeAdminDelete',
 "actor?.role==='admin'",'watchOrder(db,brandId,orderId)',
 'WATCH_DELETE_SAGA_SCHEMA_REQUIRED']){
 assert(adminDomain.includes(token),'Protected scoped deletion missing: '+token)
}
assert(adapter.includes('client3AdminDeleteChain')&&
 adapter.includes('client3AdminDeletePhysicalConfirm')&&
 adapter.includes('previewClient3WatchExchangeCancellationPlan'),
 'Client3 scoped routes for Main cancellation must be connected')
assert(chain.includes('previewExchangeCancellationChain')&&
 chain.includes('manualReviewRequired')&&chain.includes('indegree')&&
 cancelUI.includes('fresh.signature!==plan.signature')&&
 cancelUI.includes("step.type==='return'")&&
 cancelUI.includes('Отменить выбранные обмены'),
 'Exchange reversal must preflight dependency graph and recheck before each Main operation')
assert(!exchangeUI.includes('Уже отправили</button>')&&
 !exchangeUI.includes('issuePossessionConfirmed:e.target.checked')&&
 exchangeUI.includes("shipmentState:'pending' as const")&&
 exchangeServer.includes("line.shipmentState!=='pending'")&&
 exchangeServer.includes("shipmentState:'pending'"),
 'Exchange cannot record replacement dispatch outside Logistics')
const server=await createServer({
 configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error',
})
try{
 const {WatchOrderCorrections}=await server.ssrLoadModule(
  '/src/features/client3/WatchOrderCorrections.tsx')
 const order={
  orderId:777,externalId:'W-777',orderDate:'2026-11-04',managerId:1,
  recipientName:'Тест',recipientPhone:'777',city:'Алматы',deliveryMethod:'Курьер',
  canonicalCustomerName:'Тест',canonicalCustomerPhone:'777',
  canonicalCity:'Алматы',canonicalDeliveryType:'Курьер',orderComment:'',
  shippingStatus:'not_sent',orderStatus:'active',deliveryAddress:'Улица 7',
  postalCode:'050000',urgent:0,shippingDeadlineAt:'2026-11-05T12:00:00Z',
  totalAmount:10000,receivedAmount:0,debtAmount:10000,returnAmount:0,
  committedReturnCount:1,committedExchangeCount:1,paymentLines:'[]',
  itemLines:JSON.stringify([{id:11,productName:'ARYSTAN',quantity:1,
    unitPrice:10000,lineTotal:10000,source:'warehouse',
    catalogPriceSnapshot:10000,engravingText:''}]),
 }
 const adminView=renderToStaticMarkup(React.createElement(WatchOrderCorrections,{
  brand:'TAUWACH',order,isAdmin:true,onDone:()=>{},onCancel:()=>{},
 }))
 for(const label of ['Оплаты, менеджер и удаление','Отменить возврат','Отменить обмены',
   'Состав товаров'])assert(adminView.includes(label),'Admin UI missing '+label)
 const managerView=renderToStaticMarkup(React.createElement(WatchOrderCorrections,{
  brand:'TAUWACH',order,isAdmin:false,onDone:()=>{},onCancel:()=>{},
 }))
 assert(managerView.includes('Реквизиты')&&managerView.includes('Записанная цена')&&
   managerView.includes('Отменить возврат')&&managerView.includes('Отменить обмены')&&
   !managerView.includes('Оплаты, менеджер и удаление')&&
   !managerView.includes('Состав товаров'),
   'Manager must see only safely delegated actions')
 console.log('CLIENT3_MAIN_ROLE_EDITOR_CHAIN_AND_LOGISTICS_ONLY_PASS')
}finally{await server.close()}
