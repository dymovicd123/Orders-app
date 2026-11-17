import assert from 'node:assert/strict'
import {readFileSync,unlinkSync,existsSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {buildSync} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {returnV2PreviewMode} from '../src/features/sections/returnV2UiMode.ts'

const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'))
assert.equal(config.name,'orders-app-branch2')
assert.equal(config.d1_databases[0].database_id,'0904a573-21ff-44d8-93b0-c9200f771702')
assert.equal(config.vars.RETURN_V2_ENABLED,'true','Versioned Branch2 config must always enable Return V2')
assert.equal(config.keep_vars,true,'Other Worker variables/secrets must be kept')
assert.equal(returnV2PreviewMode({ok:true,enabled:true,eligible:true},true),'v2')
assert.equal(returnV2PreviewMode({ok:true,enabled:true,eligible:false},true),'v2',
  'Ineligible old orders must remain in Return V2 for safe review')
assert.equal(returnV2PreviewMode({ok:true,enabled:false},true),'error',
  'The lost flag must never expose the obsolete V1 editor')
assert.equal(returnV2PreviewMode({ok:false,enabled:true},true),'error')
assert.equal(returnV2PreviewMode(null,true),'error')
assert.equal(returnV2PreviewMode({ok:true,enabled:true},false),'error')

const src=readFileSync('src/features/sections/OrderReturnsSection.tsx','utf8')
const flow=readFileSync('src/features/sections/OrderReturnV2Flow.tsx','utf8')
const route=readFileSync('worker/routes/order-return-v2.ts','utf8')
const readiness=readFileSync('scripts/return-v2-branch2-readiness.mjs','utf8')
assert(src.includes('<OrderReturnV2Flow') && src.includes("id=\"return-workspace-form\""))
assert(src.includes("activeView==='history'") && src.includes('История возвратов'))
assert(src.includes('returnPhysicalStatus(item)') && src.includes('cancelReturnEntry(entry)'))
assert(src.includes("openWarehouseReceiving('return')"),'Physical receipt stays in Warehouse')
assert(!src.includes('allowLegacyReturnEditor') && !src.includes('saveReturn()')
  && !src.includes('LinkedTableScroll') && !src.includes('Форма возврата'),
  'The obsolete V1 form and submit action must be completely absent from the UI')
assert(flow.includes('returnV2PreviewMode(body,response.ok)'))
assert(flow.includes("body?.enabled===false") && flow.includes('старая форма не используется'))
assert(!flow.includes("viewMode==='legacy'") && !flow.includes("setViewMode('legacy')"))
assert(flow.includes('expectedOrderVersion:preview.evidence.orderVersion'))
assert(flow.includes('requestId:requestRef.current'),'Uncertain writes must retain their idempotency key')
assert(route.includes('if(!await schemaReady(db))'),'V2 route must not write without migrations')
assert(route.includes("if(!enabled)"),'Explicit server gate must continue to protect writes')
assert(readiness.includes("assert.equal(cfg.vars?.RETURN_V2_ENABLED,'true'"))

const temp=resolve('.return-v2-only-interface-test.mjs')
try {
  buildSync({
    entryPoints:['src/features/sections/OrderReturnsSection.tsx'],
    bundle:true,platform:'node',format:'esm',outfile:temp,packages:'external',
    loader:{'.css':'empty'},jsx:'automatic',
  })
  const {OrderReturnsSection}=await import(pathToFileURL(temp).href)
  const noop=()=>{}
  const context={
    returnSelectedOrder:null,returnFormRef:{current:null},
    returnHistory:[],returnHistoryBusy:false,returnHistoryError:'',
    returnHistoryHasMore:false,returnHistoryFilters:{q:'',dateFrom:'',dateTo:'',status:'all'},
    returnHistorySummary:{count:0,activeCount:0,activeAmount:0,pendingPhysicalQuantity:0,cancelledCount:0},
    sectorStyle:()=>({}),orderPanelStyle:()=>({}),formatMoney:(v)=>String(v),
    loadReturnHistory:noop,closeReturnForm:noop,returnBusy:false,loadReturnPendingInbox:noop,
    refreshOrdersAfterReturn:noop,ManagerBadge:()=>null,managerColorFor:()=>null,
    cancelReturnEntry:noop,reconcileKnownInventoryLifecycle:noop,receiveReturnedItemAction:noop,
    setOrderPanel:noop,setReturnHistoryFilters:noop,
    canManageWarehouse:true,openWarehouseReceiving:noop,suggestionValues:{paymentMethods:[]},
    SmartPickerInput:()=>null,
  }
  const empty=renderToStaticMarkup(React.createElement(OrderReturnsSection,{ctx:context}))
  assert(empty.includes('Откройте возврат из таблицы заказов'))
  assert(!empty.includes('Форма возврата') && !empty.includes('Оформить возврат'),
    'Opening Returns tab without an order must not render the former editor')
  const checked=renderToStaticMarkup(React.createElement(OrderReturnsSection,{
    ctx:{...context,returnSelectedOrder:{id:71,external_id:'ORD-71'}}
  }))
  assert(checked.includes('Проверка товаров и остатков'),
    'Selecting ANY order must start with Return V2 server verification')
  assert(!checked.includes('Сбросить') && !checked.includes('Форма возврата'))
} finally {
  if(existsSync(temp))unlinkSync(temp)
}
console.log('RETURN_V2_ONLY_BRANCH2_PASS: stable live config, all orders enter safe V2 preview, never legacy fallback, existing history and warehouse handoff')
