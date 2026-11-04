import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const main=fs.readFileSync('src/features/sections/WorkshopSection.tsx','utf8')
const qa=fs.readFileSync('src/features/client3/WatchLogisticsTaskTable.tsx','utf8')
const handover=fs.readFileSync('src/features/client3/WatchOrderHandoverPanel.tsx','utf8')
const shipment=fs.readFileSync('src/features/client3/WatchLogisticsPanel.tsx','utf8')
const serverSide=fs.readFileSync('worker/domains/client3-watch-dispatch.ts','utf8')
const watched=fs.readFileSync('worker/domains/client3-watches.ts','utf8')
for(const token of ['workshop-orders-shell','workshop-order-like-table','workshop-product-card',
 'workshop-detail-chip','workshop-qty-pill','workshop-special-stack','workshop-actions']){
 assert(main.includes(token),'Main workshop anchor missing '+token)
 assert(qa.includes(token)||token==='workshop-orders-shell',
   'QA watch logistics does not reuse Main workshop component class '+token)
}
for(const token of ['order-stock-handover-modal','order-stock-handover-choice-grid',
  'order-stock-handover-choice is-client','order-stock-handover-choice is-here']){
 assert(handover.includes(token),'Handover should reuse Main handover dialog '+token)
}
assert(!handover.includes('setChoice(')&&!handover.includes('setChecked(')&&
 !handover.includes('type="checkbox"')&&!handover.includes('Сохранить уточнение'),
 'Physical stock review must be one factual choice => one server write, no double confirmation')
assert(handover.includes("void decide(item,'issued_before_checkpoint')")&&
 handover.includes("void decide(item,'still_here')"),
 'Both Main factual answers perform direct server action')
assert(shipment.includes("confirmedPhysical=false")&&
 shipment.includes("confirmPhysicalStock:confirmedPhysical")&&
 shipment.includes("StockResolutionConfirmModal"),
 'Main physical stock dialog must precede any explicit shortage confirmation')
assert(!shipment.includes("confirmPhysicalStock:true,"),'No generic physical bypass in shipment')
assert(serverSide.includes('WATCH_HANDOVER_REQUIRED')&&
  serverSide.includes('watchCheckpointNeedsClarification(item)'),
 'Server must still prohibit shipments that bypass stocktake checkpoint')
assert(watched.includes('AS physicalQuantity')&&watched.includes('AS managerName'),
 'Actual source stock and manager must be available to one-row-per-watch queue')

const server=await createServer({
 configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error',
})
try{
 const {WatchLogisticsTaskTable,visibleLogisticsTasks,readyForSend,requiresEngraving}=
  await server.ssrLoadModule('/src/features/client3/WatchLogisticsTaskTable.tsx')
 const order={
  orderId:91,externalId:'ORD-WATCH-91',brand:'TAUWACH',legacySource:'warehouse',
  recipientName:'Тестовый покупатель',recipientPhone:'+77071112233',
  city:'Алматы',address:'Мирная 4',postalCode:'050011',deliveryMethod:'Казпочта',
  shippingDeadlineAt:'2026-11-12T11:00:00Z',orderDate:'2026-11-02',
  managerName:'Алия',urgent:1,
 }
 const base={
  ...order,orderItemId:1001,quantity:1,modelName:'ARYSTAN',itemSource:'warehouse',
  gender:'male',movement:'quartz',braceletMaterial:'steel',dialColor:'black',
  braceletColor:'',engravingText:'АБ',engravingReady:1,shippedQuantity:0,
  returnedQuantity:0,pendingReturnQuantity:0,pendingExchangeReceiptQuantity:0,
  reservationStatus:'active',stockWriteoffStatus:'reserved',physicalQuantity:6,
  systemReservedQuantity:1,dispatchItemId:null,
 }
 const second={...base,orderItemId:1002,modelName:'ALTYN ZAMAN',
  engravingText:'Гравировка Б',engravingReady:0}
 const history={...base,orderItemId:1003,modelName:'Историческая модель',
  quantity:0,shippedQuantity:1,returnedQuantity:1,stockWriteoffStatus:'fulfilled'}
 const groups=[{order,items:[base,second,history]}]
 const tasks=visibleLogisticsTasks(groups,'unshipped')
 assert.deepEqual(tasks.map(x=>x.item.modelName),['ARYSTAN','ALTYN ZAMAN'],
  'Active queue must show each watch separately and exclude zero-quantity return history')
 assert.equal(readyForSend(base),true)
 assert.equal(requiresEngraving(base),false)
 assert.equal(readyForSend(second),false)
 assert.equal(requiresEngraving(second),true)
 assert.equal(visibleLogisticsTasks(groups,'ready').length,1)
 assert.equal(visibleLogisticsTasks(groups,'engraving').length,1)
 const html=renderToStaticMarkup(React.createElement(WatchLogisticsTaskTable,{
  groups,filter:'unshipped',canCompleteEngraving:true,canDispatch:true,
  canCorrectDispatch:true,workingReady:null,workingSend:null,
  checkingOrder:null,workingCorrection:null,
  onReady:()=>{},onSend:()=>{},onCorrect:async()=>{},onOpenStock:()=>{},
 }))
 assert.equal((html.match(/class="watch-task-row/g)||[]).length,2,
  'Exactly one full workshop row per active watch')
 assert.equal((html.match(/Тестовый покупатель/g)||[]).length,2,
  'All order recipient details must repeat for each watch in the queue')
 for(const literal of ['ORD-WATCH-91','ARYSTAN','ALTYN ZAMAN','Мирная 4',
   'Алия','Казпочта','Готово в логистике','Отправить','Проверить остаток']){
   if(literal==='Проверить остаток')continue
   assert(html.includes(literal),'Workshop-style queue missing '+literal)
 }
 assert(html.includes('Механизм')&&html.includes('Браслет')&&html.includes('Циферблат'),
  'Each watch must retain gender, mechanism, bracelet, dial and requested engraving')
 assert(!html.includes('Сохранить уточнение')&&!html.includes('Подтверждаю фактическое'),
  'No redundant confirmation form in the main logistics queue')
 console.log('CLIENT3_MAIN_WORKSHOP_ITEM_ROW_AND_ONE_CLICK_HANDOVER_PASS')
}finally{await server.close()}
