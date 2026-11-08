import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orders-mixed-editor-'))
await build({entryPoints:['src/app/itemizedEditCatalogSnapshot.ts','src/app/order-pricing.ts'],
 bundle:true,platform:'node',format:'esm',target:'node20',outdir:dir,outExtension:{'.js':'.mjs'},logLevel:'error'})
const {historicalCatalogSnapshotForEdit:keepSnapshot}=await import(pathToFileURL(path.join(dir,'itemizedEditCatalogSnapshot.mjs')).href)
const {evaluateItemizedCreatePricing:price}=await import(pathToFileURL(path.join(dir,'order-pricing.mjs')).href)

const base=(id,name,material,length,size,qty,unitPrice,snapshot,source='warehouse')=>({
 id,orderItemId:id,productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'СВЕТЛО-БЕЖЕВЫЙ',
 material,length,size,quantity:qty,unitPrice,catalogPriceSnapshot:snapshot,sourceType:source,
})
const original=[
 base(11,'БАЯН СҰЛУ ШАПАН','ЗАМША ВЕЛЮР','СТАНДАРТ','44',1,22500,22500),
 base(14,'БАЯН СҰЛУ ШАПАН','ЗАМША ВЕЛЮР','ДЛИННЫЙ','44',1,27500,27000),
 base(15,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','42',1,25000,25000),
 base(16,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','44',1,20000,20000),
 base(17,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','46',1,25000,25000),
 base(18,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','48',1,25000,25000),
]
assert.equal(price(original,[]).totalAmount,145000)
const next=[
 {...original[0],quantity:2,unitPrice:22600},
 {...original[1],size:'48',color:'СВЕТЛО-БЕЖЕВЫЙ',catalogPriceSnapshot:29000},
 ...original.slice(2),
 {...original[1],id:undefined,orderItemId:undefined,sourceType:'boutique',catalogPriceSnapshot:27500,quantity:1},
]
const byId=new Map(original.map(x=>[x.id,x]))
const payload=next.map(item=>({
 ...item,
 catalogPriceSnapshot:keepSnapshot(byId.get(item.orderItemId),item),
}))
assert.equal(payload.length,7)
assert.equal(payload[1].orderItemId,14)
assert.equal(payload[1].catalogPriceSnapshot,27000,'Changing 44 to 48 in same execution must retain historical snapshot')
assert.equal(payload[0].catalogPriceSnapshot,22500,'Quantity and sale price edit must preserve snapshot')
assert.equal(payload[6].catalogPriceSnapshot,27500,'New boutique line can use new catalog snapshot')
const result=price(payload,[])
assert.equal(result.status,'ready',JSON.stringify(result.blockers))
assert.equal(result.totalAmount,195200,'Work mixed edit total')
assert.equal(result.lines.length,7)
assert.equal(result.debtAmount,195200)
const paid=price(payload,[{method:'НАЛИЧКА',amount:8000}])
assert.equal(paid.status,'ready')
assert.equal(paid.receivedAmount,8000)
assert.equal(paid.debtAmount,187200)
const changedExecution={...original[1],length:'УКОРОЧЕННЫЙ',catalogPriceSnapshot:29000}
assert.equal(keepSnapshot(original[1],changedExecution),29000,'Different execution may have new snapshot')
assert.equal(keepSnapshot(original[1],{...original[1],sourceType:'boutique',catalogPriceSnapshot:29000}),27000)
assert.equal(keepSnapshot(original[1],{...original[1],color:'ЧЕРНЫЙ',catalogPriceSnapshot:null}),27000)
assert.equal(keepSnapshot({...original[1],catalogPriceSnapshot:null},{...original[1],size:'52',catalogPriceSnapshot:29000}),null)
assert.equal(keepSnapshot(null,{...original[1],catalogPriceSnapshot:29000}),29000)
const app=fs.readFileSync('src/App.tsx','utf8')
const editPersistence=fs.readFileSync('src/features/orders/orderEditPersistenceActions.ts','utf8')
const server=fs.readFileSync('worker/domains/orders-write.ts','utf8')
assert(app.includes('createOrderEditPersistenceActions({') && editPersistence.includes('catalogPriceSnapshot: historicalCatalogSnapshotForEdit('),'Client replacement payload must apply historical snapshot in actual edit submission')
assert(server.includes('Цена Каталога для неизменённого ценового исполнения является историческим снимком'),'Server must protect immutable snapshots')
// Execute the exact editor-session implementation to prevent truncated/stale order
// overview data from replacing a complete itemized order.
const sessionBuilt = await build({
 entryPoints:['src/features/orders/orderEditSessionActions.ts'],
 bundle:true,platform:'node',format:'esm',target:'es2022',write:false,logLevel:'silent',
})
const {createOrderEditSessionActions}=await import(
 'data:text/javascript;base64,'+Buffer.from(sessionBuilt.outputFiles[0].text).toString('base64')
)
const listedOrder={
 id:771,external_id:'QA-771',order_date:'2026-11-08',pricing_mode:'itemized_v1',
 manager_id:1,order_status:'active',workshop_status:'ready',source_type:'warehouse',
 total_amount:145000,received_amount:0,debt_amount:145000,return_amount:0,
 items:original,payments:[],item_count:7,
}
const completeOrder={...listedOrder,items:[...original,{...original[0],id:19}],item_count:7}
let sessionResponse={...listedOrder,items:original,item_count:6}
let openCalls=0,fetches=0,sessionError='',lastSessionDraft=null,sessionOpened=false
let stockRefreshes=0,sessionSelectedOrder=null
const originalWindow=globalThis.window
globalThis.window={location:{hash:'#orders'}}
try {
 const sessionArgs={
  isAdmin:true,editorReturnSector:'orders',setEditorReturnSector:()=>{},
  setEditorOpen:open=>{sessionOpened=open;if(open)openCalls++},
  setEditorOrderOverride:()=>{},
  setSelectedOrderId:id=>{sessionSelectedOrder=id},
  setActiveSector:()=>{},setOrderPanel:()=>{},setMessage:()=>{},
  setError:value=>{sessionError=value||''},
  setExpandedOrderItemCounts:()=>{},setEditorDraft:next=>{lastSessionDraft=next},
  apiFetch:async(url,options={})=>{
   assert.equal(url,'/api/orders/771')
   assert.equal(options.cache,'no-store','Editor read must bypass stale GET cache')
   fetches++
   return new Response(JSON.stringify({ok:true,order:sessionResponse}),
    {status:200,headers:{'Content-Type':'application/json'}})
  },
  getOrderOperationalProjection:async()=>({canEdit:true,hasCommittedDownstreamOperation:false}),
  upsertOrderInState:()=>{},
  loadCatalogData:async()=>null,
  loadInventoryData:async()=>{stockRefreshes++;return {ok:true,items:[]}},
 }
 await createOrderEditSessionActions({...sessionArgs,isAdmin:false}).handleEditOrder(listedOrder)
 assert.equal(fetches,0,'Manager may not load privileged full-order editor data')
 await createOrderEditSessionActions(sessionArgs).handleEditOrder(listedOrder)
 assert.match(sessionError,/неполный состав/)
 assert.equal(openCalls,0,'Truncated order overview cannot open the editor or drop a SKU')
 sessionResponse=completeOrder
 await createOrderEditSessionActions(sessionArgs).handleEditOrder(listedOrder)
 assert.equal(lastSessionDraft?.items.length,7,'All seven items must be loaded before editing')
 assert.equal(sessionOpened,true)
 assert.equal(sessionSelectedOrder,771)
 assert.equal(globalThis.window.location.hash,'#editor')
 assert.equal(stockRefreshes,2,'Editor read refreshes each physical location without mutating stock')
 createOrderEditSessionActions(sessionArgs).closeOrderEditor()
 assert.equal(sessionSelectedOrder,null)
 assert.equal(globalThis.window.location.hash,'#orders')
}finally{
 if(originalWindow===undefined)delete globalThis.window
 else globalThis.window=originalWindow
}

const correctionBuilt=await build({
 entryPoints:['src/features/orders/orderCorrectionsActions.ts'],
 bundle:true,platform:'node',format:'esm',target:'es2022',write:false,logLevel:'silent',
})
const {createOrderCorrectionsActions}=await import(
 'data:text/javascript;base64,'+Buffer.from(correctionBuilt.outputFiles[0].text).toString('base64')
)
const correctionCalls=[],completedCorrections=[]
const corrector=createOrderCorrectionsActions({
 setSavingOrder:()=>{},setError:()=>{},setMessage:()=>{},
 prepareCriticalRequest:(key,payload)=>({
  requestId:'qa-correct-771',payload:{...payload,requestId:'qa-correct-771'},
 }),
 completeCriticalRequest:(key,id)=>completedCorrections.push({key,id}),
 apiFetch:async(url,options={})=>{
  correctionCalls.push({url:String(url),options})
  return new Response(JSON.stringify({ok:true}),
   {status:200,headers:{'Content-Type':'application/json'}})
 },
 upsertOrderInState:()=>{},refreshDashboard:()=>{},
})
const unchangedMeta={
 orderDate:'2026-11-08',customerPhone:'',customerName:'',
 city:'',deliveryType:'',comment:'',
}
assert.equal(await corrector.correctOrderMetadata(listedOrder,unchangedMeta),true)
assert.equal(correctionCalls.length,0,'Unchanged metadata must not generate an extra PATCH')
await corrector.correctRecordedOrderItemPrices(listedOrder,[
 {item:original[0],unitPrice:22600},{item:original[1],unitPrice:27550},
])
assert.equal(correctionCalls.length,1)
assert.equal(correctionCalls[0].url,'/api/orders/771')
assert.equal(correctionCalls[0].options.method,'PATCH')
const correctionPayload=JSON.parse(correctionCalls[0].options.body)
assert.equal(correctionPayload.paymentCorrections,undefined,
 'Historical price correction must never insert/update paid money events')
assert.equal(correctionPayload.itemPriceCorrections.length,2)
assert.deepEqual(correctionPayload.itemPriceCorrections.map(x=>({
 id:x.orderItemId,expectedUnitPrice:x.expectedUnitPrice,expectedSnapshot:x.expectedCatalogPriceSnapshot,
})),[
 {id:11,expectedUnitPrice:22500,expectedSnapshot:22500},
 {id:14,expectedUnitPrice:27500,expectedSnapshot:27000},
], 'Recorded price corrections must retain original line and price CAS')
assert.deepEqual(completedCorrections,[{key:'recorded-price-correction-batch:771:11-14',id:'qa-correct-771'}])
await corrector.correctRetiredExchangePrice(listedOrder,{
 exchangeId:900,orderItemId:14,productName:'БАЯН СҰЛУ ШАПАН',
 size:'44',color:'СВЕТЛО-БЕЖЕВЫЙ',originalUnitPrice:27500,currentRecordedUnitPrice:27500,
},27550)
assert.equal(correctionCalls[1].url,'/api/exchanges/900/old-recorded-price')
assert.deepEqual(JSON.parse(correctionCalls[1].options.body),{
 orderItemId:14,expectedUnitPrice:27500,newUnitPrice:27550,requestId:'qa-correct-771',
}, 'Price before historical exchange must not rewrite the actual exchange or money ledger')

console.log('BRANCH2_MIXED_EDITOR_SNAPSHOT_PASS: Work 6 to 7 items, 145000 to 195200, sale price edit, existing payments, execution snapshots')
