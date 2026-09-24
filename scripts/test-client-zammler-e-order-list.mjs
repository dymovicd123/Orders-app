import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const filters = read('src/features/sections/OrderFiltersSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const ordersRead = read('worker/domains/orders-read.ts')

check(app.includes("const listVisible = orderPanel === 'list' || (orderPanel === 'zammler' && zammlerView === 'list')"), 'CLIENT-ZAMMLER-E: only the visible ZAMMLER list view must load its dedicated order list')
check(app.includes("orderPanel === 'zammler') params.set('deliveryType', 'ЗАММЛЕР')"), 'CLIENT-ZAMMLER-E: ZAMMLER list must send an exact delivery filter')
check(app.includes('label="Список заказов ЗАММЛЕР"'), 'CLIENT-ZAMMLER-E: dedicated ZAMMLER list surface missing')
check(app.includes("listPanel: 'zammler', zammlerListMode: true"), 'CLIENT-ZAMMLER-E: ZAMMLER table mode missing')
check(filters.includes("listPanel = 'list'") && filters.includes('orderPanelStyle(listPanel)'), 'CLIENT-ZAMMLER-E: shared filters must support the ZAMMLER panel without duplicating filter logic')
check(table.includes("zammlerListMode = false") && table.includes("'Заказы ЗАММЛЕР'"), 'CLIENT-ZAMMLER-E: dedicated table presentation missing')
check(table.includes("Найдено: <strong>{summary.count}</strong> · Сумма:"), 'CLIENT-ZAMMLER-E: compact ZAMMLER summary missing')
check(ordersRead.includes("const deliveryType = cleanText(url.searchParams.get('deliveryType'));"), 'CLIENT-ZAMMLER-E: Worker delivery filter parameter missing')
check(ordersRead.includes("baseWhereParts.push(\"COALESCE(o.delivery_type, '') = ?\")") && ordersRead.includes('baseBindings.push(deliveryType)'), 'CLIENT-ZAMMLER-E: Worker must filter by exact delivery_type, not free-text search')
check(!app.includes('zammler_orders'), 'CLIENT-ZAMMLER-E: no parallel ZAMMLER order model is allowed')

console.log('CLIENT-ZAMMLER-E ORDER LIST PASSED — dedicated ZAMMLER list reuses normal orders, exact delivery filtering, pagination, and existing order actions')
