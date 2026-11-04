import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import reactPlugin from '@vitejs/plugin-react'

const server=await createServer({
 configFile:false,plugins:[reactPlugin()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error',
})
try{
 const {WatchReturnForm}=await server.ssrLoadModule('/src/features/client3/WatchReturnForm.tsx')
 const {WatchExchangeHistoryPanel}=await server.ssrLoadModule('/src/features/client3/WatchExchangeHistoryPanel.tsx')
 const order={
   orderId:91,externalId:'WATCH-PARTIAL-91',shippingStatus:'not_sent',
   lineCount:2,receivedAmount:30000,returnAmount:0,
   itemLines:JSON.stringify([
     {id:1,productName:'ARYSTAN',quantity:1,returnableQuantity:1,unitPrice:5000,
      shipped:1,stockWriteoffStatus:'fulfilled',source:'warehouse',
      gender:'male',movement:'quartz',braceletMaterial:'steel',dialColor:'black',
      braceletColor:'',engravingText:''},
     {id:2,productName:'ALTYN ZAMAN',quantity:1,returnableQuantity:0,unitPrice:25000,
      shipped:0,stockWriteoffStatus:'reserved',source:'warehouse',
      gender:'male',movement:'quartz',braceletMaterial:'steel',dialColor:'silver',
      braceletColor:'',engravingText:''},
   ]),
 }
 const view=renderToStaticMarkup(React.createElement(WatchReturnForm,{
   brand:'TAUWACH',order,onDone:()=>{},onCancel:()=>{},
 }))
 assert(view.includes('ARYSTAN')&&view.includes('ALTYN ZAMAN')===false,
  'Physical return picker only shows previously issued watches')
 assert(view.includes('Стоимость выбранных часов по исходной цене продажи:'))
 assert(view.includes('5 000')||view.includes('5 000')||view.includes('5 000'),
  'Only the selected watch sale price is the suggested return value')
 assert(view.includes('max="30000"'),'Money-only refund still knows recorded available funds')
 assert(view.includes('value="5000"'),'A 5K physical return must not preselect all 30K of cash')
 assert(!view.includes('value="30000"'),
  'Partial return default cannot silently refund the whole payment')
 assert(view.includes('само по себе не уменьшает сумму заказа и долг'),
  'Do not imply Main has already corrected commercial total and debt')
 const exchangeView=renderToStaticMarkup(React.createElement(WatchExchangeHistoryPanel,{
   brand:'TAUWACH',orderId:91,onClose:()=>{},onDone:()=>{},
 }))
 assert(exchangeView.includes('История обменов'))
 console.log('CLIENT3_PARTIAL_REFUND_UI_PASS: price-based default, full money ceiling, explicit debt semantics and Main exchange history')
}finally{await server.close()}
