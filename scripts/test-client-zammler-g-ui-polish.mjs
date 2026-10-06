import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const create = read('src/features/sections/CreateOrderSection.tsx')
const header = read('src/features/sections/OrdersHeaderSection.tsx')
const filters = read('src/features/sections/OrderFiltersSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const ordersRead = read('worker/domains/orders-read.ts')
const constants = read('src/app/constants.ts')

check(!app.includes('zammlerView') && !header.includes('Разделы ЗАММЛЕР'), 'CLIENT-ZAMMLER-G: ZAMMLER must not regain a second nested create/list navigation')
check(app.includes("activeSector === 'kaspi' && orderPanel === 'zammler'") && app.includes('label="Создание Kaspi-заказа"'), 'CLIENT-ZAMMLER-G: specialized shared Create form must live in the Kaspi workspace')
check(constants.includes("{ id: 'kaspi', label: 'Kaspi'"), 'CLIENT-ZAMMLER-G: Kaspi workspace missing')
check(!constants.includes("label: 'Создать заказ ЗАММЛЕР'"), 'CLIENT-ZAMMLER-G: old ZAMMLER top-level Orders tab returned')
check(!app.includes('label="Список заказов ЗАММЛЕР"') && !app.includes('label="Фильтры заказов ЗАММЛЕР"'), 'CLIENT-ZAMMLER-G: separate ZAMMLER list surface must stay removed')
check(filters.includes('Доставка: ЗАММЛЕР') && filters.includes("current.deliveryType === 'zammler' ? 'all' : 'zammler'"), 'CLIENT-ZAMMLER-G: ZAMMLER remains an explicit delivery filter for ordinary non-Kaspi orders')
check(app.includes("filters.deliveryType") && app.includes("activeFilters.deliveryType === 'zammler'"), 'CLIENT-ZAMMLER-G: delivery filter must still drive the ordinary Orders read path')
check(table.includes("filters.deliveryType === 'zammler'") && table.includes('Доставка: ЗАММЛЕР'), 'CLIENT-ZAMMLER-G: ordinary table still exposes its active ZAMMLER delivery filter')
check(!create.includes('Доставка — ЗАММЛЕР, оплата — КАСПИ МАГАЗИН.'), 'CLIENT-ZAMMLER-G: obsolete explanatory hero comment returned')
check(create.includes("placeholder={zammlerMode ? 'Рекомендуется ЗАММЛЕР'"), 'CLIENT-ZAMMLER-G: Kaspi create must preserve the ZAMMLER delivery convenience without making delivery identity')
check(ordersRead.includes(`baseWhereParts.push("COALESCE(o.delivery_type, '') = ?")`), 'CLIENT-ZAMMLER-G: exact server-side delivery filter must remain')
check(!app.includes('zammler_orders'), 'CLIENT-ZAMMLER-G: no parallel ZAMMLER model is allowed')

console.log('CLIENT-ZAMMLER-G UI CORRECTION PASSED — ZAMMLER remains a delivery concern/filter, while the specialized shared Create form now lives under Kaspi and no parallel order model is introduced')
