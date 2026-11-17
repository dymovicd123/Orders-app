import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { identifyReceivingBarcode, matchingReceivingItems, pendingReturnPhysicalItems, pendingExchangePhysicalItems } from '../src/features/inventory/views/warehouseReceivingModel.ts'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'
import { unitBarcodeFromEntropy } from '../shared/barcode-unit.ts'

const code=skuBarcodeForVariantId(315)
const sku={ok:true,active:true,barcodeType:'sku',physicalUnit:false,barcode:code,variantId:315,
  productName:'ШАПАН',gender:'МУЖ',color:'ХАКИ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'48'}
const variant=identifyReceivingBarcode(code.toLowerCase(),sku)
assert.equal(variant.variantId,315)
const unit=unitBarcodeFromEntropy(new Uint8Array([9,1,7,2,3,4,5,6]))
const individual={...sku,barcodeType:'unit',barcode:unit,physicalUnit:true,active:false,
  unitId:'unit-315',status:'not_stock',receivingIdentifiable:true}
assert.equal(identifyReceivingBarcode(unit,individual).kind,'unit',
  'Issued item can still identify a pending return even when not counted in current stock')
for(const invalid of [
  {...individual,receivingIdentifiable:false},
  {...individual,status:'revoked'},
  {...individual,status:'on_hand'},
  {...individual,status:'prepared'},
]) assert.throws(()=>identifyReceivingBarcode(unit,invalid))
assert.throws(()=>identifyReceivingBarcode(code,{...sku,barcode:skuBarcodeForVariantId(316)}))
assert.throws(()=>identifyReceivingBarcode(code,{...sku,active:false}))
assert.throws(()=>identifyReceivingBarcode(unit,{...individual,unitId:''}))
const item=(id,variantId,color='ХАКИ')=>({id,productName:'ШАПАН',quantity:1,
  currentVariantId:variantId,physicalTracking:true,physicalReceivedAt:null,sourceType:'warehouse',
  gender:'МУЖ',color,material:'СТАНДАРТ',length:'СТАНДАРТ',size:'48'})
const returns=[
 {id:11,operationType:'order_return',status:'completed',externalId:'ORD-11',items:[item(111,315)]},
 {id:12,operationType:'order_return',status:'completed',externalId:'ORD-12',items:[item(121,315)]},
 {id:13,operationType:'order_return',status:'completed',externalId:'ORD-13',items:[item(131,316)]},
 {id:14,operationType:'order_return',status:'completed',externalId:'ORD-14',items:[item(141,315,'БЕЖЕВЫЙ')]},
 {id:15,operationType:'order_return',status:'completed',externalId:'ORD-15',items:[{...item(151,315),lifecycleVariantId:317}]},
 {id:16,operationType:'order_return',status:'completed',externalId:'ORD-16',items:[{...item(161,null),currentVariantId:null}]},
 {id:17,operationType:'order_return',status:'cancelled',externalId:'ORD-17',items:[item(171,315)]},
 {id:18,operationType:'order_return',status:'completed',externalId:'ORD-18',items:[{...item(181,315),sourceType:'workshop'}]},
 {id:19,operationType:'order_return',status:'completed',externalId:'ORD-19',items:[{...item(191,315),physicalReceivedAt:'2026-11-17T00:00:00Z'}]},
]
const pendingReturns=pendingReturnPhysicalItems(returns)
assert.deepEqual(matchingReceivingItems(pendingReturns,variant).map(x=>x.key),['return:11:111','return:12:121'],
  'Two identical SKUs from different orders must remain separate choices, not automatically accept one')
assert.deepEqual(matchingReceivingItems(pendingReturns,{...variant,variantId:316}),[],
  'Barcode variant must match a canonical ID, not an identically named model')
assert.equal(pendingReturns.find(x=>x.key==='return:16:161')?.currentVariantId,null)
const exchanges=[{id:40,status:'completed',externalId:'ORD-40',oldItems:[
 {...item(401,315),lifecycleVariantId:315},
 {...item(402,315),color:'БЕЖЕВЫЙ'},
 {...item(403,315),physicalReceivedAt:'2026-11-17T00:00:00Z'},
]}, {id:41,status:'completed',externalId:'ORD-41',oldItems:[],
 oldOperationItemId:411,oldPhysicalTracking:true,oldPhysicalReceivedAt:null,
 oldCurrentVariantId:315,oldLifecycleVariantId:315,
 oldProductName:'ШАПАН',oldQuantity:1,oldGender:'МУЖ',oldColor:'ХАКИ',oldMaterial:'СТАНДАРТ',oldLength:'СТАНДАРТ',oldSize:'48',
 oldSourceType:'warehouse'}]
const pendingExchanges=pendingExchangePhysicalItems(exchanges)
assert.deepEqual(matchingReceivingItems(pendingExchanges,variant).map(x=>x.key),['exchange:40:401','exchange:41:411'],
  'Both Set V2 and legacy old-item receipts remain discoverable without mixing orders')
const ui=readFileSync('src/features/inventory/views/WarehouseReceivingWorkspace.tsx','utf8')
const client=readFileSync('src/features/inventory/views/warehouseReceivingBarcodeClient.ts','utf8')
const unitDomain=readFileSync('worker/domains/barcode-unit-preparation.ts','utf8')
const types=readFileSync('src/app/types.ts','utf8')
assert(ui.includes('lookupReceivingBarcode(barcodeInput)') &&
  ui.includes('matchingReceivingItems(returnItems,barcodeMatch)') &&
  ui.includes('matchingReceivingItems(exchangeItems,barcodeMatch)'))
assert(client.includes("method:'GET'") && client.includes('/api/barcodes/lookup?code='))
assert(!client.includes("method:'POST'") && !ui.includes("fetch("),
  'Scanning is GET-only and cannot bypass canonical idempotent receiving action')
assert(ui.includes('await receiveItem({') && ui.includes('onBarcodePreparationReady: details') &&
  ui.includes('clearBarcodeSearch()') && ui.includes('Показать все'))
assert(ui.includes('Сверьте номер заказа') && ui.includes('Очередь загружена не полностью'))
assert(unitDomain.includes("receivingIdentifiable: row.label_state === 'active'") &&
  unitDomain.includes("const active = row.label_state === 'active'"),
  'Receiving identity is additive; existing on-hand eligibility remains unchanged')
assert(types.includes('oldCurrentVariantId?: number | null') &&
  types.includes('currentVariantId?: number | null'))
console.log('RECEIVING_BARCODE_MATCH_PASS: SKU/issued label identification, canonical ID/snapshot safety, multiple orders, manual fallback, no scan-side writes')
