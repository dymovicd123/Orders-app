import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {skuBarcodeForVariantId} from '../shared/barcode-sku.ts'
import {resolveOperationBarcode,nextSharedSkuDraftQuantity} from
  '../src/features/inventory/operationBarcodeSelection.ts'

const code=skuBarcodeForVariantId(101)
const lookup={ok:true,active:true,barcodeType:'sku',barcode:code,
  physicalUnit:false,variantId:101,productName:'ШАПАН'}
const found=resolveOperationBarcode(code.toLowerCase(),lookup,'warehouse')
assert.equal(found.kind,'sku')
assert.equal(found.variantId,101)
assert.throws(()=>resolveOperationBarcode(code,{...lookup,active:false},'warehouse'),
  /Код не найден/)
assert.throws(()=>resolveOperationBarcode(code,{...lookup,barcode:skuBarcodeForVariantId(102)},'warehouse'),
  /Общий код/)

let drafted=0
drafted=nextSharedSkuDraftQuantity('writeoff',drafted)
assert.equal(drafted,1,'One scanned SKU means exactly one in the draft')
drafted=nextSharedSkuDraftQuantity('writeoff',drafted)
assert.equal(drafted,2,'Second explicit scan of the same SKU adds another draft piece')
drafted=5 // Operator manually corrected the quantity
drafted=nextSharedSkuDraftQuantity('writeoff',drafted)
assert.equal(drafted,6,'Manual changes remain editable, next scan continues from them')
assert.equal(nextSharedSkuDraftQuantity('transfer',0),1)
assert.equal(nextSharedSkuDraftQuantity('transfer',99),100)
assert.equal(nextSharedSkuDraftQuantity('arrival',8),null,
  'Arrival SKU scan must identify only: the user supplies a quantity')
assert.equal(nextSharedSkuDraftQuantity('manual_set',0),null,
  'Correction must require a manually verified absolute quantity, including zero')
assert.throws(()=>nextSharedSkuDraftQuantity('writeoff',999999),/999999/)
assert.throws(()=>nextSharedSkuDraftQuantity('transfer',-1),/999999/)
assert.throws(()=>nextSharedSkuDraftQuantity('transfer',Number.NaN),/999999/)

const ui=readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
const worker=readFileSync('worker/index.ts','utf8')
assert(ui.includes("if (mode==='writeoff'||mode==='transfer')")&&
 ui.includes('nextSharedSkuDraftQuantity(mode,currentQuantity)')&&
 ui.includes('p.onQuantity(row,String(nextQuantity))'),
 'A common SKU in writeoff/transfer must add to the draft, not open the old total-input form')
assert(ui.includes("mode==='manual_set'")&&ui.includes("mode==='arrival'")&&
 ui.includes('Укажите фактический остаток')&&
 ui.includes('Укажите, сколько единиц поступило'),
 'Stock correction/arrival keep lookup-only and an explicit total')
assert(ui.includes('scansRef.current.some(unit=>unit.unitId===match.unitId||unit.code===code)')&&
 ui.includes('p.onSave(scannedUnits.map(unit=>unit.code))'),
 'Individual unit de-duplication and atomic backend tracking must stay untouched')
assert(ui.includes("stage==='review'")&&ui.includes("names[mode].action")&&
 ui.includes('Остатки изменятся только после итогового подтверждения'),
 'Scan must only update draft; review and final confirmation are unchanged')
assert(worker.includes('prepareOutboundBarcodeStatements')||
 worker.includes('transferBarcodeStatements'),
 'Existing worker-side barcode source/identity guards must be retained')
console.log('OUTBOUND_SHARED_SKU_DRAFT_PASS: OCS1 +1 per explicit scan in writeoff/transfer, manually editable, other modes lookup-only, OCU1 unique, no scan-side stock mutations')
