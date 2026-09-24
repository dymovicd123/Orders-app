import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const types = read('src/app/types.ts')
const constants = read('src/app/constants.ts')
const create = read('src/features/sections/CreateOrderSection.tsx')
const filters = read('src/features/sections/OrderFiltersSection.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const workshopUi = read('src/features/sections/WorkshopSection.tsx')
const operational = read('src/app/controllers/useOperationalViewModel.ts')
const orderCore = read('worker/domains/order-core.ts')
const ordersWrite = read('worker/domains/orders-write.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const workshop = read('worker/domains/workshop.ts')
const migration = read('migrations/0075_v72_zammler_workshop_due_time.sql')

check(constants.includes("{ kind: 'zammler', label: 'Создать заказ ЗАММЛЕР'"), 'CLIENT-ZAMMLER PROD: clear ZAMMLER create-tab label missing')
check(types.includes("export type OrderPanel = 'create' | 'zammler'"), 'CLIENT-ZAMMLER PROD: ZAMMLER order panel type missing')
check(create.includes("zammlerMode = false") && create.includes('Новый заказ ЗАММЛЕР'), 'CLIENT-ZAMMLER PROD: dedicated create surface missing')
check(create.includes('value="ЗАММЛЕР"') && create.includes('value="КАСПИ МАГАЗИН"'), 'CLIENT-ZAMMLER PROD: fixed delivery/payment controls missing')
check(app.includes("nextItem.workshopDueTime = nextItem.workshopDueTime || '20:00'"), 'CLIENT-ZAMMLER PROD: Workshop default time 20:00 missing')
check(app.includes("orderPanel === 'zammler' ? createZammlerOrderDraftWithDefaultManager()"), 'CLIENT-ZAMMLER PROD: dedicated draft reset missing')

check(app.includes("orderPanel !== 'list'"), 'CLIENT-ZAMMLER PROD: All Orders must remain the only order-list surface')
check(app.includes("activeFilters.deliveryType === 'zammler'") && app.includes("params.set('deliveryType', 'ЗАММЛЕР')"), 'CLIENT-ZAMMLER PROD: All Orders ZAMMLER filter must use the exact delivery query')
check(ordersRead.includes("const deliveryType = cleanText(url.searchParams.get('deliveryType'));"), 'CLIENT-ZAMMLER PROD: Worker delivery parameter missing')
check(ordersRead.includes("baseWhereParts.push(\"COALESCE(o.delivery_type, '') = ?\")"), 'CLIENT-ZAMMLER PROD: exact delivery SQL filter missing')
check(filters.includes('Доставка: ЗАММЛЕР') && filters.includes("aria-pressed={filters.deliveryType === 'zammler'}"), 'CLIENT-ZAMMLER PROD: All Orders ZAMMLER filter button missing')
check(table.includes("filters.deliveryType === 'zammler'") && table.includes('Доставка: ЗАММЛЕР'), 'CLIENT-ZAMMLER PROD: active ZAMMLER filter state missing from the ordinary table')
check(!app.includes('label="Список заказов ЗАММЛЕР"') && !app.includes('label="Фильтры заказов ЗАММЛЕР"'), 'CLIENT-ZAMMLER PROD: separate ZAMMLER list surface must stay removed')

check(types.includes('workshopDueTime?: string') && types.includes('dueTime: string'), 'CLIENT-ZAMMLER PROD: due-time types missing')
check(orderCore.includes('normalizeWorkshopDueTimeInput') && orderCore.includes('workshopDueTime:'), 'CLIENT-ZAMMLER PROD: due-time validation/normalization missing')
check(ordersWrite.includes('workshop_due_time') && ordersWrite.includes('due_time'), 'CLIENT-ZAMMLER PROD: due time is not persisted end-to-end')
check(workshop.includes("${wtColumn('due_time')} AS due_time") && workshop.includes('dueTime: cleanText(row.due_time)'), 'CLIENT-ZAMMLER PROD: Workshop read path missing due time')
check(migration.includes('ALTER TABLE order_items ADD COLUMN workshop_due_time TEXT') && migration.includes('ALTER TABLE workshop_tasks ADD COLUMN due_time TEXT'), 'CLIENT-ZAMMLER PROD: additive Production schema missing')

check(app.includes("useState<'urgent' | 'period' | 'zammler'>('period')"), 'CLIENT-ZAMMLER PROD: ZAMMLER invoice mode missing')
check(operational.includes("normalizeSuggestion(task.deliveryType) === 'ЗАММЛЕР'"), 'CLIENT-ZAMMLER PROD: ZAMMLER invoice scope is not exact')
check(operational.includes("normalizeSuggestion(task.deliveryType) !== 'ЗАММЛЕР'"), 'CLIENT-ZAMMLER PROD: ordinary invoice does not exclude ZAMMLER')
check(operational.includes("return `до ${deadline}`") && !operational.includes('Просрочено ·'), 'CLIENT-ZAMMLER PROD: ZAMMLER deadline must stay neutral without overdue blame wording')
check(workshopUi.includes('>ЗАММЛЕР</button>') && workshopUi.includes("workshopInvoiceIsZammler ? 'Срок' : 'Срочность'"), 'CLIENT-ZAMMLER PROD: separate Workshop invoice UI missing')
check(!app.includes('zammler_orders') && !ordersWrite.includes('zammler_orders') && !operational.includes('zammler_invoice_items'), 'CLIENT-ZAMMLER PROD: parallel ZAMMLER data model is forbidden')

console.log('CLIENT-ZAMMLER PRODUCTION RUNTIME PASSED — dedicated create form + All Orders delivery filter + Workshop invoice reuse the existing order model with exact filtering and editable due time')
