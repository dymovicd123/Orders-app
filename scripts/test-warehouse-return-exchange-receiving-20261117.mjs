import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pendingExchangePhysicalItems, pendingReturnPhysicalItems } from '../src/features/inventory/views/warehouseReceivingModel.ts'

const returns=[
  {id:1,operationType:'order_return',status:'completed',externalId:'ORD-1',customer:'Клиент',
    manager:'Асия',returnDate:'2026-11-15',city:'Алматы',
    items:[
      {id:11,productName:'Шапан',quantity:2,physicalTracking:true,physicalReceivedAt:null,
        sourceType:'boutique',color:'Синий',size:'48'},
      {id:12,productName:'Жилет',quantity:1,physicalTracking:true,physicalReceivedAt:'2026-11-17T00:00:00Z'},
      {id:13,productName:'Неотправленный',quantity:1,physicalTracking:false,physicalReceivedAt:null},
    ]},
  {id:2,operationType:'exchange_refund',status:'completed',items:[
    {id:21,productName:'Не включать возврат денег по обмену',quantity:3,physicalTracking:true,physicalReceivedAt:null}]},
  {id:3,operationType:'order_return',status:'cancelled',items:[
    {id:31,productName:'Отменённый',quantity:5,physicalTracking:true,physicalReceivedAt:null}]},
  {id:4,operationType:'order_return',status:'completed',externalId:'ORD-4',items:[
    {id:41,productName:'Цеховой',quantity:1,physicalTracking:true,physicalReceivedAt:null,
      sourceType:'workshop',isWorkshop:true}]},
]
const returnRows=pendingReturnPhysicalItems(returns)
assert.equal(returnRows.length,2,'Only physically pending valid return lines')
assert.deepEqual(returnRows.map(x=>x.key),['return:1:11','return:4:41'])
assert.equal(returnRows[0].defaultDestination,'boutique')
assert.equal(returnRows[1].defaultDestination,'no_stock')
assert.match(returnRows[0].characteristics,/Цвет: Синий/)
assert.equal(returnRows[0].operationItemId,11)

const exchanges=[
  {id:8,status:'completed',externalId:'ORD-8',customer:'Клиент 8',manager:'Асия',
    exchangeDate:'2026-11-14',oldItems:[
      {id:81,productName:'Шапан',quantity:1,color:'Бежевый',physicalTracking:true,
        physicalReceivedAt:null,sourceType:'warehouse'},
      {id:82,productName:'Бомбер',quantity:2,color:'Синий',physicalTracking:true,
        physicalReceivedAt:null,sourceType:'boutique'},
      {id:83,productName:'Уже принят',quantity:1,physicalTracking:true,
        physicalReceivedAt:'2026-11-17T00:00:00Z'},
    ]},
  {id:9,status:'completed',externalId:'ORD-9',exchangeDate:'2026-10-13',
    oldItems:[],oldOperationItemId:91,oldPhysicalTracking:true,
    oldPhysicalReceivedAt:null,oldProductName:'Кебек шапан',oldQuantity:1,oldIsWorkshop:true},
  {id:10,status:'cancelled',oldOperationItemId:101,oldPhysicalTracking:true,
    oldPhysicalReceivedAt:null,oldProductName:'Отменённый',oldQuantity:1},
  {id:11,status:'completed',oldItems:[
    {id:110,productName:'Уже получен',quantity:1,physicalTracking:true,physicalReceivedAt:'2026-11-17T00:00:00Z'}],
    oldOperationItemId:111,oldPhysicalTracking:true,oldPhysicalReceivedAt:null,
    oldProductName:'Не подставлять fallback',oldQuantity:1},
]
const exchangeRows=pendingExchangePhysicalItems(exchanges)
assert.deepEqual(exchangeRows.map(x=>x.key),['exchange:8:81','exchange:8:82','exchange:9:91'],
  'Preserve all old goods in Set V2 and never double-register fallback')
assert.deepEqual(exchangeRows.map(x=>x.defaultDestination),['warehouse','boutique','no_stock'])
assert.equal(exchangeRows[0].operationId,8)
assert.equal(exchangeRows[1].quantity,2)
assert.equal(exchangeRows[2].productName,'Кебек шапан')
assert.equal(exchangeRows.reduce((sum,x)=>sum+x.quantity,0),4)

