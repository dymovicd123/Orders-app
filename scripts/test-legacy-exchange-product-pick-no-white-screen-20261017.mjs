import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'

// This bug used variables that only got evaluated after a new product made
// currentPairReady true. TypeScript cannot catch them in @ts-nocheck TSX.
// Render the actual legacy Exchange section before and after selecting a
// product, including both stock-shortage states. No Worker / D1 writes.
const file = 'src/features/sections/OrderExchangeSection.tsx'
const source = readFileSync(file, 'utf8')
assert(!source.includes('exchangeHasPhysicalConfirmation'), 'Dead physical-confirmation identifier crashes product pick')
assert(!source.includes('exchangeConfirmedPhysical'), 'Dead observed-stock identifier crashes product pick')
assert(source.includes('exchangePhysicalShortage && !exchangeIssueConfirmed'),
  'New-item shortage must be checked with the actual checkbox state')

const server=await createServer({
  configFile:false,
  plugins:[reactPlugin()],
  server:{middlewareMode:true},
  appType:'custom',
  logLevel:'error',
})
try {
  const {OrderExchangeSection}=await server.ssrLoadModule('/src/features/sections/OrderExchangeSection.tsx')
  const item={
    id:31, productName:'КОЗЫ КОРПЕШ ШАПАН',quantity:1,unitPrice:80000,
    sourceType:'workshop',availableOperationQuantity:1,
    gender:'МУЖ',color:'СВЕТЛО-БЕЖЕВЫЙ',material:'ЗАМША ВЕЛЮР',
    length:'СТАНДАРТ',size:'54',
  }
  const order={
    id:2541,external_id:'ORD-20260816105409-2541',
    order_date:'2026-08-16',manager_name:'НИГАРА',customer_name:'',
    customer_phone:'',shipping_status:'sent',pricing_mode:'legacy',
    items:[item],
  }
  const base={
    exchangeBusy:false,exchangeSelectedOrder:order,exchangeHistory:[],
    exchangeHistoryBusy:false,exchangeHistoryError:'',
    exchangeHistorySummary:{pendingPhysicalQuantity:0,activeCount:0,count:0,cancelledCount:0},
    exchangeHistoryHasMore:false,
    exchangeHistoryFilters:{q:'',dateFrom:'',dateTo:'',status:'all'},
    exchangeFormRef:null,
    formatMoney:(n)=>String(n),
    FriendlyNumberInput:(props)=>React.createElement('input',props),
    orderPanelStyle:()=>({}),
    sectorStyle:()=>({}),
    getOrderSourceAvailability:()=>null,
    createExchangeDraft:()=>({newItem:{productName:'',sourceType:'workshop'}}),
    suggestionValues:{products:['КОЗЫ КОРПЕШ ШАПАН'],colors:[],materials:[],lengths:[],sizes:[],childAges:[],paymentMethods:[]},
    SmartPickerInput:({value,placeholder})=>React.createElement('input',{value,placeholder,readOnly:true}),
    sourceLabel:()=> 'Цех',
  }
  function render(newProduct, stockObservationEnabled=false, currentPhysical=2, sourceType='workshop') {
    const draft={
      workflowMode:'pair',orderId:2541,oldItemId:31,oldQuantity:1,
      oldPhysicalState:'no_stock',exchangeDate:'2026-10-17',
      newItem:{
        productName:newProduct,quantity:1,sourceType,
        audienceType:'ВЗРОСЛЫЙ',gender:'МУЖ',color:'СВЕТЛО-БЕЖЕВЫЙ',
        material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',size:'54',
        stockObservationEnabled,
      },
      queuedPairs:[],financialAction:'none',financialAmount:0,paymentMethod:'',comment:'',
    }
    const ctx={
      ...base,exchangeDraft:draft,
      getOrderSourceAvailability:()=>({currentPhysical,currentReserved:0,canObservePhysical:true,tone:'warning'}),
    }
    return renderToStaticMarkup(React.createElement(OrderExchangeSection,{ctx}))
  }
  const initial=render('')
  const selected=render('КОЗЫ КОРПЕШ ШАПАН')
  assert(initial.includes('Новая позиция'), 'Initial Exchange form must render')
  assert(selected.includes('КОЗЫ КОРПЕШ ШАПАН'), 'Product pick must not blank the app')
  const buttonOf=(html)=>html.match(/<button[^>]*>Добавить ещё позицию<\/button>/)?.[0] || ''
  assert(buttonOf(initial).includes('disabled'), 'Cannot queue empty new item')
  assert(buttonOf(selected)&&!buttonOf(selected).includes('disabled'), 'Valid selected product must enable queueing')
  const shortage=render('КОЗЫ КОРПЕШ ШАПАН',false,0,'warehouse')
  assert(buttonOf(shortage).includes('disabled'), 'Insufficient stock requires explicit confirmation')
  const confirmed=render('КОЗЫ КОРПЕШ ШАПАН',true,0,'warehouse')
  assert(buttonOf(confirmed)&&!buttonOf(confirmed).includes('disabled'),
    'Confirmed physical presence must unblock queue without a numeric recount')
  console.log('LEGACY_EXCHANGE_PICK_RENDER_AND_SHORTAGE_CONFIRMATION_PASSED')
} finally {
  await server.close()
}
