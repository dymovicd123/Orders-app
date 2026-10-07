import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const ui = read('src/features/sections/WorkshopSection.tsx')
const css = read('src/styles/10-workshop-reports-team.css')

check(ui.includes("type WorkshopChannel = 'regular' | 'kaspi'"), 'WORKSHOP-UI-R1: channel model missing')
check(ui.includes("type WorkshopPanel = 'orders' | 'invoice'"), 'WORKSHOP-UI-R1: section model missing')
check(ui.includes('Обычные заказы') && ui.includes('Kaspi магазин'), 'WORKSHOP-UI-R1: top-level order split missing')
check(ui.includes('>Заказы</button>') && ui.includes('>Накладная</button>'), 'WORKSHOP-UI-R1: second-level navigation missing')
check(ui.includes("workshopChannel === 'kaspi' ? isKaspiTask(task) : !isKaspiTask(task)"), 'WORKSHOP-UI-R1: ordinary/Kaspi lists are not isolated')
check(ui.includes("workshopPanel === 'orders' ? (") && ui.includes(") : (\n        <>"), 'WORKSHOP-UI-R1: orders and invoice must be mutually exclusive surfaces')
check(ui.includes('Только срочные') && ui.includes('Активные') && ui.includes('Готовые'), 'WORKSHOP-UI-R1: daily order filters missing')
check(ui.includes("placeholder=\"Заказ, товар, клиент или комментарий\""), 'WORKSHOP-UI-R1: human search control missing')
check(ui.includes('Открыть заказ') && !ui.includes('Цех редактируется через заказ'), 'WORKSHOP-UI-R1: technical workflow prose returned')
check(ui.includes("task.dueTime || ''") && ui.includes('Отдельная приоритетная очередь') && !ui.includes('срок до 20:00'), 'WORKSHOP-UI-R1: Kaspi must show factual per-order deadlines without a hard-coded 20:00 promise')
check(ui.includes('workshopChannel === \'kaspi\' ? \'Нет активных позиций Kaspi магазина за выбранный период.\''), 'WORKSHOP-UI-R1: Kaspi invoice empty state missing')

check(css.includes('.workshop-channel-tabs') && css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), 'WORKSHOP-UI-R1: channel layout missing')
check(css.includes('.workshop-section-tabs') && css.includes('.workshop-control-panel'), 'WORKSHOP-UI-R1: workspace hierarchy styling missing')
check(css.includes('.workshop-channel-tab.is-kaspi.is-active'), 'WORKSHOP-UI-R1: Kaspi active workspace styling missing')
check(css.includes('.workshop-workspace .workshop-simple-invoice-table tr.is-special-order td:first-child::after') && css.includes('content: none'), 'WORKSHOP-UI-R1: legacy technical "special order" marker must stay hidden')
check(css.includes('@media (max-width: 720px)') && css.includes('.workshop-export-actions'), 'WORKSHOP-UI-R1: responsive controls missing')

console.log('WORKSHOP UI R1 PASSED — ordinary/Kaspi workspaces, daily queue and invoices are separated without changing Workshop business actions')
