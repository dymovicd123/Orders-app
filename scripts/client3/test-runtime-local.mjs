import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn,spawnSync } from 'node:child_process'
import { prepareMigrations,renderConfig } from './prepare.mjs'

const db='orders_db_client3_smoke',worker='orders-app-client3-smoke'
const id='e7c30000-0000-4000-8000-00000000c1e3'
const secret='Client3LocalSmokeBootstrapSecret2026-NotForProduction'
const config='wrangler.client3.json',migrations='.client3-migrations',state='.client3-local-state'
const url='http://127.0.0.1:8799'
const npx=process.platform==='win32'?'npx.cmd':'npx'
let dev=null,log=''
const remove=()=>{for(const p of [config,migrations,state])fs.rmSync(p,{recursive:true,force:true})}
function run(label,args,timeout=240000){
 const r=spawnSync(npx,['wrangler',...args],{encoding:'utf8',timeout,maxBuffer:48*1024*1024})
 if(r.error||r.status!==0)throw Error(label+' failed '+(r.status??r.error)+'\n'+((r.stdout||'')+'\n'+(r.stderr||'')).slice(-5500))
 console.log('PASSED '+label+' '+(r.stdout||'').slice(-500))
 return r
}
async function get(urlPath,opts={}){
 const response=await fetch(url+urlPath,{...opts,signal:AbortSignal.timeout(15000)})
 const body=await response.text()
 return {status:response.status,body,cookie:response.headers.get('set-cookie')||''}
}
const pause=t=>new Promise(ok=>setTimeout(ok,t))
try{
 for(const p of [config,migrations,state])assert(!fs.existsSync(p),'Refusing to overwrite existing third-tenant resource '+p)
 prepareMigrations(migrations)
 fs.writeFileSync(config,renderConfig(worker,db,id),{flag:'wx',mode:0o600})
 run('local clean Client3 migrations',['d1','migrations','apply',db,'--local','--config',config,'--persist-to',state],360000)
 dev=spawn(npx,['wrangler','dev','--config',config,'--local','--port','8799','--persist-to',state,'--var','ADMIN_MODE_PASSWORD:'+secret],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'true'}})
 dev.stdout?.on('data',x=>{log=(log+String(x)).slice(-16000)})
 dev.stderr?.on('data',x=>{log=(log+String(x)).slice(-16000)})
 let live=false
 for(let i=0;i<80;i++){
   if(dev.exitCode!==null)throw Error('Worker exited at startup: '+log)
   try{const h=await get('/api/health');if(h.status===200){live=true;break}}catch{}
   await pause(400)
 }
 assert(live,'Local Client3 Worker did not start: '+log)
 assert.equal((await get('/api/orders')).status,401,'Public Orders must be denied')
 assert.equal((await get('/api/catalog')).status,401,'Public Catalog must be denied')
 const headers={'Content-Type':'application/json'}
 const call=body=>get('/api/auth/setup',{method:'POST',headers,body:JSON.stringify(body)})
 const setup={login:'client3admin',password:'LocalTestOnlyAdminPassword2026!',displayName:'Third smoke admin',bootstrapLogin:'admin'}
 const wrong=await call({...setup,bootstrapPassword:'admin'})
 assert.equal(wrong.status,401,'Default bootstrap password must be rejected: '+wrong.body)
 const created=await call({...setup,bootstrapPassword:secret})
 assert.equal(created.status,201,'First admin setup failed: '+created.body)
 assert(created.cookie.includes('orders_session'),'Auth setup must return cookie')
 const repeated=await call({...setup,bootstrapPassword:secret})
 assert.equal(repeated.status,409,'Second admin bootstrap must not create another admin: '+repeated.body)
 const authenticated={headers:{Cookie:created.cookie.split(';')[0]}}
 for(const urlPath of ['/api/orders','/api/catalog','/api/reference-data']){
   const r=await get(urlPath,authenticated)
   assert.equal(r.status,200,'Authorized initial '+urlPath+' did not work: '+r.body.slice(0,350)+' | Worker logs: '+log.slice(-5000))
 }
 // The actual Worker must complete a REAL business write on the isolated local D1;
 // source-text assertions or empty GET endpoints are not sufficient.
 const addPerson=await get('/api/team/employees',{
   method:'POST',headers:{...headers,...authenticated.headers},
   body:JSON.stringify({name:'CLIENT3_SMOKE_MANAGER',role:'менеджер'})
 })
 assert.equal(addPerson.status,201,'Creating the first staff member failed: '+addPerson.body.slice(0,400)+' logs '+log.slice(-2300))
 const employee=JSON.parse(addPerson.body)
 const managerId=Number(employee.employeeId||employee.employee?.id)
 assert(managerId>0,'Employee ID missing')
 const createPayload={
   requestId:'f38c622e-7db6-4ba1-b00a-11dce3000123',
   orderDate:'2026-10-20',managerId,managerName:'CLIENT3_SMOKE_MANAGER',
   sourceType:'warehouse',workshopStatus:'in_workshop',pricingMode:'itemized_v1',
   orderPaymentMethod:'НАЛИЧКА',
   items:[{productName:'CLIENT3_SMOKE_PRODUCT',gender:'ЖЕН',color:'БЕЖЕВЫЙ',
     material:'СТАНДАРТ',length:'СТАНДАРТ',size:'48',sourceType:'workshop',
     isWorkshop:true,quantity:1,unitPrice:10000}],
   payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',amount:10000,paymentKind:'primary'}]
 }
 const create=()=>get('/api/orders',{method:'POST',headers:{...headers,...authenticated.headers,'X-Idempotency-Key':createPayload.requestId},body:JSON.stringify(createPayload)})
 const createdOrder=await create()
 assert.equal(createdOrder.status,201,'Creating a paid workshop order failed: '+createdOrder.body.slice(0,700)+' logs '+log.slice(-2500))
 const saved=JSON.parse(createdOrder.body)
 const orderId=Number(saved.order?.id||saved.id||saved.orderId)
 assert(orderId>0,'Created order id missing: '+createdOrder.body.slice(0,700))
 const exact=await get('/api/orders/'+orderId,authenticated)
 assert.equal(exact.status,200,'Reading newly created order failed: '+exact.body.slice(0,600)+' logs '+log.slice(-2400))
 const second=await create()
 assert([200,201].includes(second.status),'Idempotent replay errored: '+second.status+' '+second.body.slice(0,400))
 const list=await get('/api/orders',authenticated)
 assert.equal(list.status,200,'Listing order after creation failed: '+list.body.slice(0,400))
 console.log('CLIENT3_REAL_WORKER_ORDER_CREATE_PAYMENT_READ_AND_RETRY_PASSED: order '+orderId)
 // Money-only return on an unshipped workshop order: no phantom stock is created,
 // and replay must not apply a second refund.
 const returnedPayload={requestId:'ac19d0ce-2026-40be-9000-000000000a31',orderId,
   returnDate:'2026-10-20',amount:2500,paymentMethod:'НАЛИЧКА',items:[],comment:'client3 fixture money-only refund'}
 const refund=()=>get('/api/returns',{method:'POST',headers:{...headers,...authenticated.headers,'X-Idempotency-Key':returnedPayload.requestId},
   body:JSON.stringify(returnedPayload)})
 const firstRefund=await refund()
 assert.equal(firstRefund.status,201,'Money-only return failed: '+firstRefund.body.slice(0,800)+' logs '+log.slice(-2300))
 const replayRefund=await refund()
 assert.equal(replayRefund.status,201,'Money-only return idempotent retry failed: '+replayRefund.body.slice(0,800))
 const afterRefund=await get('/api/orders/'+orderId,authenticated)
 assert.equal(afterRefund.status,200,'Order read after refund failed: '+afterRefund.body.slice(0,450))
 const afterRefundOrder=JSON.parse(afterRefund.body).order
 assert.equal(Number(afterRefundOrder.return_amount),2500,'Money-only refund was duplicated or lost')
 assert.equal(Number(afterRefundOrder.received_amount),10000,'Money-only refund mutated inbound payments')
 console.log('CLIENT3_REAL_WORKER_MONEY_ONLY_RETURN_AND_REPLAY_PASSED: refund 2500 exactly once')
 // A separately created unpaid order must accept a partial debt payment exactly once.
 const debtPayload={...createPayload,requestId:'ac19d0ce-2026-40be-9000-000000000a32',payments:[]}
 const debtCreate=await get('/api/orders',{method:'POST',headers:{...headers,...authenticated.headers,
   'X-Idempotency-Key':debtPayload.requestId},body:JSON.stringify(debtPayload)})
 assert.equal(debtCreate.status,201,'Unpaid order create failed: '+debtCreate.body.slice(0,600))
 const debtOrderId=Number(JSON.parse(debtCreate.body).order?.id||JSON.parse(debtCreate.body).orderId||JSON.parse(debtCreate.body).id)
 assert(debtOrderId>0,'Debt order ID missing')
 const payment={requestId:'ac19d0ce-2026-40be-9000-000000000a33',orderId:debtOrderId,
   paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'debt_close',amount:3500}
 const pay=()=>get('/api/payments',{method:'POST',headers:{...headers,...authenticated.headers,
   'X-Idempotency-Key':payment.requestId},body:JSON.stringify(payment)})
 const firstPay=await pay()
 assert.equal(firstPay.status,201,'Debt payment failed: '+firstPay.body.slice(0,650))
 const secondPay=await pay()
 assert.equal(secondPay.status,201,'Debt payment idempotent retry failed: '+secondPay.body.slice(0,650))
 const afterPay=await get('/api/orders/'+debtOrderId,authenticated)
 assert.equal(afterPay.status,200,'Debt order read after payment failed')
 const debtOrder=JSON.parse(afterPay.body).order
 assert.equal(Number(debtOrder.total_amount),10000,'Debt order total changed unexpectedly')
 assert.equal(Number(debtOrder.received_amount),3500,'Debt payment not exactly once')
 assert.equal(Number(debtOrder.debt_amount),6500,'Debt balance inconsistent after retry')
 console.log('CLIENT3_REAL_WORKER_PARTIAL_PAYMENT_LEDGER_AND_REPLAY_PASSED: paid 3500/debt 6500')
 // Perform an actual itemized workshop exchange against the indebted order,
 // with no stock handover and no money adjustment. Exact price snapshots prevent
 // unintended price changes while the old task is replaced by a new one.
 const oldLine=debtOrder.items?.[0]
 assert(oldLine?.id>0,'Created workshop item not available for exchange')
 const exchangePayload={
   requestId:'ac19d0ce-2026-40be-9000-000000000a34',
   orderId:debtOrderId,exchangeDate:'2026-10-20',
   oldItemId:oldLine.id,oldQuantity:1,oldPhysicalState:'not_issued',
   expectedOrderTotal:10000,expectedOldActiveQuantity:1,
   expectedOldUnitPrice:10000,expectedOldLineTotal:10000,
   expectedOldCatalogPriceSnapshot:null,
   financialAction:'none',financialAmount:0,
   newItem:{
     productName:'CLIENT3_SMOKE_REPLACEMENT',gender:'ЖЕН',color:'БЕЛЫЙ',
     material:'СТАНДАРТ',length:'СТАНДАРТ',size:'48',sourceType:'workshop',
     quantity:1,unitPrice:10000,catalogPriceSnapshot:null
   }
 }
 const exchange=()=>get('/api/exchanges',{method:'POST',
   headers:{...headers,...authenticated.headers,'X-Idempotency-Key':exchangePayload.requestId},
   body:JSON.stringify(exchangePayload)})
 const firstExchange=await exchange()
 assert.equal(firstExchange.status,201,'Workshop exchange failed: '+firstExchange.body.slice(0,1100)+' logs '+log.slice(-3000))
 const retryExchange=await exchange()
 assert.equal(retryExchange.status,201,'Workshop exchange replay failed: '+retryExchange.body.slice(0,800))
 const updatedExchangeOrder=await get('/api/orders/'+debtOrderId,authenticated)
 assert.equal(updatedExchangeOrder.status,200,'Reading order after exchange failed')
 const exchangeOrder=JSON.parse(updatedExchangeOrder.body).order
 assert.equal(Number(exchangeOrder.total_amount),10000,'No-money exchange changed total')
 assert.equal(Number(exchangeOrder.received_amount),3500,'No-money exchange changed received payments')
 assert.equal(Number(exchangeOrder.debt_amount),6500,'No-money exchange changed debt')
 const activeItems=(exchangeOrder.items||[]).filter(x=>Number(x.quantity)>0)
 assert.equal(activeItems.length,1,'Exchange did not replace one active line exactly once: '+JSON.stringify(activeItems).slice(0,550))
 assert.equal(activeItems[0].productName||activeItems[0].product_name_snapshot,'CLIENT3_SMOKE_REPLACEMENT','Exchange did not install replacement item')
 console.log('CLIENT3_REAL_WORKER_EXCHANGE_NO_MONEY_AND_REPLAY_PASSED: correct active item and debt preserved')
 // Cancel the exchange and verify exact restoration of the old item, settled money
 // and the Workshop task. Repeating cancellation must not revive extra quantities.
 const exchangePlan=await get('/api/orders/'+debtOrderId+'/exchange-cancel-chain',authenticated)
 assert.equal(exchangePlan.status,200,'Exchange cancel preview failed: '+exchangePlan.body.slice(0,900))
 const activeExchanges=JSON.parse(exchangePlan.body).availableExchangeIds||[]
 assert.equal(activeExchanges.length,1,'Expected one active exchange to cancel')
 const cancelExchangeBody={requestId:'ac19d0ce-2026-40be-9000-000000000a40',comment:'client3 isolated cancellation fixture'}
 const undoExchange=()=>get('/api/exchanges/'+activeExchanges[0]+'/cancel',{method:'PATCH',
   headers:{...headers,...authenticated.headers,'X-Idempotency-Key':cancelExchangeBody.requestId},
   body:JSON.stringify(cancelExchangeBody)})
 const exchangeCancelled=await undoExchange()
 assert.equal(exchangeCancelled.status,200,'Exchange cancellation failed: '+exchangeCancelled.body.slice(0,1100)+' logs '+log.slice(-1800))
 const exchangeCancelReplay=await undoExchange()
 assert.equal(exchangeCancelReplay.status,200,'Exchange cancellation retry failed: '+exchangeCancelReplay.body.slice(0,800))
 const restoredOrder=JSON.parse((await get('/api/orders/'+debtOrderId,authenticated)).body).order
 const restoredItems=(restoredOrder.items||[]).filter(x=>Number(x.quantity)>0)
 assert.equal(restoredItems.length,1,'Exchange cancellation failed to restore exactly one original item')
 assert.equal(Number(restoredItems[0].id),Number(oldLine.id),'Exchange cancellation restored wrong item')
 assert.equal(Number(restoredOrder.total_amount),10000,'Cancellation corrupted total')
 assert.equal(Number(restoredOrder.received_amount),3500,'Cancellation corrupted inbound funds')
 assert.equal(Number(restoredOrder.debt_amount),6500,'Cancellation corrupted debt')
 console.log('CLIENT3_REAL_WORKER_EXCHANGE_CANCEL_AND_REPLAY_PASSED: original item restored, money unchanged')
 // Cancel a money-only return. The refund reversal must be reflected in history,
 // without a new payment or a stock movement.
 const returnOptions=await get('/api/orders/'+orderId+'/return-cancel-choices',authenticated)
 assert.equal(returnOptions.status,200,'Return cancel choices failed: '+returnOptions.body.slice(0,800))
 const returnChoice=(JSON.parse(returnOptions.body).choices||[]).find(x=>Number(x.amount)===2500)
 assert(returnChoice?.id>0,'Money-only return ID missing from order history')
 const cancelReturnBody={requestId:'ac19d0ce-2026-40be-9000-000000000a41',comment:'client3 isolated refund reversal fixture'}
 const undoReturn=()=>get('/api/returns/'+returnChoice.id+'/cancel',{method:'PATCH',
   headers:{...headers,...authenticated.headers,'X-Idempotency-Key':cancelReturnBody.requestId},
   body:JSON.stringify(cancelReturnBody)})
 const returnCancelled=await undoReturn()
 assert.equal(returnCancelled.status,200,'Return cancel failed: '+returnCancelled.body.slice(0,1100)+' logs '+log.slice(-1800))
 const returnCancelRetry=await undoReturn()
 assert.equal(returnCancelRetry.status,200,'Return cancel retry failed: '+returnCancelRetry.body.slice(0,850))
 const unrefunded=JSON.parse((await get('/api/orders/'+orderId,authenticated)).body).order
 assert.equal(Number(unrefunded.return_amount),0,'Refund cancellation left return amount')
 assert.equal(Number(unrefunded.received_amount),10000,'Refund cancellation forged a new incoming payment')
 console.log('CLIENT3_REAL_WORKER_RETURN_CANCEL_AND_REPLAY_PASSED: money-only refund reversed exactly once')
 // Exercise real Warehouse physical stock, canonical SKU, reservations, shipping,
 // repeated shipping, return-to-stock and repeated return on the local third D1.
 const stockName='CLIENT3_SMOKE_WAREHOUSE_SKU'
 const stockAttrs={productName:stockName,gender:'ЖЕН',color:'БЕЖЕВЫЙ',
   material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',size:'48'}
 const arrivalBody={requestId:'ac19d0ce-2026-40be-9000-000000000a35',inventorySource:'warehouse',
   movementType:'arrival',comment:'client3 isolated stock smoke',
   items:[{...stockAttrs,quantity:3}]}
 const arrival=()=>get('/api/inventory/movements?returnInventory=0',{method:'POST',
   headers:{...headers,...authenticated.headers,'X-Idempotency-Key':arrivalBody.requestId},
   body:JSON.stringify(arrivalBody)})
 const firstArrival=await arrival()
 assert.equal(firstArrival.status,201,'Warehouse arrival failed: '+firstArrival.body.slice(0,1200)+' logs '+log.slice(-2200))
 const secondArrival=await arrival()
 assert([200,201].includes(secondArrival.status),'Arrival retry failed: '+secondArrival.body.slice(0,800))
 const inventory=async()=>JSON.parse((await get('/api/inventory?source=warehouse',authenticated)).body)
 const readStock=async()=>{const result=await inventory()
   const found=(result.items||[]).filter(x=>x.productName===stockName&&x.inventorySource==='warehouse')
   assert.equal(found.length,1,'Expected exactly one stock row for '+stockName+': '+JSON.stringify((result.items||[]).slice(0,5)))
   return found[0]}
 const stocked=await readStock()
 assert.equal(Number(stocked.quantity),3,'Arrival replay duplicated stock')
 assert(stocked.variantId>0,'Arrival did not create canonical SKU')
 const stockOrderPayload={...createPayload,requestId:'ac19d0ce-2026-40be-9000-000000000a36',
   items:[{...stockAttrs,sourceType:'warehouse',quantity:1,unitPrice:12000,catalogPriceSnapshot:null}],
   payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',amount:12000,paymentKind:'primary'}]}
 const warehouseOrderRes=await get('/api/orders',{method:'POST',headers:{...headers,...authenticated.headers,
   'X-Idempotency-Key':stockOrderPayload.requestId},body:JSON.stringify(stockOrderPayload)})
 assert.equal(warehouseOrderRes.status,201,'Warehouse order create failed: '+warehouseOrderRes.body.slice(0,1200))
 const warehouseOrderId=Number(JSON.parse(warehouseOrderRes.body).order?.id||JSON.parse(warehouseOrderRes.body).orderId||JSON.parse(warehouseOrderRes.body).id)
 assert(warehouseOrderId>0,'Warehouse order ID missing')
 const reserveStock=await readStock()
 assert.equal(Number(reserveStock.quantity),3,'Reservation subtracted physical stock too early')
 assert.equal(Number(reserveStock.reservedQuantity),1,'Expected 1 active reserved unit')
 const send=()=>get('/api/orders/'+warehouseOrderId+'/shipping',{method:'PATCH',
   headers:{...headers,...authenticated.headers},body:JSON.stringify({shippingStatus:'sent',shippingDate:'2026-10-20'})})
 const ship=await send()
 assert.equal(ship.status,200,'Warehouse shipping failed: '+ship.body.slice(0,1200)+' log '+log.slice(-2000))
 const again=await send()
 assert.equal(again.status,200,'Repeated shipping failed: '+again.body.slice(0,1200))
 const shipped=await readStock()
 assert.equal(Number(shipped.quantity),2,'Shipping did not subtract exactly one physical unit')
 assert.equal(Number(shipped.reservedQuantity),0,'Shipping did not clear active reservation')
 const issuedOrderRes=await get('/api/orders/'+warehouseOrderId,authenticated)
 assert.equal(issuedOrderRes.status,200,'Reading shipped order failed')
 const issuedOrder=JSON.parse(issuedOrderRes.body).order
 assert.equal(issuedOrder.shipping_status,'sent','Order shipping status not committed')
 assert.equal(Number(issuedOrder.received_amount),12000,'Shipping changed received funds')
 const issuedItem=(issuedOrder.items||[]).find(x=>Number(x.quantity)>0)
 assert(issuedItem?.id>0,'Issued item ID unavailable for return')
 const restock={requestId:'ac19d0ce-2026-40be-9000-000000000a37',
   orderId:warehouseOrderId,returnDate:'2026-10-20',amount:0,
   items:[{orderItemId:issuedItem.id,quantity:1,amount:0,restock:true,physicalState:'warehouse'}]}
 const receiveBack=()=>get('/api/returns',{method:'POST',
   headers:{...headers,...authenticated.headers,'X-Idempotency-Key':restock.requestId},
   body:JSON.stringify(restock)})
 const firstBack=await receiveBack()
 assert.equal(firstBack.status,201,'Physical return failed: '+firstBack.body.slice(0,1200)+' log '+log.slice(-2200))
 const secondBack=await receiveBack()
 assert.equal(secondBack.status,201,'Physical return replay failed: '+secondBack.body.slice(0,1200))
 const returned=await readStock()
 assert.equal(Number(returned.quantity),3,'Physical return double-counted or lost stock')
 assert.equal(Number(returned.reservedQuantity),0,'Physical return revived reservation')
 console.log('CLIENT3_REAL_WORKER_ARRIVAL_RESERVE_SHIP_AND_RESTOCK_RETRY_PASSED: exactly 3 -> 2 -> 3 physical, 1 -> 0 reserved')
 // A valid canonical SKU may be sold while its physical stock is insufficient.
 // Shipping must demand a precise human possession confirmation, not fabricate
 // a prior arrival, and must retain shortage evidence without negative physical.
 const shortageOrderPayload={...stockOrderPayload,requestId:'ac19d0ce-2026-40be-9000-000000000a38',
   items:[{...stockAttrs,sourceType:'warehouse',quantity:4,unitPrice:12000,catalogPriceSnapshot:null}],
   payments:[]}
 const shortageCreate=await get('/api/orders',{method:'POST',headers:{...headers,...authenticated.headers,
   'X-Idempotency-Key':shortageOrderPayload.requestId},body:JSON.stringify(shortageOrderPayload)})
 assert.equal(shortageCreate.status,201,'Shortage order creation should not invent stock or reject a real sale: '+shortageCreate.body.slice(0,800))
 const shortageId=Number(JSON.parse(shortageCreate.body).order?.id||JSON.parse(shortageCreate.body).orderId||JSON.parse(shortageCreate.body).id)
 assert(shortageId>0,'Shortage order ID missing')
 const shortageBefore=await readStock()
 assert.equal(Number(shortageBefore.quantity),3,'Shortage order modified tracked physical before shipping')
 assert.equal(Number(shortageBefore.reservedQuantity),4,'Shortage order missing 4 active reserved units')
 const shortageShippingPayload={shippingStatus:'sent',shippingDate:'2026-10-20'}
 const shortageSend=payload=>get('/api/orders/'+shortageId+'/shipping',{method:'PATCH',
   headers:{...headers,...authenticated.headers},body:JSON.stringify(payload)})
 const blockedShortage=await shortageSend(shortageShippingPayload)
 assert.equal(blockedShortage.status,409,'Shortage send without physical confirmation must block: '+blockedShortage.body.slice(0,1000))
 const required=JSON.parse(blockedShortage.body)
 assert.equal(required.code,'stock_resolution_required','Shortage must open exact possession resolver')
 const confirmedShortage=await shortageSend({...shortageShippingPayload,stockConfirmations:[{
   source:'warehouse',variantId:stocked.variantId,expectedQuantity:3,operationQuantity:4
 }]})
 assert.equal(confirmedShortage.status,200,'Exact confirmed shortage send failed: '+confirmedShortage.body.slice(0,1200)+' log '+log.slice(-2000))
 const replayShortage=await shortageSend(shortageShippingPayload)
 assert.equal(replayShortage.status,200,'Repeated confirmed shortage send failed: '+replayShortage.body.slice(0,850))
 const shortageAfter=await readStock()
 assert.equal(Number(shortageAfter.quantity),0,'Confirmed shortage invented or made physical stock negative')
 assert.equal(Number(shortageAfter.reservedQuantity),0,'Confirmed shortage did not fulfill active reserve')
 console.log('CLIENT3_REAL_WORKER_EXACT_SHORTAGE_RESOLVER_PASSED: 4 units physically confirmed, 3 tracked; physical floor zero')
 // Unknown variants must remain unresolved without creating an arbitrary SKU.
 // Shipping should point to a NONEMPTY order-scoped resolver.
 const unknownPayload={...stockOrderPayload,requestId:'ac19d0ce-2026-40be-9000-000000000a39',
   items:[{...stockAttrs,productName:'CLIENT3_NEVER_ARRIVED_VARIANT',
     color:'ФИОЛЕТОВЫЙ',quantity:1,unitPrice:9000,catalogPriceSnapshot:null}],payments:[]}
 const unknownCreate=await get('/api/orders',{method:'POST',headers:{...headers,...authenticated.headers,
   'X-Idempotency-Key':unknownPayload.requestId},body:JSON.stringify(unknownPayload)})
 assert.equal(unknownCreate.status,201,'Unknown item order not accepted: '+unknownCreate.body.slice(0,1000))
 const unknownId=Number(JSON.parse(unknownCreate.body).order?.id||JSON.parse(unknownCreate.body).orderId||JSON.parse(unknownCreate.body).id)
 const unresolvedShipping=await get('/api/orders/'+unknownId+'/shipping',{method:'PATCH',
   headers:{...headers,...authenticated.headers},body:JSON.stringify({shippingStatus:'sent',shippingDate:'2026-10-20'})})
 assert.equal(unresolvedShipping.status,409,'Unknown SKU must block unauthorized physical fulfillment: '+unresolvedShipping.body.slice(0,1000))
 const review=await get('/api/orders/'+unknownId+'/catalog-review',authenticated)
 assert.equal(review.status,200,'Order catalog resolver API failed: '+review.body.slice(0,850))
 const missing=JSON.parse(review.body)
 assert((missing.items||[]).some(x=>x.productName==='CLIENT3_NEVER_ARRIVED_VARIANT'),
   'Unknown SKU must not open empty catalog resolver: '+review.body.slice(0,1100))
 console.log('CLIENT3_REAL_WORKER_UNKNOWN_SKU_SHIPPING_BLOCK_AND_NONEMPTY_RESOLVER_PASSED')
 const denied=await get('/api/orders',{method:'POST',headers,body:'{}'})
 assert.equal(denied.status,401,'Anonymous new order must never be permitted')
 console.log('CLIENT3_LOCAL_D1_LIVE_WORKER_AUTH_AND_FRESH_READS_PASSED: consolidated Client3 baseline, admin bootstrap guarded, authenticated APIs healthy')
}finally{
 if(dev){
   try{if(process.platform==='win32')dev.kill('SIGTERM');else process.kill(-dev.pid,'SIGTERM')}catch{}
   await pause(550)
   try{if(process.platform!=='win32')process.kill(-dev.pid,'SIGKILL')}catch{}
 }
 remove()
}
