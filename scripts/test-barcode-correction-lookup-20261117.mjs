import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveOperationBarcode } from '../src/features/inventory/operationBarcodeSelection.ts'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'
import { unitBarcodeFromEntropy } from '../shared/barcode-unit.ts'

const sku=skuBarcodeForVariantId(315)
const individual=unitBarcodeFromEntropy(new Uint8Array([8,7,6,5,4,3,2,1]))
const skuResult={ok:true,active:true,barcodeType:'sku',barcode:sku,physicalUnit:false,
  variantId:315,productName:'ШАПАН'}
const unitResult={ok:true,active:true,barcodeType:'unit',variantId:315,unitId:'unit-315',
  source:'warehouse',status:'on_hand',productName:'ШАПАН'}
assert.deepEqual(resolveOperationBarcode(sku,skuResult,'warehouse'),{
  kind:'sku',variantId:315,productName:'ШАПАН',
})
assert.deepEqual(resolveOperationBarcode(individual,unitResult,'warehouse'),{
  kind:'unit',variantId:315,unitId:'unit-315',productName:'ШАПАН',
})
assert.throws(()=>resolveOperationBarcode(individual,{...unitResult,source:'boutique'},'warehouse'))
assert.throws(()=>resolveOperationBarcode(individual,{...unitResult,status:'revoked'},'warehouse'))
assert.throws(()=>resolveOperationBarcode(sku,{...skuResult,active:false},'warehouse'))

const ui=readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
const panel=readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx','utf8')
const worker=readFileSync('worker/domains/inventory-movement.ts','utf8')
assert(ui.includes("(mode==='transfer'||mode==='writeoff'||mode==='manual_set')"),
  'Stock corrections must expose the same barcode input as transfer and writeoff')
assert(ui.includes("const match=resolveOperationBarcode(code,data,source)"),
  'All barcode lookups must verify active variant and physical source')
const locate=ui.slice(ui.indexOf("if (mode==='manual_set') {",ui.indexOf("async function scanOperationUnit()")),
  ui.indexOf("if (scansRef.current.some",ui.indexOf("async function scanOperationUnit()")))
assert(locate.includes('setMatchedSkuId(match.variantId)') &&
  locate.includes("setStage('quantities')") &&
  !locate.includes('p.onQuantity(') &&
  !locate.includes('setScannedUnits('),
  'An individual scan may select a correction row but must never increment or create physical-unit evidence')
const skuLocate=ui.slice(ui.indexOf("if (match.kind==='sku')"),ui.indexOf("if (mode==='manual_set') {",ui.indexOf("async function scanOperationUnit()")))
assert(!skuLocate.includes('p.onQuantity(') &&
  skuLocate.includes('setMatchedSkuId(match.variantId)'),
  'Shared SKU is a picker, not a stock mutation')
assert(ui.includes("mode==='manual_set'?'Фактический остаток'") &&
  ui.includes("mode==='manual_set' && existingDraft?.touched") &&
  ui.includes("Фактический остаток '+quantity+' шт. внесён в черновик"),
  'Operator must explicitly submit final stock, including zero or a previously touched zero')
assert(ui.includes('p.onQuantity(matchedSkuRow,String(quantity))') &&
  ui.includes('p.onSave(scannedUnits.map(unit=>unit.code))') &&
  ui.includes('stocktake-selective-picker') &&
  ui.includes('StocktakeSizeCountCell'),
  'Original manual selection and explicit final-review save must remain intact')
assert(worker.includes("scannedBarcodes.length && movementType !== 'writeoff'") &&
  panel.includes('onSave={codes=>ctx.saveInventoryMovement(codes)}'),
  'Corrections must never pass physical outbound evidence to the writeoff ledger')
console.log('BARCODE_CORRECTION_LOOKUP_PASS: shared/individual lookup, explicit final count, zero preserved, unchanged stock until confirmation')
