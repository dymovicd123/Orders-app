import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const create = read('src/features/sections/CreateOrderSection.tsx')
const header = read('src/features/sections/OrdersHeaderSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const ordersRead = read('worker/domains/orders-read.ts')

check(app.includes("const [zammlerView, setZammlerView] = useState<'create' | 'list'>('create')"), 'CLIENT-ZAMMLER-G: internal ZAMMLER create/list view state missing')
check(app.includes("const listVisible = orderPanel === 'list' || (orderPanel === 'zammler' && zammlerView === 'list')"), 'CLIENT-ZAMMLER-G: hidden ZAMMLER list must not drive list refreshes')
check(header.includes('aria-label="Разделы ЗАММЛЕР"'), 'CLIENT-ZAMMLER-G: dedicated ZAMMLER sub-navigation missing')
check(header.includes("zammlerView === 'create' ? 'is-active' : ''") && header.includes("zammlerView === 'list' ? 'is-active' : ''"), 'CLIENT-ZAMMLER-G: ZAMMLER sub-tabs do not expose active state')
check(app.includes("orderPanel === 'zammler' && zammlerView === 'create'") && app.includes("orderPanel === 'zammler' && zammlerView === 'list'"), 'CLIENT-ZAMMLER-G: create and list are not rendered as separate ZAMMLER views')
check(app.includes('zammlerView, setZammlerView }} />'), 'CLIENT-ZAMMLER-G: Orders header is not wired to the ZAMMLER sub-navigation')
check(app.includes("setZammlerView('list')"), 'CLIENT-ZAMMLER-G: successful ZAMMLER save should move to its own list')
check(!create.includes('Доставка — ЗАММЛЕР, оплата — КАСПИ МАГАЗИН.'), 'CLIENT-ZAMMLER-G: explanatory ZAMMLER hero comment must stay removed')
check(!table.includes('Здесь показываются только заказы с доставкой ЗАММЛЕР.'), 'CLIENT-ZAMMLER-G: redundant table explanation must stay removed')
check(table.includes('Найдено: <strong>{summary.count}</strong> · Сумма:'), 'CLIENT-ZAMMLER-G: compact ZAMMLER list summary missing')
check(ordersRead.includes("baseWhereParts.push(\"COALESCE(o.delivery_type, '') = ?\")") && ordersRead.includes('baseBindings.push(deliveryType)'), 'CLIENT-ZAMMLER-G: clean UI must keep exact server-side ZAMMLER filtering')
check(!app.includes('zammler_orders'), 'CLIENT-ZAMMLER-G: UI polish must not introduce a parallel ZAMMLER model')

console.log('CLIENT-ZAMMLER-G UI POLISH PASSED — create/list are separate views, redundant copy is removed, exact server filtering remains')
