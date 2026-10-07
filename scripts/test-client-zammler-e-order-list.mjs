import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const filters = read('src/features/sections/OrderFiltersSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const ordersRead = read('worker/domains/orders-read.ts')

check(app.includes("orderPanel !== 'list'"), 'CLIENT-ZAMMLER-E: order table must remain the ordinary Orders surface')
check(app.includes("activeFilters.deliveryType === 'zammler'") && app.includes("params.set('deliveryType', 'ЗАММЛЕР')"), 'CLIENT-ZAMMLER-E: exact delivery filter plumbing disappeared')
const actionsStart = filters.indexOf('<div className="actions orders-filter-actions">')
const actionsEnd = filters.indexOf('</div>', actionsStart)
const actions = filters.slice(actionsStart, actionsEnd)
check(actions.includes('{kaspiMode ? (') && actions.includes('Доставка: ЗАММЛЕР'), 'CLIENT-ZAMMLER-E: ZAMMLER quick filter must be scoped to Kaspi only')
check(!table.includes("filters.deliveryType === 'zammler'"), 'CLIENT-ZAMMLER-E: ordinary Orders table still carries the retired ZAMMLER summary branch')
check(!app.includes('label="Список заказов ЗАММЛЕР"') && !app.includes('label="Фильтры заказов ЗАММЛЕР"'), 'CLIENT-ZAMMLER-E: ZAMMLER delivery must not create a parallel order-list model')
check(ordersRead.includes("const deliveryType = cleanText(url.searchParams.get('deliveryType'));"), 'CLIENT-ZAMMLER-E: Worker delivery filter parameter missing')
check(ordersRead.includes("baseWhereParts.push(\"COALESCE(o.delivery_type, '') = ?\")") && ordersRead.includes('baseBindings.push(deliveryType)'), 'CLIENT-ZAMMLER-E: Worker must keep exact delivery_type filtering for explicit callers')
check(!app.includes('zammler_orders'), 'CLIENT-ZAMMLER-E: no parallel ZAMMLER order model is allowed')

console.log('CLIENT-ZAMMLER-E ORDER FILTER PASSED — ordinary Orders no longer shows the redundant ZAMMLER quick filter; exact delivery filtering remains available where explicitly used')
