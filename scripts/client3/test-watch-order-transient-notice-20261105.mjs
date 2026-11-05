import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const app=fs.readFileSync('src/WatchClient3App.tsx','utf8')
const chrome=fs.readFileSync('src/features/client3/Client3MainChrome.tsx','utf8')
const styles=fs.readFileSync('src/styles/client3-order-toast.css','utf8')
assert(app.includes('warning?8000:5000'),'Notice lifetime must be bounded even if a reserve is pending')
assert(app.includes('return ()=>window.clearTimeout(timer)'),'Old timers must be canceled on updates or unmount')
assert(app.includes("goTo('orders',true)"),'Saved-order confirmation must survive automatic open of orders page')
assert(app.includes("if(!preserveOrderNotice){setSuccess('');setWarning('')}"),
  'Unrelated navigation must dismiss old order notice')
assert(app.includes("onDismissNotice={()=>{setSuccess('');setWarning('')}}"),
  'The user must be able to close notices immediately')
assert(chrome.includes('(success||warning)&&<div'),'Success and reserve warning must share one notice')
assert(!chrome.includes('warning&&<div className="app-alert global-alert"'),
  'Do not stack a second permanent reserve banner')
assert(styles.includes('position:fixed'),'Transient notices must not permanently occupy layout')
assert(styles.includes('max-width:calc(100vw - 32px)'),'Toast must not overflow small screens')
const server=await createServer({configFile:false,plugins:[react()],appType:'custom',
  server:{middlewareMode:true},logLevel:'error'})
try{
  const {Client3MainChrome}=await server.ssrLoadModule('/src/features/client3/Client3MainChrome.tsx')
  const user={id:1,role:'admin',displayName:'Проверка',login:'admin'}
  const props={user,section:'orders',canSales:true,busy:false,
    onNavigate:()=>{},onLogout:()=>{},onRefresh:()=>{},onDismissNotice:()=>{}}
  const html=renderToStaticMarkup(React.createElement(Client3MainChrome,{
    ...props,success:'Заказ ORD-100 сохранён. Товар не отправлен.',
    warning:'Часть часов ожидает резервирования.',
  },React.createElement('section',null,'Заказы')))
  assert.equal((html.match(/class="client3-order-toast /g)||[]).length,1,
    'Exactly one combined order notification')
  assert(html.includes('Заказ ORD-100 сохранён'))
  assert(html.includes('Часть часов ожидает резервирования.'))
  assert(html.includes('aria-label="Закрыть уведомление"'))
  assert(!html.includes('class="app-alert global-alert" role="alert"'))
  const bare=renderToStaticMarkup(React.createElement(Client3MainChrome,props,
    React.createElement('section',null,'Заказы')))
  assert(!bare.includes('client3-order-toast has-warning'))
  assert(!bare.includes('client3-order-toast-text'))
  const warningOnly=renderToStaticMarkup(React.createElement(Client3MainChrome,{
    ...props,warning:'Резерв не подтверждён.',
  },null))
  assert(warningOnly.includes('Резерв не подтверждён.'))
  assert.equal((warningOnly.match(/class="client3-order-toast /g)||[]).length,1)
  console.log('CLIENT3_ORDER_TRANSIENT_NOTICE_PASS: combined toast, dismiss, navigation, timeout, SSR')
}finally{await server.close()}
