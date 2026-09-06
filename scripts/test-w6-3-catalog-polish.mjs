import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const polish = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const css = read('src/styles/w6-3-catalog-polish.css')
const loader = read('src/styles/192b2a-warehouse-attention-actions.css')
const inventory = read('src/features/sections/InventorySection.tsx')

check(loader.includes("@import './w6-3-catalog-polish.css';"), 'W6.3 polish CSS is not loaded')
check(polish.includes('colorGroupsFor') && polish.includes('catalog-color-group') && polish.includes('catalog-size-grid'), 'Execution -> Color -> Size hierarchy missing')
check(polish.includes('catalog-size-tile') && polish.includes('catalog-size-value') && polish.includes('catalog-size-stock'), 'large size-first variant tile missing')
check(polish.includes('data-variant-id={variant.id}') && polish.includes('openVariantEditor(selectedProduct, variant)'), 'exact variant identity/edit path was lost during grouping')
check(!catalog.includes('>Править</button>') && !polish.includes('>Править</button>'), 'repeated per-SKU Править buttons returned')
check(catalog.includes('visibleSelectedVariants') && catalog.includes('selectedProductNameMatchesQuery') && catalog.includes('variantMatchesCategory'), 'detail-side search/category filtering is not honest')
check(catalog.includes('explicitSelectedProductAny') && catalog.includes('selectedProductHiddenByFilter'), 'editor context is not preserved when search/filter hides the selected product')
check(catalog.includes('Найдено ') && catalog.includes("pluralRu(browseProducts.length, 'товар', 'товара', 'товаров')"), 'human Russian result count missing')
check(catalog.includes('Всего:') && catalog.includes('w6-catalog-issue-filter'), 'global totals and clickable issue filter are not visually distinguished')
check(catalog.includes('w6-catalog-toolbar-actions') && catalog.includes('w6-toolbar-new-product'), 'New product action is not discoverable in the working toolbar')
check(catalog.includes('catalog-product-commercial-anchor') && polish.includes('catalog-execution-commercial-anchor') && polish.includes('catalog-variant-commercial-anchor'), 'future pricing anchors are missing at product/execution/variant levels')
check(css.includes('font-size: 1.03rem') && css.includes('min-height: 68px'), 'size tiles are still too small to scan')
check(css.includes('.catalog-size-tile.has-stock') && css.includes('.catalog-size-tile.is-zero'), 'stock/no-stock visual hierarchy missing')
check(css.includes('@media (max-width: 460px)') && css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'), 'mobile size grid contract missing')
check(catalog.includes("material: 'СТАНДАРТ'") && catalog.includes("length: 'СТАНДАРТ'"), 'valid STANDARD semantics changed')
check(catalog.includes('void saveCatalogProduct()') && catalog.includes('void saveCatalogVariant()'), 'Catalog write paths changed')
check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')

console.log('W6.3 CATALOG POLISH PASSED — execution/color/size scanning, honest filtering, editor safety, action hierarchy and future pricing anchors are protected')
