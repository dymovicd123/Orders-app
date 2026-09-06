import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const legacy = read('src/features/inventory/views/renderInventoryCatalogPanelLegacy.tsx')
const css = read('src/styles/w6-2-catalog-master-detail.css')
const loader = read('src/styles/192b2a-warehouse-attention-actions.css')
const inventory = read('src/features/sections/InventorySection.tsx')

check(loader.includes("@import './w6-2-catalog-master-detail.css';"), 'W6.2 master-detail style layer is not loaded')
check(catalog.includes("renderLegacyInventoryCatalogPanel(ctx as any)"), 'non-Catalog review/lifecycle/attributes modes must retain the proven legacy renderer')
check(legacy.includes('Уточнить товары') && legacy.includes('Ожидают движения') && legacy.includes('renderInventoryReferenceManager'), 'legacy exceptional Catalog workflows were not preserved')

check(catalog.includes('catalog-master-detail') && catalog.includes('catalog-master-pane') && catalog.includes('catalog-detail-pane'), 'Catalog must use a two-pane master/detail structure')
check(catalog.includes("return 'Основное исполнение'"), 'STANDARD + STANDARD must be humanized as Основное исполнение')
check(catalog.includes('executionGroups') && catalog.includes('catalog-execution-card') && catalog.includes('catalog-variation-row'), 'Product -> Execution -> Variations hierarchy missing')
check(catalog.includes('variant.gender') && catalog.includes('variant.color') && catalog.includes('variant.material') && catalog.includes('variant.length') && catalog.includes('variant.sizeLabel'), 'Catalog search must include meaningful variant characteristics')
check(catalog.includes('placeholder="Название, цвет, материал, размер…"'), 'human Catalog search affordance missing')
check(catalog.includes('+ Новый товар') && catalog.includes('openNewProduct'), 'new product must be an explicit top-level action')
check(catalog.includes('Редактировать товар') && catalog.includes('+ Вариант') && catalog.includes('Править'), 'editing must be explicit from the selected product sheet')
check(catalog.includes('Нет вариантов') && !catalog.includes("'Взрослые: 0'"), 'compact product list must not repeat zero-heavy technical counters')

check(css.includes('grid-template-columns: minmax(300px, 370px) minmax(0, 1fr)'), 'desktop master/detail width contract missing')
check(css.includes('min-height: 53px'), 'product navigation rows are not compact enough')
check(css.includes('@media (max-width: 760px)') && css.includes('.catalog-master-detail.has-explicit-selection .catalog-master-pane'), 'mobile list/detail navigation contract missing')

check(catalog.includes("material: 'СТАНДАРТ'"), 'valid STANDARD material semantics changed')
check(catalog.includes("length: 'СТАНДАРТ'"), 'valid STANDARD length semantics changed')
check(catalog.includes('void saveCatalogProduct()'), 'Catalog product write path disappeared')
check(catalog.includes('void saveCatalogVariant()'), 'Catalog variant write path disappeared')
check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')

console.log('W6.2 CATALOG MASTER-DETAIL PASSED — compact product navigation, human execution grouping, variant search, explicit editing and frozen safety boundaries are protected')
