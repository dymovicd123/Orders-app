import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { skuBarcodeForVariantId, variantIdFromSkuBarcode } from '../shared/barcode-sku.ts'
import { encodeCode128B } from '../shared/barcode-code128.ts'

const page = readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx','utf8')
const layout = readFileSync('src/features/inventory/views/barcodePrintWorkspace.css','utf8')
const navigationCss = readFileSync('src/styles/w9-warehouse-catalog-cleanup.css','utf8')
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
assert(page.includes('<small>Склад</small> <strong>{balance.warehouse}</strong>') &&
  page.includes('<small>Бутик</small> <strong>{balance.boutique}</strong>') &&
  page.includes('Всего {physical} шт.'),
  'Warehouse and boutique quantities are not distinguishable')
assert(page.includes('const ready = Boolean(!refreshing && !loadError && catalog?.ok') &&
  page.includes('stock.warehouse?.ok && stock.boutique?.ok'),
  'Partial/failed snapshots must not display misleading zero stock')
assert(page.includes('const canPrint = ready && !printing') &&
  page.includes('totalLabels <= MAX_LABELS') &&
  !page.includes('!invalidStock && excess.length === 0'),
  'Print must be bounded, but extra labels must not be blocked by inventory quantity')
assert(page.includes('const target = window.open(') &&
  page.indexOf('const target = window.open(') < page.indexOf("await fetch('/api/barcodes/sku/'"),
  'Print popup should open synchronously before network validation')
assert(page.includes('record.physicalUnit !== false') &&
  page.includes('record.barcode !== skuBarcodeForVariantId(item.variant.id)') &&
  page.includes('textOf(record.size) !== textOf(item.variant.sizeLabel)'),
  'Selected barcode identities require a fresh server preflight')
assert(page.includes("await fetch('/api/barcodes/sku/'") &&
  page.includes('record.active') && page.includes('record.barcode !== skuBarcodeForVariantId') &&
  !page.includes('if (item.quantity > physical)'),
  'Print must revalidate current SKU identity without refreshing full inventory or blocking extra copies')
assert(page.includes('MAX_LABELS = MAX_BARCODE_PRINT_LABELS') && page.includes('totalLabels <= MAX_LABELS'),
  'Mass-print action lacks a visible bounded cap')
assert(page.includes('Все копии одного варианта имеют одинаковый код'),
  'Human print instructions should explain SKU copies')
assert(page.includes('window.print()') && page.includes('58mm 35mm') &&
  page.includes('@page{size:A4;margin:0}') &&
  page.includes('Печатать / Сохранить в PDF'),
  'Print preview must provide both thermal and A4 sheet layouts')
assert(navigationCss.includes('grid-template-columns: repeat(3,minmax(0,1fr))') &&
  navigationCss.includes('overflow: visible'),
  'Warehouse tabs must be fully visible on narrow screens, not hidden behind horizontal scrolling')
assert(page.includes('Что будет напечатано') && page.includes('selectedPrint.map(item =>'),
  'Multi-model print selection must be reviewable before sending to the printer')
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
