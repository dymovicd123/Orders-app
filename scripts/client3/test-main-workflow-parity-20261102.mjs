import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import reactPlugin from '@vitejs/plugin-react'

const shell=fs.readFileSync('src/WatchClient3App.tsx','utf8')
const chrome=fs.readFileSync('src/features/client3/Client3MainChrome.tsx','utf8')
const refs=fs.readFileSync('src/features/client3/WatchReferencesSection.tsx','utf8')
const logistics=fs.readFileSync('src/features/client3/WatchLogisticsPanel.tsx','utf8')
const orders=fs.readFileSync('src/features/client3/WatchOrdersPanel.tsx','utf8')
const mainRefs=fs.readFileSync('src/features/sections/ReferencesSection.tsx','utf8')
const mainWorkshop=fs.readFileSync('src/features/sections/WorkshopSection.tsx','utf8')

assert(chrome.includes("{route:'references',module:'directory',label:'Справочники'}"),
  'Main references navigation must lead to its own references page, not warehouse')
assert(!chrome.includes("{route:'catalog',module:'directory',label:'Справочники'}"),
  'Do not disguise catalog as References')
assert(shell.includes("activeSection==='references'&&brand&&<WatchReferencesSection"),
  'A real References view must be mounted')
for(const cls of ['references-hero','reference-kind-grid','references-toolbar',
  'references-layout','reference-list-panel','reference-editor-panel','reference-row']){
  assert(mainRefs.includes(cls)&&refs.includes(cls),
    'Reference view must use structural Main ReferencesSection CSS classes: '+cls)
}
assert(refs.includes('WATCH_OPTIONS')&&refs.includes('WATCH_PAYMENTS'),
  'Watch references use server-domain-compatible choices instead of clothing values')
assert(refs.includes("'/api/client3/watches/references'"),
  'Watch characteristics must come from the shared brand-neutral references API')
assert(!refs.includes('onBrandChange(value)')&&!refs.includes('watch-references-brand-scope'),
  'References must not force a brand selector for characteristics')
assert(refs.includes('Добавить в справочник')&&refs.includes("editId?'PATCH':'POST'")&&refs.includes("method:'DELETE'"),
  'Admin must add, edit and remove real shared references rather than fake edits')
assert(!refs.includes('/api/references'),'Never allow brand-unsafe Main references write routes')

assert(shell.includes('client3-brand-workspace')&&shell.includes('client3-brand-workspace-tabs'),
  'Warehouse brand switcher must be a prominent first-class workspace')
assert(shell.includes('aria-pressed={brand===row.code}'),
  'Brand choice must show selected state for TAUWACH/WACHIZEN')
assert(shell.includes('Действия применяются только к выбранному бренду.'),
  'Make brand separation explicit before any stock mutation')

for(const cls of ['workshop-workspace','workshop-channel-tabs','workshop-channel-tab',
  'workshop-grid-table','workshop-order-like-table']){
  assert(mainWorkshop.includes(cls)&&logistics.includes(cls),
    'Logistics must reuse actual Main WorkshopSection structure: '+cls)
}
assert(logistics.includes("'/api/client3/watches/logistics/'")&&logistics.includes('/ready'),
  'Engraving readiness remains independent')
assert(logistics.includes("'/api/client3/watches/orders/'+order.orderId+'/send'"),
  'Actual physical dispatch belongs in Logistics')
assert(logistics.includes('dispatchConfirm===order.orderId'),
  'Physical shipment must require explicit confirmation')
assert(logistics.includes('canDispatch')&&shell.includes('canDispatch={canSales||isLogisticsRole}'),
  'Managers and two-brand logisticians may dispatch; warehouse staff must not')
assert(logistics.includes('canCompleteEngraving'),
  'Engraving rights independent from dispatch')
assert(logistics.includes("body:JSON.stringify({brand:order.brand,requestId,")&&
  logistics.includes("items:selected.map(row=>({orderItemId:row.orderItemId,quantity:row.quantity}))"),
  'Shipment must be brand-scoped, idempotent and explicit per watch line')
assert(!logistics.includes('/api/workshop/')&&!logistics.includes('/api/cash/'),
  'No legacy workshop money access from Logistics')
assert(!orders.includes("'/api/client3/watches/orders/'+orderId+'/send'"),
  'Orders must not duplicate the physical send action')
assert(orders.includes('onOpenLogistics'),'Orders must hand preparation to Logistics')
assert(orders.includes('WatchReturnForm')&&orders.includes('WatchExchangeForm'),
  'Orders remain a sales ledger with return/exchange tools')

const server=await createServer({configFile:false,plugins:[reactPlugin()],appType:'custom',
  server:{middlewareMode:true},logLevel:'error'})
try{
  const {WatchReferencesSection}=await server.ssrLoadModule('/src/features/client3/WatchReferencesSection.tsx')
  const html=renderToStaticMarkup(React.createElement(WatchReferencesSection,{
    brand:'TAUWACH',brands:['TAUWACH','WACHIZEN'],onBrandChange:()=>{},
    onOpenCatalog:()=>{},onOpenStaff:()=>{},
  }))
  for(const label of ['Характеристики и настройки','TAUWACH','WACHIZEN','Пол',
    'Механизм','Материал браслета','Цвет циферблата','Цвет ремешка',
    'Способы оплаты','Доставка']){
    assert(html.includes(label),'Missing useful watch reference list: '+label)
  }
  assert(!html.includes('Выбранный бренд справочников'),'Shared reference lists must have no mandatory brand selector')
  assert(!html.includes('ДЖИНСА')&&!html.includes('42 размер'), 'No clothing options')

  const {WatchLogisticsPanel}=await server.ssrLoadModule('/src/features/client3/WatchLogisticsPanel.tsx')
  const logisticsHtml=renderToStaticMarkup(React.createElement(WatchLogisticsPanel,{
    brand:'TAUWACH',allowedBrands:['TAUWACH','WACHIZEN'],
    canCompleteEngraving:true,canDispatch:true,
  }))
  assert(logisticsHtml.includes('Все бренды')&&logisticsHtml.includes('TAUWACH')&&logisticsHtml.includes('WACHIZEN'),
    'Logistics separate brands must be visually evident')
  assert(logisticsHtml.includes('Отправлены')&&logisticsHtml.includes('К отправке'),
    'Logistics operators must see shipping-oriented queue')
  assert(!logisticsHtml.includes('Подтвердить отправку'),'No send without selected order')
  console.log('CLIENT3_MAIN_WORKFLOW_PARITY_PASS: refs route, prominent brand boundary, and Main-like logistics with distinct shipping and sales ledger')
}finally{await server.close()}