const code=readFileSync('src/features/inventory/views/WarehouseReceivingWorkspace.tsx','utf8')
const inventory=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const app=readFileSync('src/App.tsx','utf8')
const returnsUi=readFileSync('src/features/sections/OrderReturnsSection.tsx','utf8')
const exchangesUi=readFileSync('src/features/sections/OrderExchangeSection.tsx','utf8')
const domain=readFileSync('src/features/orders/returnExchangeAftercareActions.ts','utf8')
const model=readFileSync('src/features/inventory/views/warehouseReceivingModel.ts','utf8')
const role=readFileSync('src/app/controllers/useOperationalViewModel.ts','utf8')

assert(inventory.includes("value: 'receiving' as const, label: 'Приёмка товаров'"))
assert(inventory.includes('warehousePhysicalReceivingCount > 0') && inventory.includes('returnPendingInbox?.pendingQuantity') && inventory.includes('exchangePendingInbox?.pendingQuantity'))
assert(inventory.includes('<WarehouseReceivingWorkspace') && inventory.includes('receiveItem={receiveReturnedItemAction}'))
assert(inventory.includes("setAttentionCategory('intake')") && inventory.includes('Завершить учёт'),
 'Independent already-received inventory lifecycle work must stay reachable')
assert(role.includes("'reports', 'receiving', 'attention'"),'Supervisor must be allowed through inventory panel style')
assert(app.includes("if (!authReady || activeSector !== 'inventory') return\n    // Both badge counts"))
assert(app.includes('loadReturnPendingInbox(false), loadExchangePendingInbox(false)'))
assert(app.includes('openWarehouseReceiving') && app.includes("setInventoryPanel('receiving')"))
assert(returnsUi.includes("useState<'form'|'history'>('form')"))
assert(!returnsUi.includes("activeView==='intake'"),'Return intake must move out of Orders')
assert(returnsUi.includes('setActiveView(\'history\')'))
assert(returnsUi.includes("openWarehouseReceiving('return')"))
assert(!exchangesUi.includes('className="intake-queue"'),'Exchange must not present a second intake queue')
assert(!exchangesUi.includes('receiptDestinations'),'No inline physical receipt selection remains in Exchange history')
assert(exchangesUi.includes("openWarehouseReceiving('exchange')"))
assert(returnsUi.includes('История возвратов') && exchangesUi.includes('Форма обмена'))
assert(code.includes("role=\"tablist\"") && code.includes('Приёмка возвратов') && code.includes('Приёмка вещей по обменам'))
assert(code.includes('returnInbox.pendingQuantity') && code.includes('exchangeInbox.pendingQuantity'))
assert(code.includes('disabled={busy || item.quantity <= 0}') && code.includes('setReceivingKey(item.key)'),
 'No parallel receive on the same screen')
assert(code.includes('await receiveItem({') && code.includes('await refreshAll()'))
assert(model.includes("entry.status === 'cancelled'"))
assert(domain.includes("'/api/returned-items/receive'") && domain.includes('prepareCriticalRequest(criticalKey, payload)'),
 'Use established idempotent receive flow with stocktake freshness guards')
assert(!code.includes("fetch(") && !code.includes("/api/returned-items/receive"),
 'The inventory view must not bypass canonical receipt action')
const receiptServer=readFileSync('worker/domains/order-returned-item-receipt.ts','utf8')
const labelsUi=readFileSync('src/features/inventory/views/UnitBarcodePreparation.tsx','utf8')
assert(receiptServer.includes("!isWorkshop && receivedVariantId > 0 && stockApplied"),
  'Only a completed non-workshop physical stock application can suggest barcode preparation')
assert(receiptServer.includes('barcodePreparation:') && receiptServer.includes('pendingInventoryCount:'),
  'Barcode suggestion supplements, never replaces, canonical receipt lifecycle')
assert(!receiptServer.includes('prepareUnitLabelBatch('),
  'Receiving an item must not silently create labels or duplicate stock movements')
assert(domain.includes('onBarcodePreparationReady') && code.includes('onBarcodePreparationReady: details'),
  'Only successful canonical receive result can offer post-intake labels')
assert(code.includes('<UnitBarcodePreparation') && code.includes('setReceivedForLabels(null)'),
  'Warehouse intake offers optional labels only after a successful receipt, reset between attempts')
assert(labelsUi.includes("initialSource || 'warehouse'") && labelsUi.includes('initialQuantity = 1'),
  'Label preparation safely preselects the recorded stock destination and number of pieces')
assert(labelsUi.includes('if (!initialSource && !data.locations.some('),
  'A post-receipt source must not silently change to a different location with available label capacity')
assert(code.includes('Это не новый приход: количество в остатке повторно не увеличится.'),
  'No ambiguity about whether label creation changes stock')

console.log('WAREHOUSE_RECEIVING_BRANCH2_PASS: 2 work queues, accurate badges, Set V2, cancellation guard, same physical receive API, order history retained')
