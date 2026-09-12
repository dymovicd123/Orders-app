import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const dashboardWorker = read('worker/domains/inventory-read.ts')
const workshopWorker = read('worker/domains/workshop.ts')
const dashboardSection = read('src/features/sections/DashboardSection.tsx')
const dashboardCss = read('src/styles/dashboard-workshop-attention-r1.css')
const operationalViewModel = read('src/app/controllers/useOperationalViewModel.ts')

const dashboardStart = dashboardWorker.indexOf('export async function getDashboardInsights')
check(dashboardStart >= 0, 'Dashboard insights declaration missing')
const dashboardBody = dashboardWorker.slice(dashboardStart)
check(!dashboardBody.includes('FROM inventory_stock'), 'Dashboard still reads inventory_stock for removed critical-stock panel')
check(!dashboardBody.includes('FROM order_items oi'), 'Dashboard still scans order_items for removed stock demand panel')
check(dashboardBody.includes('lowStock: []'), 'Dashboard compatibility response must keep lowStock as an empty array')
check(dashboardBody.includes('criticalStockCount: 0'), 'Dashboard compatibility response must zero removed stock counters')

check(dashboardBody.includes('Boolean(row.dueDate)'), 'Dashboard must surface workshop rows that have a deadline before the age threshold')
check(dashboardBody.includes("row.overdueDays > 0\n        ? 0"), 'Overdue workshop deadlines must have highest attention tier')
check(dashboardBody.includes('daysBetweenDates(today, row.dueDate) <= 2'), 'Near workshop deadlines must be promoted ahead of ordinary urgent rows')
check(dashboardBody.includes("? `Просрочено на ${overdueDays} дн. · ждёт ${waitingDays} дн.`"), 'Overdue warning must expose overdue and waiting days')
check(dashboardBody.includes("? `Дедлайн сегодня · ждёт ${waitingDays} дн.`"), 'Today deadline warning must be explicit')

check(!dashboardSection.includes('Критические остатки склада'), 'Removed stock attention column returned to dashboard')
check(!dashboardSection.includes('dashboardLowStock'), 'Dashboard section still depends on removed low-stock payload')
check(dashboardSection.includes('setSelectedWorkshopWarning(item)'), 'Workshop dashboard card must open local details')
check(dashboardSection.includes('selectedWorkshopWarning.customerName'), 'Workshop detail must show customer identity')
check(dashboardSection.includes('selectedWorkshopWarning.customerPhone'), 'Workshop detail must show customer phone')
check(dashboardSection.includes('selectedWorkshopWarning.managerName'), 'Workshop detail must show manager')
check(dashboardSection.includes('selectedWorkshopWarning.dueDate'), 'Workshop detail must show deadline')
check(dashboardSection.includes('openDashboardWorkshopItem(item)'), 'Workshop detail must preserve navigation into workshop')
check(!dashboardSection.includes("apiFetch("), 'Workshop dashboard details must not add an API read on click')
check(dashboardCss.includes('.dashboard-workshop-warning-card.is-danger'), 'Long/overdue workshop rows need an explicit danger style')
check(dashboardCss.includes('overflow-wrap: anywhere'), 'Workshop cards must wrap long identifiers/details instead of overlapping')

check(workshopWorker.includes('SELECT DISTINCT urgent_sibling.order_id'), 'Urgent workshop view must select whole urgent orders')
check(workshopWorker.includes("urgent_sibling.status = 'active' AND urgent_sibling.urgent = 1"), 'Urgent order sibling selection must stay limited to active urgent orders')
const urgentFilterStart = workshopWorker.indexOf("if (view === 'urgent' || urgentOnly)")
check(urgentFilterStart >= 0, 'Urgent workshop filter missing')
const urgentFilter = workshopWorker.slice(urgentFilterStart, workshopWorker.indexOf('\n\n  if (dateFrom)', urgentFilterStart))
check(!urgentFilter.includes("whereParts.push('wt.urgent = 1')"), 'Urgent workshop view regressed to hiding sibling items from the same order')

check(operationalViewModel.includes('const orderPriority = new Map<number, number>()'), 'Order-level workshop invoice priority missing')
check(operationalViewModel.includes('const isSpecialOrder = priority < 2'), 'Urgent/comment order-level invoice grouping missing')
check(operationalViewModel.includes("orderRef: isSpecialOrder ? task.externalOrderId : ''"), 'Special workshop order rows must retain ORD on every row')
check(operationalViewModel.includes("? `order|${task.orderId}|${task.id}`"), 'Special order rows must not be merged across item characteristics')
check(operationalViewModel.includes("const byOrder = a.orderRef.localeCompare(b.orderRef, 'ru')"), 'Special order rows must remain adjacent by ORD')

console.log('Dashboard workshop attention R1 regression: OK')
