import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const coreTypes = read('worker/core/types.ts')
const orderCore = read('worker/domains/order-core.ts')
const ordersWrite = read('worker/domains/orders-write.ts')
const workshop = read('worker/domains/workshop.ts')
const app = read('src/App.tsx')
const types = read('src/app/types.ts')
const utils = read('src/app/utils.ts')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const editUi = read('src/features/sections/OrderEditorSection.tsx')
const migration = read('migrations/0075_v72_zammler_workshop_due_time.sql')

check(coreTypes.includes('workshopDueTime?: string;'), 'Worker order input due time missing')
check(orderCore.includes('export function normalizeWorkshopDueTimeInput'), 'Due-time normalizer missing')
check(orderCore.includes('/^([01]\\d|2[0-3]):[0-5]\\d$/'), 'Due-time normalizer must accept only HH:MM')
check(orderCore.includes("Время готовности цеха должно быть в формате ЧЧ:ММ."), 'Due-time validation message missing')
check(orderCore.includes("workshopDueTime: Boolean(item?.workshopUrgent) ? normalizeWorkshopDueTimeInput(item?.workshopDueTime) : ''"), 'Non-urgent items must not carry an active due time')
check(orderCore.includes("(left.workshopDueTime || '') === (right.workshopDueTime || '')"), 'Order edit comparison must include due time')

check(ordersWrite.includes('workshop_due_date, workshop_due_time'), 'Order-item due time persistence missing')
const orderItemInsertArities = [...ordersWrite.matchAll(/INSERT INTO order_items \\(([\\s\\S]*?)\\)\\s*VALUES \\(([^\`]*?)\\)\`/g)].map((match) => ({
  columns: match[1].split(',').map((value) => value.trim()).filter(Boolean).length,
  placeholders: (match[2].match(/\\?/g) || []).length,
}))
check(orderItemInsertArities.length === 2, 'Expected both itemized and legacy order_items INSERT statements')
check(orderItemInsertArities.every((entry) => entry.columns === entry.placeholders), 'order_items INSERT column/binding arity mismatch')
check(ordersWrite.includes('due_date, due_time, status'), 'Workshop-task due time persistence missing')
check(ordersWrite.includes("workshop_due_time = NULL"), 'Retired/replaced item must clear due time')
check(ordersWrite.includes("workshopDueTime: (item as any).workshop_due_time || ''"), 'Order read must expose due time')
check(workshop.includes("${wtColumn('due_time')} AS due_time"), 'Workshop read must be schema-safe for due time')
check(workshop.includes('dueTime: cleanText(row.due_time)'), 'Workshop API due time missing')

check(types.includes('workshopDueTime?: string'), 'Frontend item due-time type missing')
check(types.includes('dueTime: string'), 'Workshop task frontend due-time type missing')
check(utils.includes("workshopDueTime: ''"), 'New item draft must initialize due time')
check(utils.includes("workshopDueTime: item.workshopDueTime || ''"), 'Editor draft must preserve due time')
check((app.match(/workshopDueTime: item\.workshopUrgent \? item\.workshopDueTime : ''/g) || []).length === 2, 'Create/edit payloads must carry due time')
check(app.includes('workshopDueTime: item.workshopUrgent ? item.workshopDueTime || null : null'), 'Optimistic created order must retain due time')
check(createUi.includes('type="time"') && createUi.includes("'workshopDueTime'"), 'Create UI editable time missing')
check(editUi.includes('type="time"') && editUi.includes("'workshopDueTime'"), 'Edit UI editable time missing')

check(migration.includes('workshop_due_time TEXT') && migration.includes('due_time TEXT'), '0075 due-time schema missing')
check(!orderCore.includes("workshopDueTime: '20:00'"), 'Generic urgent flow must not hardcode ZAMMLER default time')
check(!createUi.includes('ZAMMLER'), 'Generic Create UI should remain generic in due-time plumbing step')

console.log('STAGE04-ZAMMLER-B DUE-TIME PLUMBING PASSED — existing urgent workshop flow gains one editable HH:MM field end-to-end without introducing a separate deadline engine or ZAMMLER-only semantics')
