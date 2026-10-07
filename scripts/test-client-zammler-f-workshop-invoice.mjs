import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const controller = read('src/app/controllers/useOperationalViewModel.ts')
const types = read('src/app/types.ts')
const ui = read('src/features/sections/WorkshopSection.tsx')
const worker = read('worker/domains/workshop.ts')

check(app.includes("useState<'urgent' | 'period' | 'kaspi'>('period')"), 'KASPI-WORKSHOP-R1: invoice mode must include Kaspi')
check(app.includes("return workshopInvoiceIsKaspi ? 'Накладная КАСПИ МАГАЗИН' : 'Накладная цеха'"), 'KASPI-WORKSHOP-R1: exports need a dedicated Kaspi title')
check(app.includes("return workshopInvoiceIsKaspi ? 'workshop-kaspi-invoice' : 'workshop-invoice'"), 'KASPI-WORKSHOP-R1: Kaspi export file must be distinct')
check(app.includes('workshopInvoiceTimingLabel(row)'), 'KASPI-WORKSHOP-R1: exports must preserve deadline labels')
check(app.includes("nextItem.workshopDueTime = nextItem.workshopDueTime || '20:00'"), 'KASPI-WORKSHOP-R1: Kaspi Workshop create must retain the 20:00 default')

check(worker.includes('o.order_payment_method'), 'KASPI-WORKSHOP-R1: Workshop read must fetch canonical order payment identity')
check(worker.includes('orderPaymentMethod: cleanText(row.order_payment_method)'), 'KASPI-WORKSHOP-R1: Workshop API must expose orderPaymentMethod')
check(types.includes('orderPaymentMethod: string'), 'KASPI-WORKSHOP-R1: Workshop task type must expose orderPaymentMethod')

check(controller.includes("normalizeSuggestion(task.orderPaymentMethod) === 'КАСПИ МАГАЗИН'"), 'KASPI-WORKSHOP-R1: Kaspi invoice must use canonical order_payment_method')
check(controller.includes("normalizeSuggestion(task.orderPaymentMethod) !== 'КАСПИ МАГАЗИН'"), 'KASPI-WORKSHOP-R1: ordinary Workshop invoice must exclude Kaspi orders')
check(!controller.includes("normalizeSuggestion(task.deliveryType) === 'ЗАММЛЕР'"), 'KASPI-WORKSHOP-R1: delivery must not define the Kaspi invoice anymore')
check(controller.includes("`kaspi|${task.orderId}|${task.id}`"), 'KASPI-WORKSHOP-R1: Kaspi rows must stay per-order/per-task')
check(controller.includes('isKaspi: workshopInvoiceIsKaspi'), 'KASPI-WORKSHOP-R1: invoice row must carry Kaspi semantics')
check(controller.includes("dueTime: (workshopInvoiceIsKaspi || task.urgent)"), 'KASPI-WORKSHOP-R1: Kaspi deadline time must reach the invoice row')
check(controller.includes("return `до ${deadline}`") && !controller.includes('Просрочено ·'), 'KASPI-WORKSHOP-R1: deadline wording must remain neutral')

check(types.includes('isKaspi: boolean') && types.includes('dueTime: string'), 'KASPI-WORKSHOP-R1: invoice row type is missing Kaspi/deadline fields')
check(ui.includes("type WorkshopChannel = 'regular' | 'kaspi'"), 'KASPI-WORKSHOP-R1: Workshop must expose separate ordinary/Kaspi workspaces')
check(ui.includes('>Kaspi магазин</span>') && ui.includes('>Обычные заказы</span>'), 'KASPI-WORKSHOP-R1: Workshop top-level channel switch is missing')
check(!ui.includes('>ЗАММЛЕР</button>'), 'KASPI-WORKSHOP-R1: old ZAMMLER invoice switch must be retired')
check(ui.includes("String(task.orderPaymentMethod || '').trim().toUpperCase() === 'КАСПИ МАГАЗИН'"), 'KASPI-WORKSHOP-R1: Workshop order queues must use canonical Kaspi identity')
check(ui.includes('workshopChannel === \'kaspi\' ? <span className="status-pill status-info">КАСПИ МАГАЗИН</span> : null'), 'KASPI-WORKSHOP-R1: Kaspi rows must stay visibly marked')
check(ui.includes("workshopInvoiceIsKaspi ? 'Срок' : 'Срочность'"), 'KASPI-WORKSHOP-R1: Kaspi invoice must keep the deadline column')
check(ui.includes("setWorkshopInvoiceMode(workshopChannel === 'kaspi' ? 'kaspi' : 'period')"), 'KASPI-WORKSHOP-R1: Kaspi and ordinary invoices must remain separate')
check(!controller.includes('kaspi_invoice_items') && !app.includes('kaspi_invoice_items'), 'KASPI-WORKSHOP-R1: no parallel Kaspi invoice database model is allowed')

console.log('KASPI WORKSHOP INVOICE R1 PASSED — former ZAMMLER invoice is now canonical Kaspi-shop scope, separate and deadline-aware')
