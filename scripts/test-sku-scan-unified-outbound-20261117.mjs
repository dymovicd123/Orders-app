import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveOperationBarcode } from '../src/features/inventory/operationBarcodeSelection.ts'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'
import { unitBarcodeFromEntropy } from '../shared/barcode-unit.ts'

const code = skuBarcodeForVariantId(218)
const sku = {
  ok:true, active:true, barcodeType:'sku', barcode:code,
  physicalUnit:false, variantId:218, productName:'ШАПАН',
}
assert.deepEqual(resolveOperationBarcode(code.toLowerCase(),sku,'warehouse'),{
  kind:'sku', variantId:218,productName:'ШАПАН',
})
assert.deepEqual(resolveOperationBarcode(code,sku,'boutique'),{
  kind:'sku', variantId:218,productName:'ШАПАН',
},'Shared SKU identifies one variant at any location, not individual physical stock')
for (const payload of [
  {...sku,active:false},
  {...sku,ok:false},
  {...sku,barcode:skuBarcodeForVariantId(219)},
  {...sku,variantId:219},
  {...sku,physicalUnit:true},
  {...sku,barcodeType:'unknown'},
  {...sku,variantId:0},
]) assert.throws(()=>resolveOperationBarcode(code,payload,'warehouse'),
  'Retired/corrupt/mismatched/common variant codes must be refused')
const individual = unitBarcodeFromEntropy(new Uint8Array([1,2,3,4,5,6,7,8]))
const unit = {ok:true,active:true,barcodeType:'unit',variantId:218,unitId:'uuid-218',
  source:'warehouse',status:'on_hand',productName:'ШАПАН'}
assert.deepEqual(resolveOperationBarcode(individual,unit,'warehouse'),{
  kind:'unit',variantId:218,unitId:'uuid-218',productName:'ШАПАН'
})
for(const invalid of [
  {...unit,source:'boutique'},
  {...unit,status:'not_stock'},
  {...unit,status:'revoked'},
  {...unit,active:false},
  {...unit,unitId:''},
]) assert.throws(()=>resolveOperationBarcode(individual,invalid,'warehouse'))
assert.throws(()=>resolveOperationBarcode('NOT_A_BARCODE',unit,'warehouse'))

const ui=readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
const panel=readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx','utf8')
const css=readFileSync('src/styles/193-unified-inventory-operations.css','utf8')
const domain=readFileSync('worker/domains/inventory-outbound-barcode.ts','utf8')
const actions=readFileSync('src/features/inventory/inventoryMovementActions.ts','utf8')

assert(ui.includes("const match=resolveOperationBarcode(code,data,source)") &&
  ui.includes("if (match.kind==='sku')"),
  'One barcode input must resolve verified shared SKU and individual unit metadata')
const skuPart=ui.slice(ui.indexOf("if (match.kind==='sku')"),ui.indexOf("if (scansRef.current.some",ui.indexOf("if (match.kind==='sku')")))
assert(skuPart.includes('setMatchedSkuId(match.variantId)') &&
  skuPart.includes("setStage('quantities')") &&
  !skuPart.includes('p.onQuantity(') &&
  !skuPart.includes('setScannedUnits('),
  'Scanning common SKU must locate a product but must never increment quantity or track physical units')
assert(ui.includes('function applySkuQuantity()') &&
  ui.includes('p.onQuantity(matchedSkuRow,String(quantity))') &&
  ui.includes('onSubmit={event=>{event.preventDefault();applySkuQuantity()}}') &&
  ui.includes('scanInputRef.current?.focus()'),
  'Only explicit quantity action may enter the SKU total in the canonical operation')
assert(ui.includes('if (quantity < scannedSkuMin)') &&
  ui.includes('if (matchedSkuId !== null) {setNotice('),
  'Mixed SKU and unit scans must not reduce individually counted units or lose unsaved quantity')
assert(ui.includes("p.onSave(scannedUnits.map(unit=>unit.code))") &&
  ui.includes('scansRef.current=next;setScannedUnits(next)') &&
  ui.includes("if (match.kind==='sku')"),
  'Existing individual-unit physical evidence must remain the only barcode payload for writes')
assert(ui.includes('stocktake-selective-picker') &&
  ui.includes('stocktake-selective-list') &&
  ui.includes('onChange={raw=>') &&
  ui.includes('StocktakeSizeCountCell'),
  'Full manual product chooser and original quantity input must remain usable without labels')
assert(ui.includes('role="group" aria-label="Количество найденного варианта"') &&
  ui.includes('По системе в {sourceName(source)') &&
  ui.includes('Общий код SKU найдёт вариант') &&
  ui.includes('Найти по коду'),
  'Scanning must show clear choice, stock and requested quantity in the normal workflow')
assert(css.includes('.operation-sku-match') && css.includes('@media(max-width:650px)'),
  'Quick quantity panel must be responsive')
assert(panel.includes('onSave={codes=>ctx.saveInventoryMovement(codes)}') &&
  actions.includes('unitBarcodes,') &&
  domain.includes('normalizeOutboundUnitBarcodes'),
  'Existing source-sensitive stock accounting and individual-unit server checks must be preserved')
console.log('SKU_SCAN_OUTBOUND_PASS: shared SKU selects only, explicit quantity, existing physical unit evidence, manual fallback, no stock writes')
