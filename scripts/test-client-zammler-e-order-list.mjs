import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const filters = read('src/features/sections/OrderFiltersSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const ordersRead = read('worker/domains/orders-read.ts')

check(app.includes("orderPanel !== 'list'"), 'CLIENT-ZAMMLER-E: order table must remain the ordinary All Orders surface')
check(app.includes("activeFilters.deliveryType === 'zammler'") && app.includes("params.set('deliveryType', 'ЗАММЛЕР')"), 'CLIENT-ZAMMLER-E: ZAMMLER filter must use the exact server delivery filter')
check(filters.includes('Только ЗАММЛЕР') && filters.includes("aria-pressed={filters.deliveryType === 'zammler'}"), 'CLIENT-ZAMMLER-E: All Orders needs a visible ZAMMLER filter button')
check(table.includes("filters.deliveryType === 'zammler'") && table.includes('Фильтр ЗАММЛЕР'), 'CLIENT-ZAMMLER-E: filtered state must be visible in the same Orders table')
check(!app.includes('label="Список заказов ЗАММЛЕР"') && !app.includes('label="Фильтры заказов ЗАММЛЕР"'), 'CLIENT-ZAMMLER-E: ZAMMLER orders must not live in a separate list surface')
check(ordersRead.includes("const deliveryType = cleanText(url.searchParams.get('deliveryType'));"), 'CLIENT-ZAMMLER-E: Worker delivery filter parameter missing')
check(ordersRead.includes("baseWhereParts.push(\"COALESCE(o.delivery_type, '') = ?\")") && ordersRead.includes('baseBindings.push(deliveryType)'), 'CLIENT-ZAMMLER-E: Worker must filter by exact delivery_type, not free-text search')
check(!app.includes('zammler_orders'), 'CLIENT-ZAMMLER-E: no parallel ZAMMLER order model is allowed')

console.log('CLIENT-ZAMMLER-E ORDER FILTER PASSED — ZAMMLER stays inside All Orders and is selected by one exact server-backed filter')
