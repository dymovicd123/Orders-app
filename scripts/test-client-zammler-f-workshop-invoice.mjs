import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const controller = read('src/app/controllers/useOperationalViewModel.ts')
const types = read('src/app/types.ts')
const ui = read('src/features/sections/WorkshopSection.tsx')

check(app.includes("useState<'urgent' | 'period' | 'zammler'>('period')"), 'CLIENT-ZAMMLER-F: invoice mode must include ZAMMLER')
check(app.includes("return workshopInvoiceIsZammler ? 'Накладная ЗАММЛЕР' : 'Накладная цеха'"), 'CLIENT-ZAMMLER-F: exports need a dedicated ZAMMLER title')
check(app.includes("return workshopInvoiceIsZammler ? 'workshop-zammler-invoice' : 'workshop-invoice'"), 'CLIENT-ZAMMLER-F: ZAMMLER export file must be distinct')
check(app.includes('workshopInvoiceTimingLabel(row)'), 'CLIENT-ZAMMLER-F: exports must use deadline labels for ZAMMLER')
check(controller.includes("normalizeSuggestion(task.deliveryType) === 'ЗАММЛЕР'"), 'CLIENT-ZAMMLER-F: ZAMMLER invoice scope must be exact')
check(controller.includes("normalizeSuggestion(task.deliveryType) !== 'ЗАММЛЕР'"), 'CLIENT-ZAMMLER-F: ordinary Workshop invoice must exclude ZAMMLER')
check(controller.includes("`zammler|${task.orderId}|${task.id}`"), 'CLIENT-ZAMMLER-F: ZAMMLER rows must stay per-order/per-task instead of being aggregated away')
check(controller.includes("dueTime: (workshopInvoiceIsZammler || task.urgent)"), 'CLIENT-ZAMMLER-F: ZAMMLER deadline time must reach the invoice row')
check(controller.includes("return dueKey < nowKey ? `Просрочено · ${deadline}`"), 'CLIENT-ZAMMLER-F: overdue ZAMMLER work must be explicit')
check(types.includes('isZammler: boolean') && types.includes('dueTime: string'), 'CLIENT-ZAMMLER-F: invoice row type is missing ZAMMLER deadline fields')
check(ui.includes('>ЗАММЛЕР</button>'), 'CLIENT-ZAMMLER-F: Workshop invoice needs a clear ZAMMLER switch')
check(ui.includes("workshopInvoiceIsZammler ? 'Срок' : 'Срочность'"), 'CLIENT-ZAMMLER-F: ZAMMLER invoice must show a deadline column')
check(ui.includes('ЗАММЛЕР сюда не входит'), 'CLIENT-ZAMMLER-F: ordinary invoice separation must be visible to staff')
check(!controller.includes('zammler_invoice_items') && !app.includes('zammler_invoice_items'), 'CLIENT-ZAMMLER-F: no parallel financial/invoice database model is allowed')

console.log('CLIENT-ZAMMLER-F WORKSHOP INVOICE PASSED — operational ZAMMLER invoice is separate, order-bound, deadline-aware, and excluded from the ordinary Workshop invoice')
