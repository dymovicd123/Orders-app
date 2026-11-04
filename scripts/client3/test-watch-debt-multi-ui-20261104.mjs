import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import reactPlugin from '@vitejs/plugin-react'

const server=await createServer({
 configFile:false,plugins:[reactPlugin()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error',
})
try{
 const {WatchDebtPaymentForm}=await server.ssrLoadModule(
   '/src/features/client3/WatchDebtPaymentForm.tsx')
 const view=renderToStaticMarkup(React.createElement(WatchDebtPaymentForm,{
   brand:'TAUWACH',orderId:100,externalId:'WATCH-DEBT-100',debt:5000,
   onDone:()=>{},onCancel:()=>{},
 }))
 for(const word of [
   'Оплаты по долгу','+ Ещё способ оплаты','Останется после оплат','Способ оплаты',
   'Сохранить 1 оплат','WATCH-DEBT-100',
 ]){
   assert(view.includes(word),'Main-like debt view missing '+word)
 }
 assert(view.includes('name=')===false ||
   view.includes('Сумма'),'Debt editor must show editable amount')
 assert(!view.includes('История закрытия долгов'),
   'Debt history must not be embedded inside the payment form')
 const {WatchDebtWorkspace}=await server.ssrLoadModule(
   '/src/features/client3/WatchDebtWorkspace.tsx')
 const workspace=renderToStaticMarkup(React.createElement(WatchDebtWorkspace,{
   brands:['TAUWACH','ARYSTAN'],initialTarget:{
     brand:'TAUWACH',orderId:100,externalId:'WATCH-DEBT-100',
   },
 }))
 for(const word of ['Открытые долги','Форма закрытия долга','История закрытий',
  'Назад к таблице долгов']){
   assert(workspace.includes(word),'Dedicated Main debt workspace missing '+word)
 }
 const list=renderToStaticMarkup(React.createElement(WatchDebtWorkspace,{
   brands:['TAUWACH','ARYSTAN'],
 }))
 assert(list.includes('>Найти</button>'),'Debt search button must keep visible label')
 const app=fs.readFileSync('src/WatchClient3App.tsx','utf8')
 const orderPanel=fs.readFileSync('src/features/client3/WatchOrdersPanel.tsx','utf8')
 assert(app.includes("goTo('debts')")&&app.includes("panel==='debt'?'debts'")&&
   orderPanel.includes('onOpenDebt(brand,order.orderId,order.externalId)')&&
   !orderPanel.includes('<WatchDebtPaymentForm'),
   'Order debt action must navigate to separate tab, not inline form')
 const css=fs.readFileSync('src/styles/client3-qa-debt-20261104.css','utf8')
 assert(css.includes('.watch-main-debt-actions button[type=submit]') &&
   css.includes('background:#2563eb!important;color:white!important'),
   'Primary debt button needs explicit readable blue background and white text')
 for(const selector of [
   '.watch-debt-workspace .watch-debt-search button.primary',
   '.watch-debt-workspace .watch-debt-list-table td button.primary',
 ]){
   assert(css.includes(selector),'Debt action contrast rule missing '+selector)
 }
 assert(css.includes('background:#2563eb!important')&&
   css.includes('color:#fff!important')&&
   css.includes('min-width:126px;white-space:normal'),
   'Debt table and search buttons need explicit legible foreground/background and width')
 const ui=fs.readFileSync('src/features/client3/WatchDebtPaymentForm.tsx','utf8')
 assert(ui.includes('keys.current[part.id]') &&
   ui.includes('saved[part.id]') &&
   ui.includes('for(const part of parts)'),
   'Each part must have a stable idempotency key and skip recorded payment on retry')
 const logisticsCss=fs.readFileSync('src/styles/client3-watch-workshop-parity.css','utf8')
 assert(logisticsCss.includes('.watch-task-engraving strong{font-size:16px')&&
  logisticsCss.includes('.watch-task-client span{font-size:14px')&&
  logisticsCss.includes('.watch-task-client small{font-size:13px'),
  'Customer details and engraving must be operator-readable in logistics')
 console.log('CLIENT3_DEBT_MAIN_SEPARATE_TAB_AND_LEGIBLE_LOGISTICS_PASS')
}finally{
 await server.close()
}
