import fs from 'node:fs'
import ts from 'typescript'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const relations = read('worker/domains/orders-relations.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const ordersWrite = read('worker/domains/orders-write.ts')
const projectionSource = read('src/app/orderOperationalProjection.ts')
const app = read('src/App.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const types = read('src/app/types.ts')

check(relations.includes('const hasCommittedItemReturnByOrderId = new Map<number, boolean>()'), 'Order relations do not expose item-linked Return truth')
check(relations.includes('if (returnedQuantity > 0) hasCommittedItemReturnByOrderId.set(orderId, true)'), 'Item-linked Return truth is not derived from active standalone returned quantity')
check(ordersRead.includes('has_committed_item_return: relations.hasCommittedItemReturnByOrderId.get(order.id) || false'), 'Order list does not publish item-linked Return truth')
check(ordersWrite.includes('has_committed_item_return: relations.hasCommittedItemReturnByOrderId.get(id) || false'), 'Order readback does not publish item-linked Return truth')
check(types.includes('has_committed_item_return?: boolean'), 'Frontend order contract lacks item-linked Return truth')

check(projectionSource.includes('hasCommittedPhysicalDownstreamOperation: boolean'), 'Projection lacks physical downstream fact')
check(projectionSource.includes("typeof order.has_committed_item_return === 'boolean'"), 'Projection does not distinguish explicit money-only Return truth')
check(projectionSource.includes('const hasCommittedPhysicalDownstreamOperation = hasCommittedItemReturn || hasCommittedExchange'), 'Physical downstream state does not combine item Returns and Exchanges')
check(projectionSource.includes('canEdit: mutableWorkingOrder && !hasCommittedDownstreamOperation'), 'Money-only Return must still protect structural edit history')
check(projectionSource.includes('canShip: mutableWorkingOrder && !hasCommittedPhysicalDownstreamOperation'), 'Shipping is not decoupled from money-only Return')
check(projectionSource.includes('canCorrectShipping: mutableWorkingOrder && !hasCommittedDownstreamOperation'), 'Historical shipping correction must remain protected by any downstream operation')
check(projectionSource.includes('&& !hasCommittedPhysicalDownstreamOperation'), 'Stock handover is not decoupled from money-only Return')
check(app.includes('projection.hasCommittedPhysicalDownstreamOperation'), 'Shipping action explanation does not follow physical downstream truth')
check(app.includes('товарный возврат или обмен'), 'Shipping blocker message does not distinguish physical Return/Exchange')
check(table.includes("'Есть возврат денег'"), 'Orders table does not distinguish money-only refund history')

// Execute the real projection to protect behavior, not only source shape.
const compiled = ts.transpileModule(projectionSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const projectionModule = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const project = projectionModule.projectOrderOperationalState

const baseOrder = {
  id: 1,
  order_status: 'active',
  shipping_status: 'not_sent',
  workshop_status: 'ready',
  total_amount: 10000,
  received_amount: 10000,
  debt_amount: 0,
  return_amount: 2000,
  committed_return_count: 1,
  committed_exchange_count: 0,
  returns: [{ id: 1, status: 'completed' }],
  stock_handover_review_needed: true,
  items: [{ id: 1, isWorkshop: false, quantity: 1 }],
}
const moneyOnly = project({ ...baseOrder, has_committed_item_return: false }, false)
check(moneyOnly.hasCommittedReturn && !moneyOnly.hasCommittedItemReturn, 'Money-only Return classification is wrong')
check(moneyOnly.canShip, 'Money-only Return dead-ends an otherwise shippable order')
check(moneyOnly.canOpenStockHandover, 'Money-only Return blocks physical handover')
check(!moneyOnly.canEdit, 'Money-only Return unexpectedly allows structural order rewrite')

const itemReturn = project({ ...baseOrder, has_committed_item_return: true }, false)
check(itemReturn.hasCommittedPhysicalDownstreamOperation, 'Item Return is not classified as physical downstream')
check(!itemReturn.canShip, 'Item Return allows the original outbound obligation to ship again')
check(!itemReturn.canOpenStockHandover, 'Item Return allows the original outbound item to be handed over')

const exchange = project({
  ...baseOrder,
  committed_return_count: 0,
  committed_exchange_count: 1,
  return_amount: 0,
  returns: [],
  has_committed_item_return: false,
}, false)
check(exchange.hasCommittedPhysicalDownstreamOperation, 'Exchange is not classified as physical downstream')
check(!exchange.canShip, 'Exchange allows stale original shipping flow')

const legacy = project({ ...baseOrder, has_committed_item_return: undefined }, false)
check(!legacy.canShip, 'Missing new API fact must fail safe instead of silently unblocking legacy payloads')

console.log('STAGE01 MONEY-ONLY RETURN SHIPPING R19B PASSED — financial-only refund keeps physical outbound flow, item Returns/Exchanges remain blocked, and structural history stays protected')
