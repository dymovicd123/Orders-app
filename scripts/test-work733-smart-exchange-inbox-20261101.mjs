import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {buildSync} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const output=path.resolve('.work733-smart-view-test.mjs')
const warehouseOutput=path.resolve('.work733-warehouse-intake-test.mjs')
try {
  buildSync({entryPoints:['src/features/sections/OrderExchangeSmartSection.tsx'],outfile:output,
    bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},jsx:'automatic'})
  buildSync({entryPoints:['src/features/inventory/views/WarehouseReceivingWorkspace.tsx'],outfile:warehouseOutput,
    bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},jsx:'automatic'})
  const {OrderExchangeSmartSection}=await import(pathToFileURL(output).href)
  const {WarehouseReceivingWorkspace}=await import(pathToFileURL(warehouseOutput).href)
  const noop=()=>{}
  const ctx={exchangeDraft:{oldSelections:[],newItems:[],paymentAmount:0},exchangeHistory:[],
    exchangeHistoryFilters:{q:'NO-MATCH',dateFrom:'',dateTo:'',status:'cancelled'},
    exchangeHistorySummary:{pendingPhysicalQuantity:0},exchangeSelectedOrder:null,
    exchangePendingInbox:{rows:[{id:96,isSetExchange:true,status:'completed',externalId:'QA-EXCHANGE-96',
      oldItems:[{id:201,productName:'OLD ITEM',quantity:2,physicalTracking:true,physicalReceivedAt:null}]}],
      pendingQuantity:10,hasMore:true,busy:false,error:''},
    formatMoney:String,sectorStyle:()=>({}),orderPanelStyle:()=>({}),sourceLabel:String,
    setExchangeDraft:noop,setExchangeHistoryFilters:noop,setOrderPanel:noop,loadExchangeHistory:noop,
    loadExchangePendingInbox:noop,exchangeFormRef:{current:null},suggestionValues:{},
    canManageWarehouse:true,openWarehouseReceiving:noop,
    FriendlyNumberInput:()=>React.createElement('input'),SmartPickerInput:()=>React.createElement('input')}
  const render=()=>renderToStaticMarkup(React.createElement(OrderExchangeSmartSection,{ctx}))
  let html=render()
  assert(!html.includes('QA-EXCHANGE-96'),'Exchange history must not duplicate the warehouse intake queue')
  assert(html.includes('К приёмке обменов') && html.includes('Ожидают получения: 10 шт.'))
  assert(html.includes('Обменов по выбранным условиям нет.'))
  const warehouse=renderToStaticMarkup(React.createElement(WarehouseReceivingWorkspace,{
    mode:'exchange',onModeChange:noop,returnInbox:{rows:[],pendingQuantity:0,hasMore:false,busy:false,error:''},
    exchangeInbox:ctx.exchangePendingInbox,loadReturns:noop,loadExchanges:noop,receiveItem:async()=>true,
  }))
  assert(warehouse.includes('QA-EXCHANGE-96'),'Warehouse intake must show pending old item independently of exchange history filters')
  assert(warehouse.includes('OLD ITEM') && warehouse.includes('Обмен №96'))
  assert(warehouse.includes('Загрузить ещё ожидающие'),'Warehouse intake pagination must remain accessible')
  assert(!html.includes('Товары ещё у клиентов'),'Unknown location must not be asserted as a physical fact')
  ctx.exchangeSelectedOrder={id:2196,external_id:'QA-2196',total_amount:3000,
    received_amount:3000,return_amount:1000,debt_amount:0,items:[]}
  html=render()
  assert(html.includes('Долг по записи заказа</span><strong>0</strong>'))
  assert(html.includes('После возвратов к зачёту осталось 2000'))
  assert.equal(ctx.exchangeSelectedOrder.debt_amount,0,'Rendering must not rewrite the financial ledger')
  console.log('WORK733_SMART_EXCHANGE_INBOX_AND_DISTINCT_DEBT_METRICS_PASS')
} finally {
  if(fs.existsSync(output))fs.unlinkSync(output)
  if(fs.existsSync(warehouseOutput))fs.unlinkSync(warehouseOutput)
}
