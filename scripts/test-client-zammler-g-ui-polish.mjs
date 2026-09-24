import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const create = read('src/features/sections/CreateOrderSection.tsx')
const header = read('src/features/sections/OrdersHeaderSection.tsx')
const filters = read('src/features/sections/OrderFiltersSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const ordersRead = read('worker/domains/orders-read.ts')

check(!app.includes('zammlerView') && !header.includes('Разделы ЗАММЛЕР'), 'CLIENT-ZAMMLER-G: ZAMMLER must not have a second create/list navigation')
check(app.includes("orderPanel === 'zammler'} label=\"Создание заказа ЗАММЛЕР\""), 'CLIENT-ZAMMLER-G: dedicated ZAMMLER form must remain its own top-level Orders tab')
check(!app.includes('label="Список заказов ЗАММЛЕР"') && !app.includes('label="Фильтры заказов ЗАММЛЕР"'), 'CLIENT-ZAMMLER-G: separate ZAMMLER order-list surface must stay removed')
check(filters.includes('Доставка: ЗАММЛЕР') && filters.includes("current.deliveryType === 'zammler' ? 'all' : 'zammler'"), 'CLIENT-ZAMMLER-G: ZAMMLER must be a clearly named toggle filter in All Orders')
check(app.includes("filters.deliveryType") && app.includes("activeFilters.deliveryType === 'zammler'"), 'CLIENT-ZAMMLER-G: filter state must drive the ordinary Orders read path')
check(table.includes("filters.deliveryType === 'zammler'") && table.includes('Доставка: ЗАММЛЕР'), 'CLIENT-ZAMMLER-G: same table must show its active ZAMMLER delivery filter')
check(!create.includes('Доставка — ЗАММЛЕР, оплата — КАСПИ МАГАЗИН.'), 'CLIENT-ZAMMLER-G: explanatory ZAMMLER hero comment must stay removed')
check(ordersRead.includes("baseWhereParts.push(\"COALESCE(o.delivery_type, '') = ?\")"), 'CLIENT-ZAMMLER-G: exact server-side delivery filter must remain')
check(read('src/app/constants.ts').includes("label: 'Создать заказ ЗАММЛЕР'"), 'CLIENT-ZAMMLER-G: top-level ZAMMLER form tab must be explicit about creating an order')
check(!app.includes('zammler_orders'), 'CLIENT-ZAMMLER-G: no parallel ZAMMLER model is allowed')

console.log('CLIENT-ZAMMLER-G UI CORRECTION PASSED — form is separate; ZAMMLER orders remain in All Orders behind one filter button')
