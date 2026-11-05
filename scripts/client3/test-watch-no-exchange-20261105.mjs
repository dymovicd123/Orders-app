import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const get=p=>fs.readFileSync(p,'utf8')
const app=get('src/WatchClient3App.tsx')
const chrome=get('src/features/client3/Client3MainChrome.tsx')
const orders=get('src/features/client3/WatchOrdersPanel.tsx')
const corrections=get('src/features/client3/WatchOrderCorrections.tsx')
const finance=get('src/features/client3/WatchFinancePanel.tsx')
const reports=get('src/features/client3/WatchReportsPanel.tsx')
const returnsUI=get('src/features/client3/WatchReturnsPanel.tsx')
const returns=get('worker/domains/client3-watch-returns.ts')
const catalog=get('worker/domains/client3-watch-catalog-delete.ts')
const router=get('worker/domains/client3-watches.ts')
const orderRead=get('worker/domains/client3-watch-orders-read.ts')
const commercial=get('worker/domains/client3-watch-commercial.ts')
const projection=get('worker/domains/client3-watch-item-projection.ts')
const legacy=get('worker/domains/client3-watch-retired-dispatch.ts')
const guard=get('worker/index.ts')

for(const [name,source] of Object.entries({
 app,chrome,orders,corrections,finance,reports,returnsUI,orderRead,commercial,projection,legacy,
})){
 assert(!/Обмен|обмен|exchange/i.test(source)||name==='app'&&source.includes("section==='exchange'"),
  'New watches must have no exchange user-facing or read-only processing: '+name)
}
assert(app.includes("section==='exchange'")&&app.includes("window.history.replaceState(null,'','#orders')"),
 'Obsolete exchange deep links must redirect to orders')
assert(!orders.includes('WatchExchangeForm')&&!orders.includes('canOpenExchange'))
assert(!finance.includes('exchangeExtras')&&!reports.includes('exchangeExtras'))
assert(!router.includes('exchangeClient3WatchSet')&&!router.includes('cancelClient3WatchExchange'))
assert(router.includes("WATCH_EXCHANGE_DISABLED"))
assert(!returns.includes("UNION ALL")&&!returns.includes("exchange_items"))
assert(returns.includes("operationType:'return'")&&returns.includes('receiveReturnedItem'))
assert(!commercial.includes('FROM exchanges')&&!orderRead.includes('FROM exchanges'))
assert(!catalog.includes('exchange_items')&&catalog.includes("ev.operation_type='return'"))
assert(!legacy.includes('exchange_items')&&legacy.includes('retiredWithoutStockChange'))
for(const file of [
 'src/features/client3/WatchExchangeForm.tsx',
 'src/features/client3/WatchExchangeHistoryPanel.tsx',
 'worker/domains/client3-watch-exchange.ts',
 'worker/domains/client3-watch-exchange-set.ts',
 'worker/domains/client3-watch-exchange-history.ts',
])assert(!fs.existsSync(file),'Dead exchange module was not removed: '+file)
assert(guard.includes("env.CLIENT3_WATCHES === '1'"))

const server=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {Client3MainChrome}=await server.ssrLoadModule('/src/features/client3/Client3MainChrome.tsx')
 const html=renderToStaticMarkup(React.createElement(Client3MainChrome,{
  user:{id:1,role:'admin',login:'qa'},section:'orders',canSales:true,busy:false,
  onNavigate:()=>{},onLogout:()=>{},onRefresh:()=>{},
 },React.createElement('div',null,'Заказы')))
 assert(html.includes('Заказы')&&html.includes('Логистика'))
 assert(!html.includes('Обмен')&&!html.includes('Обмены'))
 const {WatchOrdersPanel}=await server.ssrLoadModule('/src/features/client3/WatchOrdersPanel.tsx')
 const orderHtml=renderToStaticMarkup(React.createElement(WatchOrdersPanel,{
  allowedBrands:['TAUWACH','WACHIZEN'],workflow:'orders',isAdmin:true,
 }))
 assert(orderHtml.includes('Список заказов')&&!orderHtml.includes('Обмен'))
 const {routeClient3Watches}=await server.ssrLoadModule('/worker/domains/client3-watches.ts')
 for(const path of [
  '/api/client3/watches/orders/11/exchange',
  '/api/client3/watches/orders/11/exchange-set',
  '/api/client3/watches/orders/11/exchanges/history',
  '/api/client3/watches/orders/11/exchanges/4/cancel',
 ]){
  const url=new URL('https://qa.client3.invalid'+path)
  const r=await routeClient3Watches(null,new Request(url,{method:'GET'}),url,{
   id:1,role:'admin',login:'qa',
  })
  assert.equal(r?.status,404,'Old exchange API must remain unavailable: '+path)
  const json=await r.json()
  assert.equal(json.code,'WATCH_EXCHANGE_DISABLED')
 }
 console.log('CLIENT3_QA_EXCHANGE_REMOVAL_PASS: orders, returns, finance, reports, deleted modules, guarded API')
}finally{await server.close()}
