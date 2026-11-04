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
   'Сохранить 1 оплат','История закрытия долгов','WATCH-DEBT-100',
 ]){
   assert(view.includes(word),'Main-like debt view missing '+word)
 }
 assert(view.includes('name=')===false ||
   view.includes('Сумма'),'Debt editor must show editable amount')
 const css=fs.readFileSync('src/styles/client3-qa-debt-20261104.css','utf8')
 assert(css.includes('.watch-main-debt-actions button[type=submit]') &&
   css.includes('background:#2563eb!important;color:white!important'),
   'Primary debt button needs explicit readable blue background and white text')
 const ui=fs.readFileSync('src/features/client3/WatchDebtPaymentForm.tsx','utf8')
 assert(ui.includes('keys.current[part.id]') &&
   ui.includes('saved[part.id]') &&
   ui.includes('for(const part of parts)'),
   'Each part must have a stable idempotency key and skip recorded payment on retry')
 console.log('CLIENT3_DEBT_MULTIMETHOD_MAIN_UI_PASS')
}finally{
 await server.close()
}
