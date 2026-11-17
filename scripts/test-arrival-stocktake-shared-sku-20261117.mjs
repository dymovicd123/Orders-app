import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findStocktakeSku } from '../src/features/inventory/stocktakeSkuFinder.ts'
import { resolveOperationBarcode } from '../src/features/inventory/operationBarcodeSelection.ts'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'

const groups=[
  { productName:'ШАПАН',rows:[
    {id:12,variantId:101,color:'ХАКИ',size:'48'},
    {id:13,variantId:102,color:'ХАКИ',size:'50'},
  ]},
  {productName:'БОМБЕР',rows:[{id:14,variantId:103,color:'КРАСНЫЙ',size:'48'}]},
]
assert.deepEqual(findStocktakeSku(groups,101),{groupIndex:0,itemId:12,label:'ШАПАН · ХАКИ · 48'})
assert.deepEqual(findStocktakeSku(groups,103),{groupIndex:1,itemId:14,label:'БОМБЕР · КРАСНЫЙ · 48'})
assert.equal(findStocktakeSku(groups,104),null,'A variant absent in this selective session is not selected')
assert.equal(findStocktakeSku(groups,0),null)
assert.equal(findStocktakeSku([...groups,{productName:'Дублируется',rows:[{id:15,variantId:101}]}],101),null,
  'Colliding active session rows cannot silently select a wrong physical count item')
assert.equal(findStocktakeSku([{productName:'Неполная строка',rows:[{id:0,variantId:101}]}],101),null)

const code=skuBarcodeForVariantId(101)
const match=resolveOperationBarcode(code.toLowerCase(),{
  ok:true,active:true,barcodeType:'sku',physicalUnit:false,barcode:code,variantId:101,productName:'ШАПАН',
},'warehouse')
assert.deepEqual(match,{kind:'sku',variantId:101,productName:'ШАПАН'})
assert.throws(()=>resolveOperationBarcode(code,{
  ok:true,active:false,barcodeType:'sku',physicalUnit:false,barcode:code,variantId:101,
},'warehouse'))
assert.throws(()=>resolveOperationBarcode(code,{
  ok:true,active:true,barcodeType:'sku',physicalUnit:false,barcode:skuBarcodeForVariantId(102),variantId:101,
},'warehouse'))

const arrival=readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
const scanner=readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
const view=readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx','utf8')
const cells=readFileSync('src/features/inventory/views/StocktakeSharedInputs.tsx','utf8')
const server=readFileSync('worker/domains/stocktake-barcode-scan.ts','utf8')

assert(arrival.includes("mode==='arrival') && stage!=='review' && stage!=='complete'"))
assert(arrival.includes("if (mode==='arrival' && data.barcodeType!=='sku')"))
assert(arrival.includes("mode==='arrival'?'Всего пришло'"))
assert(arrival.includes("скан ничего не добавляет к приходу") ||
  arrival.includes("Скан ничего не добавляет к приходу"))
assert(arrival.includes("p.onQuantity(matchedSkuRow,String(quantity))"),
  'Only explicit quantity submission updates the arrival draft, not scanning')
const arrivalScan=arrival.slice(arrival.indexOf('async function scanOperationUnit()'),arrival.indexOf('function applySkuQuantity()'))
assert(!arrivalScan.includes('p.onSave(') && !arrivalScan.includes('p.onInlineArrivalVariant('),
  'Scanning SKU must not commit an arrival or create a missing variant')
assert(arrival.includes("setShowArrivalPrint(true)")&&arrival.includes('arrivalLabelPrinter'),
  'Existing optional label printing remains available after successful arrival')
assert(arrival.includes("mode === 'arrival' ? extraArrival.rows : 0"),
  'Manual addition of missing variants remains supported')

assert(scanner.includes("method: 'POST'") && scanner.includes('requestId: attempt.requestId'))
assert(scanner.includes('onScannedRef.current(result)') && scanner.includes('StocktakeCameraScanGate'),
  'Shared SKU and individual units both count in a continuous single-click-free process')
assert(scanner.includes("event.key === 'Enter'") && scanner.includes("event.key === 'Tab'"))
assert(server.includes('scanStocktakeSku') && server.includes('scanStocktakeUnit'))
assert(view.includes('onScanned={onStocktakeBarcodeScan}'))
assert(!view.includes('onSkuFound={'), 'SKU scanning must not navigate away from the next scan')
assert(view.includes('data-stocktake-count-input="1"') || view.includes('<StocktakeSizeCountCell'))
assert(cells.includes('data-stocktake-item-id={stocktakeField ? cellId : undefined}'))
assert(view.includes('setStocktakeFact(Number(row.id), value)')&&view.includes('persistStocktakeFact(Number(row.id), raw)'),
  'Counting remains in the existing server session and autosave machinery')
assert(server.includes('scanStocktakeUnit'), 'Backend individual scan unchanged')
console.log('ARRIVAL_STOCKTAKE_SHARED_SKU_PASS: optional arrival lookup, exact stocktake navigation, no SKU count writes, unit scan preserved, manual+print retained')
