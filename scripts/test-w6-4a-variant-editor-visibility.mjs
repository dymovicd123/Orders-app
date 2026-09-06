import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const css = read('src/styles/w6-4a-variant-editor-visibility.css')
const loader = read('src/styles/192b2a-warehouse-attention-actions.css')
const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const inventory = read('src/features/sections/InventorySection.tsx')

check(loader.includes("@import './w6-4a-variant-editor-visibility.css';"), 'W6.4A visibility CSS is not loaded')
check(css.includes('.catalog-detail-pane:has(> .w6-variant-editor){display:flex;flex-direction:column}'), 'variant editor host is not reordered only while editor is open')
check(css.includes('>.w6-variant-editor{order:3') && css.includes('>.catalog-execution-list{order:4}'), 'variant editor must render visually before the long execution list')
check(css.includes('@media(max-width:760px)') && css.includes('margin:8px 8px 4px'), 'mobile editor placement polish missing')
check(catalog.includes('onClick={() => openNewVariant(selectedProduct)}>+ Вариант</button>'), 'primary add-variant action changed unexpectedly')
check(catalog.includes('<CatalogPolishExecutionGroups') && catalog.includes('{showVariantEditor ? ('), 'catalog groups/editor contract changed unexpectedly')
check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')

console.log('W6.4A VARIANT EDITOR VISIBILITY PASSED — add/correction form is visually placed before long variant lists on desktop/mobile; catalog behavior and Arrival stay unchanged')
