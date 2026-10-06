import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0082_v72_kaspi_order_payment_method.sql')
const workerTypes = read('worker/core/types.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const ordersWrite = read('worker/domains/orders-write.ts')
const orderCore = read('worker/domains/order-core.ts')
const appTypes = read('src/app/types.ts')
const utils = read('src/app/utils.ts')
const constants = read('src/app/constants.ts')
const app = read('src/App.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const editorUi = read('src/features/sections/OrderEditorSection.tsx')
const kaspiUi = read('src/features/sections/KaspiOrdersSection.tsx')
const ordersUi = read('src/features/sections/OrdersTableSection.tsx')

// Identity is an order fact, not a zero-value payment hack and not a delivery guess.
check(migration.includes('ALTER TABLE orders ADD COLUMN order_payment_method TEXT'), 'Kaspi order identity is not persisted on the order')
check(!migration.includes("delivery_type = 'ЗАММЛЕР'") && !migration.includes("delivery_type = 'ZAMMLER'"), 'Migration incorrectly infers Kaspi identity from delivery')
check(migration.includes("UPPER(TRIM(COALESCE(p.method, ''))) = 'КАСПИ МАГАЗИН'"), 'Historical recovery does not use factual Kaspi payments')
check(migration.includes('AND NOT EXISTS') && migration.includes("<> 'КАСПИ МАГАЗИН'"), 'Historical recovery can misclassify mixed-payment orders')
check(orderCore.includes('.filter(payment => payment.method && payment.amount > 0)'), 'Zero-value payment placeholders unexpectedly became financial facts')
check(workerTypes.includes('orderPaymentMethod?: string;'), 'Worker input lost order-level payment method')

// Create/edit/read carry the persisted order-level method.
check(ordersWrite.includes('const orderPaymentMethod = upperText(input.orderPaymentMethod)'), 'Create does not normalize order payment method')
check(ordersWrite.includes('delivery_type, order_payment_method, source_type'), 'Create does not persist order payment method')
check(ordersWrite.includes('const nextOrderPaymentMethod = input.orderPaymentMethod !== undefined'), 'Edit does not preserve/change order payment method')
check(ordersWrite.includes('order_payment_method = ?'), 'Edit SQL does not persist order payment method')
check(ordersWrite.includes('o.city, o.delivery_type, o.order_payment_method'), 'Order readback omits order payment method')
check(ordersRead.includes('o.city, o.delivery_type, o.order_payment_method'), 'Order list omits order payment method')

// Server-side list separation is exact by payment method, with debt views for Kaspi work.
check(ordersRead.includes("url.searchParams.get('orderPaymentMethod')"), 'Kaspi include filter missing')
check(ordersRead.includes("url.searchParams.get('excludeOrderPaymentMethod')"), 'Ordinary Orders exclusion filter missing')
check(ordersRead.includes("url.searchParams.get('debtState')"), 'Kaspi awaiting/paid server filter missing')
check(ordersRead.includes("UPPER(TRIM(COALESCE(o.order_payment_method, ''))) = ?"), 'Kaspi list does not use exact order payment method identity')
check(ordersRead.includes("UPPER(TRIM(COALESCE(o.order_payment_method, ''))) <> ?"), 'Ordinary list cannot exclude Kaspi orders safely')

// Both the dedicated form and ordinary Create can classify Kaspi without requiring a delivery choice.
check(constants.includes("{ id: 'kaspi', label: 'Kaspi'"), 'Kaspi sidebar workspace missing')
check(appTypes.includes("| 'kaspi' |"), 'Kaspi app sector missing')
check(utils.includes("case 'kaspi':") && utils.includes("return 'kaspi'"), 'Kaspi hash navigation missing')
check(createUi.includes('Способ оплаты заказа'), 'Ordinary Create does not expose authoritative order payment method')
check(createUi.includes("onChange={(value) => updateCreateDraft('orderPaymentMethod', value)}"), 'Ordinary Create cannot choose order payment method')
check(app.includes("normalizeSuggestion(method) === normalizeSuggestion('КАСПИ МАГАЗИН')"), 'Ordinary form does not recognize Kaspi payment method')
check(app.includes("deliveryType: isKaspi && !String(current.deliveryType || '').trim() ? 'ЗАММЛЕР'"), 'Ordinary form does not recommend ZAMMLER when Kaspi is selected')
check(createUi.includes("placeholder={zammlerMode ? 'Рекомендуется ЗАММЛЕР'"), 'Dedicated Kaspi form lost recommended delivery')
check(!createUi.includes('value="ЗАММЛЕР" readOnly'), 'Kaspi delivery is incorrectly immutable')
check(editorUi.includes('orderPaymentMethod') && editorUi.includes('КАСПИ МАГАЗИН автоматически относит заказ в раздел Kaspi'), 'Editor cannot safely reclassify an order')

// Ordinary daily list stays clean; explicit search may still find a Kaspi order.
check(app.includes("params.set('orderPaymentMethod', 'КАСПИ МАГАЗИН')"), 'Kaspi workspace does not query its own orders')
check(app.includes("params.set('excludeOrderPaymentMethod', 'КАСПИ МАГАЗИН')"), 'Ordinary Orders does not exclude Kaspi by default')
check(app.includes("&& !searchQuery"), 'Ordinary explicit search cannot deliberately cross the Kaspi separation')
check(!ordersUi.includes('Оплата получена'), 'Kaspi payment action leaked into ordinary Orders table')

// Payment confirmation reuses the proven factual payment path and never changes shipping.
const confirmStart = app.indexOf('async function confirmKaspiPayment(')
const confirmEnd = app.indexOf('\n\n  async function handleOpenDebt', confirmStart)
check(confirmStart >= 0 && confirmEnd > confirmStart, 'Kaspi payment confirmation handler missing')
const confirm = app.slice(confirmStart, confirmEnd)
check(confirm.includes("apiFetch('/api/payments'"), 'Kaspi payment does not reuse canonical payment endpoint')
check(confirm.includes("method: 'КАСПИ МАГАЗИН'"), 'Kaspi payment uses the wrong factual method')
check(confirm.includes("paymentKind: 'debt_close'"), 'Kaspi payment does not close the existing order debt')
check(confirm.includes('amount: debt'), 'Kaspi confirmation does not use the exact current debt')
check(confirm.includes("'X-Idempotency-Key': critical.requestId"), 'Kaspi payment confirmation is not retry-safe from the browser')
check(!confirm.includes('shippingStatus') && !confirm.includes('markOrderSentToClient'), 'Kaspi payment confirmation incorrectly mutates shipping')
check(kaspiUi.includes('Ожидают оплату') && kaspiUi.includes('Оплачены') && kaspiUi.includes('Все Kaspi'), 'Kaspi work queue states are incomplete')
check(kaspiUi.includes('Оплата получена'), 'Kaspi workspace lacks the payment confirmation action')
check(kaspiUi.includes('shippingStatusLabel(order)'), 'Kaspi workspace does not show shipping as an independent fact')

console.log('KASPI ORDER SEPARATION R1 PASSED — order payment method is authoritative, ZAMMLLER is only a default, actual money stays factual/idempotent, and Kaspi work is separated from ordinary Orders without coupling payment to shipping')
