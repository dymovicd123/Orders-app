import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const operational = read('src/app/controllers/useOperationalViewModel.ts')
const types = read('src/app/types.ts')
const filters = read('src/features/sections/OrderFiltersSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const workshopUi = read('src/features/sections/WorkshopSection.tsx')
const workshopWorker = read('worker/domains/workshop.ts')
const css = read('src/styles/10-workshop-reports-team.css')
const wrangler = read('wrangler.jsonc')

check(wrangler.includes('"name": "orders-app"'), 'MAIN WORKSHOP SYNC: Production Worker identity changed')
check(wrangler.includes('"database_name": "orders_db_prod"') && wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'MAIN WORKSHOP SYNC: Production D1 identity changed')
check(!wrangler.includes('orders_db_branch2') && !wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'MAIN WORKSHOP SYNC: Branch2 D1 identity leaked into main')

check(app.includes("useState<'urgent' | 'period' | 'kaspi'>('period')"), 'MAIN WORKSHOP SYNC: Kaspi invoice mode missing')
check(types.includes('orderPaymentMethod: string') && types.includes('isKaspi: boolean'), 'MAIN WORKSHOP SYNC: Workshop Kaspi types missing')
check(workshopWorker.includes('o.order_payment_method') && workshopWorker.includes('orderPaymentMethod: cleanText(row.order_payment_method)'), 'MAIN WORKSHOP SYNC: Workshop read path missing order_payment_method')
check(operational.includes("normalizeSuggestion(task.orderPaymentMethod) === 'КАСПИ МАГАЗИН'") && operational.includes("normalizeSuggestion(task.orderPaymentMethod) !== 'КАСПИ МАГАЗИН'"), 'MAIN WORKSHOP SYNC: ordinary/Kaspi invoice scopes are not isolated')
check(filters.includes("kaspiMode ? (orderPanel === 'list' ? {} : { display: 'none' })"), 'MAIN WORKSHOP SYNC: Kaspi filters sector isolation missing')
check(table.includes("kaspiMode ? (orderPanel === 'list' ? {} : { display: 'none' })"), 'MAIN WORKSHOP SYNC: Kaspi table sector isolation missing')
check(workshopUi.includes("type WorkshopChannel = 'regular' | 'kaspi'") && workshopUi.includes("type WorkshopPanel = 'orders' | 'invoice'"), 'MAIN WORKSHOP SYNC: Workshop workspace hierarchy missing')
check(workshopUi.includes('Обычные заказы') && workshopUi.includes('Kaspi магазин') && workshopUi.includes('Отдельная приоритетная очередь'), 'MAIN WORKSHOP SYNC: Workshop channel copy missing')
check(!workshopUi.includes('срок до 20:00') && !workshopUi.includes('>ЗАММЛЕР</button>'), 'MAIN WORKSHOP SYNC: obsolete hard-coded/deprecated Workshop copy returned')
check(workshopUi.includes("period: 'all' as WorkshopPeriodPreset") && workshopUi.includes("dateFrom: ''") && workshopUi.includes("dateTo: ''"), 'MAIN WORKSHOP SYNC: returning from Invoice can hide old backlog')
check(css.includes('.workshop-channel-tabs') && css.includes('.workshop-workspace .workshop-simple-invoice-table tr.is-special-order td:first-child::after'), 'MAIN WORKSHOP SYNC: Workshop R1/R1.1 styling missing')

console.log('MAIN WORKSHOP SYNC 20261007 PASSED — Branch2 fixes promoted without Worker/D1 identity crossover')
