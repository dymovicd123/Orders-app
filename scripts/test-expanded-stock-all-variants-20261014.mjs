import fs from 'node:fs'
import assert from 'node:assert/strict'

const ui = fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx', 'utf8')
const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const start = section.indexOf('  const simpleStockGroups = useMemo(')
const end = section.indexOf('  const simpleStockStats = useMemo(', start)
assert.ok(start >= 0 && end > start, 'Product-level filtering not found')
const selection = section.slice(start, end)

// Filters select products, but opening the product is a complete variant drilldown.
assert.match(selection, /if \(!matchingRows\.length\) continue/, 'Product matching must still filter the list')
assert.match(selection, /rows: visibleRows,\s*allRows,/, 'Unfiltered variant rows must remain available to expanded view')
assert.match(ui, /buildStockBrowseHierarchy\(productRows,/, 'Expanded card must show zero\/zero variants without needing search')
assert.doesNotMatch(ui, /buildStockBrowseHierarchy\(rows,/, 'Filtered rows must not be used for product drilldown')
assert.match(ui, /hiddenByAvailability && !isOpen/, 'Expanded product must not claim zero stock sizes are hidden')
assert.match(ui, /Показать позиции \(\$\{productRows\.length\}\)/, 'Expand action must communicate full known variant count')
assert.match(ui, /Загружаем все варианты товара из каталога/, 'Catalog metadata loading must be explicit')
assert.match(ui, /simpleStockCatalogError/, 'Catalog errors must be explained, not interpreted as zero stock')

// Initial overview remains low-cost. Only expanding a product requests full
// catalog variants so the historical 8-stock-rows vs 28-catalog-variants
// discrepancy can be represented truthfully.
const openIndex=section.indexOf('function openSimpleStockProduct(')
const openEnd=section.indexOf('  // Switching the physical location',openIndex)
assert.ok(openIndex >= 0 && openEnd > openIndex, 'Lazy catalog expand action missing')
const handler=section.slice(openIndex,openEnd)
assert.match(handler, /loadCatalogData\(\)/, 'Expanding product must load catalog metadata')
assert.match(handler, /if \(!nextKey \|\| catalogData \|\| simpleStockCatalogRequestRef\.current\) return/, 'Do not refetch already loaded catalog')
assert.match(handler, /setSimpleStockCatalogLoading\(true\)/, 'Must show asynchronous catalog loading')
assert.match(section, /setSimpleStockOpenProductKey: openSimpleStockProduct/, 'Stock renderer must use lazy catalog expander')
assert.match(app, /if \(inventoryPanel === 'movement' \|\| inventoryPanel === 'stocktake' \|\| inventoryPanel === 'catalog'\) void loadCatalogData\(\)/,
  'Overview must remain light until explicit expand')

// Semantic demonstration with 8 stocked/known rows and 20 catalog-only rows.
const rows=[{size:'44',physical:0,reserved:1}, {size:'46',physical:0,reserved:0},
  ...Array.from({length:6},(_,i)=>({size:String(48+i*2),physical:0,reserved:0}))]
const matching=rows.filter(row=>row.physical-row.reserved<0)
const visible=rows.filter(row=>row.physical!==0 || row.reserved!==0)
assert.equal(matching.length,1)
assert.equal(visible.length,1)
assert.equal(rows.length,8)
const catalogOnly=Array.from({length:20},(_,i)=>({size:'extra-'+i,physical:0,reserved:0}))
assert.equal([...rows,...catalogOnly].length,28)
assert.deepEqual([...rows,...catalogOnly].filter(r=>r.reserved>0).map(r=>r.size),['44'])

console.log('EXPANDED STOCK ALL VARIANTS PASSED — selected products retain zero sizes and lazy catalog expansion')
