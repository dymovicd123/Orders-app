import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, start, end) => {
  const from = source.indexOf(start)
  check(from >= 0, 'Missing marker: ' + start)
  const to = source.indexOf(end, from + start.length)
  check(to > from, 'Missing end marker after: ' + start)
  return source.slice(from, to)
}

const app = read('src/App.tsx')
const projection = read('src/app/orderOperationalProjection.ts')

check(app.includes("import { projectOrderOperationalState } from './app/orderOperationalProjection'"), 'App must use the shared order projection at action entry points')

const debt = between(app, 'function handleOpenDebt(', 'function handleOpenReturn(')
check(debt.includes('projectOrderOperationalState(order, { isAdmin })'), 'Debt entry does not use shared order truth')
check(debt.includes('!projection.canOpenDebt'), 'Debt entry bypasses projection eligibility')

const ret = between(app, 'function handleOpenReturn(', 'function handleOpenExchange(')
check(ret.includes('!projection.canOpenReturn'), 'Return entry bypasses projection eligibility')

const exchange = between(app, 'function handleOpenExchange(', 'function closeOrderEditor(')
check(exchange.includes('!projection.canOpenExchange'), 'Exchange entry bypasses projection eligibility')

const edit = between(app, 'function handleEditOrder(', 'function upsertOrderInState(')
check(edit.includes('!projection.canEdit'), 'Edit open bypasses projection eligibility')
check(edit.includes('projection.hasActiveReturnOperation'), 'Edit open does not explain active Return protection')

const persist = between(app, 'async function persistOrder(', 'async function archiveOrderAsAdmin')
check(persist.includes('!projection.canEdit'), 'Edit save bypasses projection eligibility')
check(!persist.includes("!isAdmin && (['deleted', 'archived'].includes(order.order_status) || order.shipping_status === 'sent')"), 'Edit save still duplicates raw lifecycle truth')

const workshopEdit = between(app, 'async function openWorkshopOrderEditor(', 'async function openWorkshopExchange(')
check(workshopEdit.includes('!projection.canEdit'), 'Workshop edit entry bypasses the same edit truth')

const ship = between(app, 'async function markOrderSentToClient(', 'async function correctMistakenOrderShipping(')
check(ship.includes('!projection.canShip'), 'Shipping entry bypasses projection eligibility')
check(ship.includes('projection.workshopPending') && ship.includes('projection.hasActiveReturnOperation'), 'Shipping entry lost human explanations for projection blockers')

const correction = between(app, 'async function correctMistakenOrderShipping(', 'async function deleteOrderAsAdmin(')
check(correction.includes('!projection.canCorrectShipping'), 'Shipping correction entry bypasses projection eligibility')

for (const marker of ['canOpenDebt', 'canOpenReturn', 'canOpenExchange', 'canEdit', 'canShip', 'canCorrectShipping']) {
  check(projection.includes(marker + ':'), 'Shared projection lost action contract: ' + marker)
}

console.log('STAGE01 ORDER ACTION ENTRY R3 PASSED — order actions and their controller entry points consume the same operational truth')
