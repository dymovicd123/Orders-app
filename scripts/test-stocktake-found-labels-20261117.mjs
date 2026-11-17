import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stocktakeFoundSkuPrintReceipt } from '../src/features/inventory/stocktakeFoundSkuPrint.ts'

const startedAt='2026-11-17T10:00:00.000Z'
const baseRow={
  sessionId:'REV-S-P-20261117100000-AAAA1111', source:'warehouse', stockId:null,
  id:1, productId:1, variantId:57, productName:'АБАЙ ТАКИЯ',
  category:'adult', gender:'МУЖ', color:'ТЕМНО-СИНИЙ',
  material:'СТАНДАРТ', length:'СТАНДАРТ',size:'57',openingQuantity:0,
  openingReservedQuantity:0, baselineQuantity:0, countedQuantity:2,
  countedAt:'2026-11-17T10:02:00.000Z', status:'applied',
  conflictQuantity:null, appliedQuantity:2, currentQuantity:2,reservedQuantity:0,
  createdAt:'2026-11-17T10:01:00.000Z',
}
const session={
  id:baseRow.sessionId, source:'warehouse', scope:'selective',status:'completed',
  createdBy:'admin',startedAt,updatedAt:'2026-11-17T10:04:00.000Z',
  completedAt:'2026-11-17T10:04:00.000Z',cancelledAt:null,totalItems:1,
  countedCount:1,recountCount:0,shortageCount:0,items:[baseRow],
}
const receipt=stocktakeFoundSkuPrintReceipt(session)
assert.equal(receipt?.operationId,'stocktake:'+session.id)
assert.equal(receipt?.source,'warehouse')
assert.deepEqual(receipt?.items,[{variantId:57,quantity:2,productName:'АБАЙ ТАКИЯ',
  variantLabel:'МУЖ · ТЕМНО-СИНИЙ · 57'}])

const row=(props={})=>({...baseRow,id:Math.random(),...props})
assert.equal(stocktakeFoundSkuPrintReceipt({...session,status:'active'}),null,
  'Before completion nothing can be offered as a completed-stocktake print receipt')
assert.equal(stocktakeFoundSkuPrintReceipt({...session,status:'cancelled'}),null)
assert.equal(stocktakeFoundSkuPrintReceipt({...session,items:[row({variantId:0})]}),null,
  'Found physical stock without canonical SKU cannot be printed until separately resolved')
assert.equal(stocktakeFoundSkuPrintReceipt({...session,items:[row({createdAt:startedAt})]}),null,
  'Original revision rows, even with a physical gain, are not newly found candidates')
assert.equal(stocktakeFoundSkuPrintReceipt({...session,items:[row({baselineQuantity:3,appliedQuantity:2})]}),null,
  'Shortages and decreasing stock can never suggest new labels')
assert.equal(stocktakeFoundSkuPrintReceipt({...session,items:[row({countedQuantity:null})]}),null,
  'Unconfirmed quantities cannot become labels')
assert.equal(stocktakeFoundSkuPrintReceipt({...session,items:[row({status:'recount_required'})]}),null)
assert.equal(stocktakeFoundSkuPrintReceipt({...session,items:[row({appliedQuantity:null})]}),null)
assert.equal(stocktakeFoundSkuPrintReceipt({...session,items:[row({baselineQuantity:2,appliedQuantity:2,countedQuantity:2})]}),null)
assert.deepEqual(stocktakeFoundSkuPrintReceipt({...session,source:'boutique',items:[row({
  baselineQuantity:3,openingQuantity:3,appliedQuantity:5,countedQuantity:5,
})]})?.items[0]?.quantity,2,
  'Only the positive newly found increment is offered, not all existing stock')

const mixed=stocktakeFoundSkuPrintReceipt({...session,items:[
  baseRow,row({id:2,variantId:0,createdAt:'2026-11-17T10:03:00.000Z'}),
  row({id:3,variantId:80,appliedQuantity:1,countedQuantity:1}),
  row({id:4,variantId:57,appliedQuantity:1,countedQuantity:1}),
]})
assert.equal(mixed?.items.length,2)
assert.equal(mixed?.items.find(item=>item.variantId===57)?.quantity,3,
  'Only one label row per exact SKU, summing distinct physical discoveries')
assert.equal(mixed?.items.find(item=>item.variantId===80)?.quantity,1)

const panel=readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx','utf8')
const controller=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const api=readFileSync('worker/domains/inventory-stocktake.ts','utf8')
const contracts=readFileSync('shared/api-contracts.ts','utf8')
const printer=readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx','utf8')
const css=readFileSync('src/styles/w5-checking-ux.css','utf8')

assert(contracts.includes('createdAt: string')&&api.includes('createdAt: cleanText(row.created_at)'),
  'Actual server item creation time is necessary to separate discovered rows from original counts')
assert(panel.includes('stocktakePrintOpen')&&panel.includes('stocktakeLabelPrinter'))
assert(panel.includes('Распечатать этикетки для найденных товаров?')&&panel.includes('Завершить без печати'))
assert(panel.includes('Уточнить найденные'), 'Unknown found stock must retain resolver action')
assert(controller.includes('stocktakePrintReceipt = stocktakeFoundSkuPrintReceipt(stocktakeSession)'))
assert(controller.includes('stocktakePrintSessionId === stocktakeSession?.id'),
  'Print state must not carry into a different revision')
assert(controller.includes('setStocktakePrintSessionId(null)'))
assert(controller.includes('receiptKind="stocktake"')&&controller.includes('embeddedAfterArrival'))
assert(printer.includes("receiptKind === 'stocktake' ? <span>Найдено") &&
  printer.includes('Поступило <strong>{received} шт.</strong>'),
  'Printer must distinguish a finished stocktake from a saved arrival')
assert(printer.includes("record.barcode !== skuBarcodeForVariantId(item.variant.id)"),
  'Printer must validate canonical SKU before output')
assert(!panel.includes('useState('), 'Stocktake panel should remain hook-free')
assert(css.includes('.stocktake-outcome-label-offer')&&css.includes('.stocktake-outcome-label-print'))
console.log('STOCKTAKE_FOUND_LABELS_PASS: physical found stock applied first; optional print or skip, no re-arrival, SKU-only, unresolved excluded, original rows excluded')
