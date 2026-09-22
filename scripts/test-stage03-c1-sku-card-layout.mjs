import fs from 'node:fs'

const css = fs.readFileSync('src/styles/w9-warehouse-catalog-cleanup.css', 'utf8')
const groups = fs.readFileSync('src/features/inventory/views/catalogPolishExecutionGroups.tsx', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(groups.includes('<div className="catalog-color-subgroup">'), 'Catalog subgroup structure missing')
check(groups.includes('<section className="catalog-sku-card"'), 'Exact SKU card missing')
check(css.includes('.catalog-color-subgroup > .catalog-sku-card {'), 'SKU card full-row selector missing')
check(css.includes('grid-column: 1 / -1;'), 'SKU card must span both subgroup grid columns')
check(css.includes('width: 100%;') && css.includes('min-width: 0;'), 'SKU card must use the available row width without overflow')
check(css.includes('margin-top: 4px;'), 'SKU card spacing should stay compact after spanning the row')

console.log('STAGE03-C1 SKU CARD LAYOUT PASSED — opened exact-position card spans the full subgroup row instead of collapsing into the label column')
