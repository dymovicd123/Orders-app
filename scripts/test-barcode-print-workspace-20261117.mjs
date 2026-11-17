import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { skuBarcodeForVariantId, variantIdFromSkuBarcode } from '../shared/barcode-sku.ts'
import { encodeCode128B } from '../shared/barcode-code128.ts'

const page = readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx','utf8')
const layout = readFileSync('src/features/inventory/views/barcodePrintWorkspace.css','utf8')
const section = readFileSync('src/features/sections/InventorySection.tsx','utf8')
const app = readFileSync('src/App.tsx','utf8')
const types = readFileSync('src/app/types.ts','utf8')
const viewModel = readFileSync('src/app/controllers/useOperationalViewModel.ts','utf8')
const catalog = readFileSync('src/features/inventory/views/renderInventoryCatalogPanel.tsx','utf8')
const cards = readFileSync('src/features/inventory/views/catalogPolishExecutionGroups.tsx','utf8')
const domain = readFileSync('worker/domains/barcode-sku.ts','utf8')

assert(types.includes("| 'barcodes' |"), 'Barcode panel must have a dedicated navigation key')
assert(viewModel.includes("'catalog', 'barcodes', 'history'"), 'Admin/warehouse access to tab is missing')
assert(section.includes("value: 'barcodes' as const, label: 'Штрихкоды'"), 'Barcode tab must be visible alongside catalog')
assert(section.includes("inventoryPanel === 'barcodes' ? <BarcodePrintWorkspace"), 'Barcode workspace is not mounted')
assert(section.includes("catalog={catalogData} stock={inventoryData}"), 'Barcode workspace lacks canonical full stock snapshots')
assert(app.includes('inventorySourceRows, inventoryData, inventorySnapshotLoadErrors,'), 'App must pass actual stock state')
assert(section.includes("loadCatalogData(true)") &&
  section.includes("loadInventoryData('warehouse', true, '', false)") &&
  section.includes("loadInventoryData('boutique', true, '', false)"),
  'Both location snapshots and catalog must be refreshed before printable quantities are enabled')
assert(!catalog.includes('SkuBarcodeLookup') && !catalog.includes('catalog-barcode-overview'),
  'Catalog still contains a barcode scanner or banner')
assert(!cards.includes('<SkuBarcodeButton') && !cards.includes('<UnitBarcodePreparation'),
  'Catalog still contains barcode-related actions in item cards')
assert(page.includes('Только товары с остатком') && page.includes('Поиск товара'),
  'Search and stock filters should be visible on the new page')
assert(page.includes('Склад <strong>{balance.warehouse}') &&
  page.includes('Бутик <strong>{balance.boutique}') &&
  page.includes('Всего {physical} шт.'),
  'Warehouse and boutique quantities are not distinguishable')
assert(page.includes('const ready = Boolean(!refreshing && !loadError && catalog?.ok') &&
  page.includes('stock.warehouse?.ok && stock.boutique?.ok'),
  'Partial/failed snapshots must not display misleading zero stock')
assert(page.includes('const canPrint = ready && !printing') &&
  page.includes('!invalidStock && excess.length === 0'),
  'Print must remain disabled with invalid stock')
assert(page.includes('const target = window.open(') &&
  page.indexOf('const target = window.open(') < page.indexOf("await fetch('/api/barcodes/sku/'"),
  'Print popup should open synchronously before network validation')
assert(page.includes('record.physicalUnit !== false') &&
  page.includes('record.barcode !== skuBarcodeForVariantId(item.variant.id)') &&
  page.includes('textOf(record.size) !== textOf(item.variant.sizeLabel)'),
  'Selected barcode identities require a fresh server preflight')
assert(page.includes('const current = await onReload()') &&
  page.includes("const matches = current[source].items.filter(row => row.variantId === item.variant.id)") &&
  page.includes('if (item.quantity > physical)'),
  'Print must revalidate actual quantities at both sources before generating labels')
assert(page.includes('MAX_LABELS = 300') && page.includes('totalLabels <= MAX_LABELS'),
  'Mass-print action lacks a bounded cap')
assert(page.includes('Каждый вариант') || page.includes('Один вариант имеет один общий код'),
  'Human print instructions should explain SKU copies')
assert(page.includes('window.print()') && page.includes('58mm 35mm') &&
  page.includes('Печатать / Сохранить в PDF'),
  'Print preview must explain the correct physical label sheet')
assert(layout.includes('grid-template-columns') && layout.includes('@media(max-width:650px)') &&
  layout.includes('barcode-print-footer'), 'Desktop/mobile list-and-print layout missing')
assert(!/fetch\([^)]*,\s*\{[^}]*method:\s*['"]POST/s.test(page),
  'The barcode printing screen cannot mutate stock or label state')
assert(domain.includes("readCatalogSkuBarcode"), 'Read-only SKU identity resolver must remain intact')
for(const n of [1, 101, 123456]){
  const barcode=skuBarcodeForVariantId(n)
  assert.equal(variantIdFromSkuBarcode(barcode),n)
  assert(encodeCode128B(barcode).bars.length>12)
}
console.log('BARCODE_PRINT_WORKSPACE_PASS: clean catalog, clear navigation, fresh stocks, multi-SKU labels and read-only verified print')
