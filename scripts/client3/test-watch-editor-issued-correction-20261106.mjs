import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const read=path=>fs.readFileSync(path,'utf8')
const core=read('worker/domains/orders-write.ts')
const rewrite=read('worker/domains/client3-watch-admin-composition.ts')
const orderRead=read('worker/domains/client3-watch-orders-read.ts')
const editor=read('src/features/client3/WatchOrderCorrections.tsx')
const composition=read('src/features/client3/WatchAdminCompositionEditor.tsx')
const dispatch=read('worker/domains/client3-watch-dispatch-correction.ts')
const cancel=read('worker/domains/order-dispatch-cancel.ts')

for(const key of ["protectedRows","watchRewrite","held?.id","watch_variant_id",
 "engraving_text","preservedRewriteIndexes","preservedRewriteItemIds",
 "'fulfilled'","releaseOrderReservationsV2","retireOrderItemsForRewrite"]){
 assert(core.includes(key),'Main must preserve exact issued state: '+key)
}
assert(rewrite.includes('WATCH_REWRITE_ISSUED_PROTECTED'))
assert(rewrite.includes('WATCH_REWRITE_RETURNS'))
assert(rewrite.includes("oi.stock_writeoff_status='fulfilled'"))
assert(rewrite.includes("wp.brand_id=?"))
assert(orderRead.includes("'dispatchItemId'"))
assert(composition.includes('protectedIds')&&composition.includes('hasPartialDispatch'))
assert(composition.includes('isProtected'))
assert(editor.includes('dispatch-correction'))
assert(editor.includes('correctionConfirmed'))
assert(dispatch.includes('cancelExactOrderDispatchItem'))
assert(cancel.includes('restorePhysical')&&cancel.includes('needsStockCheck'))

const vite=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {WatchOrderCorrections}=await vite.ssrLoadModule('/src/features/client3/WatchOrderCorrections.tsx')
 const item={id:10,productName:'ARYSTAN',quantity:1,unitPrice:1000,lineTotal:1000,
  source:'warehouse',catalogPriceSnapshot:1000,engravingText:'',
  shippedQuantity:1,returnedQuantity:0,dispatchItemId:88}
 const order={
  orderId:1,externalId:'WATCH-1',orderDate:'2026-11-06',managerId:3,
  recipientName:'Тест',recipientPhone:'777',city:'Алматы',deliveryMethod:'Курьер',
  canonicalCustomerName:'Тест',canonicalCustomerPhone:'777',canonicalCity:'Алматы',
  canonicalDeliveryType:'Курьер',orderComment:'',shippingStatus:'sent',orderStatus:'active',
  deliveryAddress:'Адрес',postalCode:'050000',urgent:0,shippingDeadlineAt:'2026-11-07T12:00:00Z',
  totalAmount:1000,receivedAmount:500,debtAmount:500,returnAmount:0,
  committedReturnCount:0,paymentLines:'[]',itemLines:JSON.stringify([item]),
 }
 const html=(isAdmin,overrides={})=>renderToStaticMarkup(React.createElement(WatchOrderCorrections,{
  brand:'TAUWACH',order:{...order,...overrides},isAdmin,onDone:()=>{},onCancel:()=>{},
 }))
 assert(html(true).includes('Исправить ошибочную запись отправки'))
 assert(!html(false).includes('Исправить ошибочную запись отправки'))
 assert(!html(true,{itemLines:JSON.stringify([{...item,returnedQuantity:1}])})
  .includes('Исправить ошибочную запись отправки'))
 assert(!html(true,{itemLines:JSON.stringify([{...item,dispatchItemId:null}])})
  .includes('Исправить ошибочную запись отправки'))
 assert(html(true,{itemLines:JSON.stringify([{...item,dispatchItemId:null}])})
  .includes('Нужна сверка склада'))
 console.log('CLIENT3_EDITOR_ISSUED_PARTIAL_AND_DISPATCH_CORRECTION_PASS')
}finally{await vite.close()}
