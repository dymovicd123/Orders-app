import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const inventory = read('src/features/sections/InventorySection.tsx')
const loader = read('src/styles/186-inventory-products-admin.css')
const css = read('src/styles/w6-catalog-browse.css')

check(loader.includes("@import './w6-catalog-browse.css';"), 'W6 Catalog visual layer is not loaded')

// W6.1 changes hierarchy without changing catalogue truth or mutation semantics.
check(css.includes('.catalog-workspace-v2 > .catalog-accordion-list') && css.includes('order: 1;'), 'catalogue browse list must be first')
check(css.includes('.catalog-workspace-v2 > .catalog-new-product-panel') && css.includes('order: 2;'), 'new-product master-data form must be visually secondary')
check(css.includes('.catalog-product-accordion-body > .catalog-variant-list-v2') && css.includes('.catalog-product-accordion-body > .catalog-product-edit-strip'), 'expanded product must separate browse content from edit controls')
check(css.includes('grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))'), 'variants must render as adaptive human cards')
check(css.includes('grid-template-areas:') && css.includes('"characteristics size"') && css.includes('"stock action"'), 'variant card hierarchy missing')
check(css.includes('@media (max-width: 760px)') && css.includes('@media (max-width: 460px)'), 'W6 mobile catalogue contracts missing')
check(!css.includes('.catalog-variant-editor-v2 {\n  display: none'), 'variant editor must remain available')
check(!css.includes('.catalog-product-edit-strip {\n  display: none'), 'product editor must remain available')

// Existing safe catalogue controls remain intact in this presentation-only slice.
check(catalog.includes('void saveCatalogProduct()'), 'catalogue product save path changed/disappeared')
check(catalog.includes('void saveCatalogVariant()'), 'catalogue variant save path changed/disappeared')
check(catalog.includes("setInventoryQuery(product.name); openInventoryPanel('overview')"), 'catalogue-to-stock navigation changed/disappeared')
check(catalog.includes("material: 'СТАНДАРТ'"), 'valid STANDARD catalogue semantics must remain accepted')
check(catalog.includes("length: 'СТАНДАРТ'"), 'valid STANDARD length semantics must remain accepted')

// Frozen Arrival remains outside W6.
check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(inventory.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W6.1 CATALOG VISUAL FOUNDATION PASSED — browse hierarchy is primary, master-data editing is secondary, mobile cards are protected, and catalogue/Arrival behavior is unchanged')
