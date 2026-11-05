import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const read=p=>fs.readFileSync(p,'utf8')
const app=read('src/WatchClient3App.tsx')
const chrome=read('src/features/client3/Client3MainChrome.tsx')
const router=read('worker/domains/client3-watches.ts')
for(const [label,source] of [['app',app],['chrome',chrome],['router',router]]){
 assert(!source.includes('Исторические заказы'),'The old standalone history section is still visible in '+label)
 assert(!source.includes('WatchLegacyOrdersPanel'),'Legacy orders panel is still loaded by '+label)
 assert(!source.includes('listLegacyClient3Orders'),'Legacy API is still loaded by '+label)
}
assert(!app.includes("activeSection==='legacy'"),'Legacy route must not render')
assert(!app.includes("panel.kind==='activity'"),'Legacy tab must not be available')
assert(!chrome.includes("legacy:{"),'Legacy chrome metadata must be removed')
assert(app.includes("section==='exchange'||section==='legacy'"),'Old bookmarks must redirect safely')
assert(!router.includes("url.pathname==='/api/client3/watches/legacy-orders'"))
assert(!fs.existsSync('src/features/client3/WatchLegacyOrdersPanel.tsx'),'Unreachable legacy client module must be absent')
assert(!fs.existsSync('worker/domains/client3-watch-legacy.ts'),'Unreachable legacy API module must be absent')
assert(!app.includes("['orders','create','returns','legacy']"))
assert(app.includes("['orders','create','returns'].includes(activeSection)"))
assert(app.includes('WatchOrdersPanel')&&app.includes('WatchReturnForm')===false)
assert(app.includes('WatchOrderForm')&&app.includes('WatchReturnsPanel'))
const server=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {Client3MainChrome}=await server.ssrLoadModule('/src/features/client3/Client3MainChrome.tsx')
 const view=renderToStaticMarkup(React.createElement(Client3MainChrome,{
  user:{id:1,role:'admin',displayName:'Проверка'},section:'orders',busy:false,canSales:true,
  onNavigate:()=>{},onLogout:()=>{},onRefresh:()=>{},
 },React.createElement('div',null,'Обычные заказы')))
 assert(view.includes('Заказы'))
 assert(!view.includes('Исторические заказы'))
 const {routeClient3Watches}=await server.ssrLoadModule('/worker/domains/client3-watches.ts')
 const path='/api/client3/watches/legacy-orders'
 const url=new URL('https://qa.example.invalid'+path)
 const response=await routeClient3Watches(null,new Request(url),url,{id:1,role:'admin'})
 assert.equal(response?.status,404,'Removed historical-orders endpoint must return 404')
 assert.equal((await response.json()).code,'WATCH_ROUTE_NOT_FOUND')
 console.log('CLIENT3_HIDE_LEGACY_ORDERS_PASS: no tab, no module, no route; orders and returns preserved')
}finally{await server.close()}