import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const ui=readFileSync('src/features/inventory/views/WarehouseReportsWorkspace.tsx','utf8')
const css=readFileSync('src/features/inventory/views/warehouse-report-workspace.css','utf8')
const doc=readFileSync('src/features/inventory/views/warehouseReportDocument.ts','utf8')

for(const label of ['Товаров в наличии','Себестоимость · известная часть','Продажная стоимость · известная часть',
  'Свободно','В резерве','Известна себестоимость','Известна цена продажи']){
  assert.ok(ui.includes(label),'Financial overview must show '+label)
}
assert.ok(ui.includes("money(totals.cost)")&&ui.includes("money(totals.revenue)"),
  'Overall cost and retail values must be visible')
assert.ok(ui.includes("money(totals.freeCost)")&&ui.includes("money(totals.reservedCost)"),
  'Cost must split into free and reserved WITHOUT replacing total')
assert.ok(ui.includes("money(totals.freeRevenue)")&&ui.includes("money(totals.reservedRevenue)"),
  'Sale value must split into free and reserved WITHOUT replacing total')
assert.ok(!ui.includes('Разница на сопоставимых позициях'),
  'Do not promote an ambiguous difference to a headline KPI')
assert.ok(!ui.includes('warehouse-capital-quickfacts')&&!ui.includes('warehouse-capital-method'),
  'Remove auxiliary metrics and footnotes that overwhelm operators')
assert.ok(!ui.includes('warehouse-capital-table-scroll')&&!ui.includes('<table'),
  'Many-variant price inspection must not use enormous horizontally scrolling table')
assert.ok(ui.includes('warehouse-capital-color-group')&&
  ui.includes('warehouse-capital-size-pills')&&
  ui.includes('warehouse-capital-color-search')&&
  ui.includes("onClick={()=>setShowAllColors(v=>!v)}"),
  'Allow fast color grouping, size choice, search and seeing all colors')
assert.ok(ui.includes('aria-pressed={selected?.stockId===r.stockId}')&&
  ui.includes('setSelectedId(r.stockId)'),'Every exact stock SKU must be selectable')
assert.ok(ui.includes('warehouse-capital-picked-mobile')&&
  ui.includes('warehouse-capital-picked-desktop'),
  'Price information must be accessible on mobile and wide screens')
assert.ok(ui.includes('item.costPrice===null')&&ui.includes('item.salePrice===null'),
  'Unknown prices cannot be displayed as zero')
assert.ok(css.includes('@media(max-width:850px)')&&
  css.includes('.warehouse-capital-picked-mobile{display:grid'),
  'Mobile must show the picked SKU next to selected color')
assert.ok(!doc.includes("h('О чём важно помнить')"),
  'Remove explicitly rejected Word commentary')
assert.ok(!doc.includes("modelRows.slice(0,35)")&&
  !doc.includes("items.length>12")&&!doc.includes("values.slice(0,limit)"),
  'Word must contain all models, all exact variants and full rankings')
assert.ok(!doc.includes('modelRows.slice(0,35)')&&!doc.includes('modelGroups.slice(0,20)')&&
  !doc.includes('rows.slice(0,180)')&&!doc.includes('values.slice(0,limit)'),
  'Word must not silently truncate ranked or exact rows')
assert.ok(doc.includes('function demandVariantTable(')&&doc.includes('function capitalVariantTable('),
  'Both Word reports must render readable variant cards')
console.log('WAREHOUSE_CAPITAL_UX_AND_FULL_WORD_PASS: overall totals, compact variants, mobile details and zero Word truncation')
