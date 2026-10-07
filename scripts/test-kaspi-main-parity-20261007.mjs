import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const finance = read('worker/domains/finance-reports.ts')

check(app.includes("useState<OrderPeriodPreset | 'all'>('month')"), 'Kaspi must open on the current month')
check(app.includes("dateFrom: defaultOrderRange.dateFrom") && app.includes("dateTo: defaultOrderRange.dateTo"), 'Kaspi current-month dates are not initialized')
check(app.includes("setKaspiPeriodPreset('month')") && app.includes("dateFrom: defaultOrderRange.dateFrom, dateTo: defaultOrderRange.dateTo"), 'Kaspi reset must return to the current month')

const confirmStart = app.indexOf('async function confirmKaspiPayment(')
const confirmEnd = app.indexOf('\n\n  async function handleOpenDebt', confirmStart)
check(confirmStart >= 0 && confirmEnd > confirmStart, 'Kaspi confirmation flow missing')
const confirm = app.slice(confirmStart, confirmEnd)

check(confirm.includes("setKaspiPaymentDraft({ order, paymentDate: formatLocalDateInput() })"), 'Kaspi payment date must default to Kazakhstan business today')
check(confirm.includes("const paymentDate = String(draft.paymentDate || '').trim()"), 'Kaspi payment submit does not use the chosen date')
check(confirm.includes("if (paymentDate > today)") && confirm.includes("if (order.order_date && paymentDate < order.order_date)"), 'Kaspi payment-date bounds missing')
check(confirm.includes("paymentDate,") && confirm.includes("method: 'КАСПИ МАГАЗИН'") && confirm.includes("paymentKind: 'debt_close'"), 'Kaspi factual date is not persisted through canonical debt close')
check(confirm.includes("'X-Idempotency-Key': critical.requestId"), 'Kaspi payment lost idempotency')
check(!confirm.includes('window.confirm'), 'Kaspi payment still uses browser confirm instead of the factual-date modal')

check(app.includes('aria-label="Подтверждение оплаты Kaspi"'), 'Kaspi payment modal missing')
check(app.includes('<span>Дата поступления</span>') && app.includes('type="date"'), 'Kaspi factual payment date control missing')
check(app.includes('min={kaspiPaymentDraft.order.order_date || undefined}') && app.includes('max={formatLocalDateInput()}'), 'Kaspi payment-date UI bounds missing')
check(app.includes('Именно на эту дату оплата попадёт в финансовый отчёт.'), 'Kaspi payment-date financial meaning is not explained')

check(finance.includes('WHERE p.payment_date BETWEEN ? AND ?'), 'Finance report is not scoped by factual payment date')
check(finance.includes("WHEN p.payment_kind = 'debt_close' THEN 'debt_close'"), 'Finance report does not classify Kaspi confirmation as debt close')
check(finance.includes('SELECT o.order_date AS date') && finance.includes('SELECT p.payment_date AS date'), 'Sales and cash dates are not kept separate')

console.log('BRANCH2 KASPI MAIN PARITY PASSED — current-month default and factual payment-date reporting are preserved')
