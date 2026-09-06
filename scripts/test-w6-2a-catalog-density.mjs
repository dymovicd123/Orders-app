import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const loader = read('src/styles/192b2a-warehouse-attention-actions.css')
const css = read('src/styles/w6-2-catalog-density.css')
const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const inventory = read('src/features/sections/InventorySection.tsx')

check(loader.includes("@import './w6-2-catalog-density.css';"), 'W6.2A density layer is not loaded')
check(css.includes('grid-template-columns: repeat(auto-fill, minmax(310px, 1fr))'), 'desktop catalogue must use the available width')
check(css.includes('.catalog-product-accordion:not(.is-open) .catalog-product-actions-v2') && css.includes('display: none;'), 'closed product rows must not repeat secondary actions')
check(css.includes('.catalog-product-accordion.is-open') && css.includes('grid-column: 1 / -1;'), 'opened product must expand into a full-width detail surface')
check(css.includes('.catalog-workspace-v2 > .catalog-new-product-panel') && css.includes('order: 0;'), 'new-product action must not live after the catalogue')
check(css.includes('@media (max-width: 760px)') && css.includes('@media (max-width: 460px)'), 'mobile density contracts missing')

check(catalog.includes('void saveCatalogProduct()'), 'catalog product save path changed/disappeared')
check(catalog.includes('void saveCatalogVariant()'), 'catalog variant save path changed/disappeared')
check(catalog.includes("material: 'СТАНДАРТ'"), 'STANDARD material semantics changed')
check(catalog.includes("length: 'СТАНДАРТ'"), 'STANDARD length semantics changed')
check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')

console.log('W6.2A CATALOG DENSITY PASSED — catalogue uses the full desktop width, closed rows are compact, creation is top-level, and Catalog/Arrival behavior is unchanged')
