import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const relations = read('worker/domains/orders-relations.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const ordersWrite = read('worker/domains/orders-write.ts')
const projection = read('src/app/orderOperationalProjection.ts')
const app = read('src/App.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const types = read('src/app/types.ts')

check(relations.includes('const committedExchangeCountByOrderId = new Map<number, number>()'), 'Order relations do not carry committed Exchange state')
check(relations.includes('exchange_counts AS ('), 'Order relation loader does not batch-count committed exchanges')
check(relations.includes('committedExchangeCountByOrderId.set(orderId'), 'Committed Exchange counts are not attached to orders')
check(!relations.includes('exchangesResult'), 'R19 must not add a seventh Promise.all D1 query')

check(ordersRead.includes('committed_return_count:'), 'Order list does not publish committed Return count')
check(ordersRead.includes('committed_exchange_count:'), 'Order list does not publish committed Exchange count')
check(ordersWrite.includes('committed_return_count:'), 'Single-order readback does not publish committed Return count')
check(ordersWrite.includes('committed_exchange_count:'), 'Single-order readback does not publish committed Exchange count')
check(types.includes('committed_return_count?: number') && types.includes('committed_exchange_count?: number'), 'Frontend order contract lacks committed operation counts')

check(projection.includes('hasCommittedReturn: boolean'), 'Projection lacks committed Return fact')
check(projection.includes('hasCommittedExchange: boolean'), 'Projection lacks committed Exchange fact')
check(projection.includes('hasCommittedDownstreamOperation: boolean'), 'Projection lacks combined downstream-operation fact')
check(!projection.includes('hasActiveReturnOperation'), 'Completed Return is still mislabeled as an active operation')
check(projection.includes('canEdit: mutableWorkingOrder && !hasCommittedDownstreamOperation'), 'Edit guard ignores committed Return/Exchange')
check(projection.includes('canShip: mutableWorkingOrder && !hasCommittedDownstreamOperation'), 'Shipping guard ignores committed Return/Exchange')
check(projection.includes('canCorrectShipping: mutableWorkingOrder && !hasCommittedDownstreamOperation'), 'Shipping correction guard ignores committed Return/Exchange')
check(projection.includes('canOpenStockHandover: mutableWorkingOrder') && projection.includes('&& !hasCommittedDownstreamOperation'), 'Stock handover guard ignores committed Return/Exchange')

// A previous downstream operation is not a terminal whole-order lifecycle state.
// The Return/Exchange domains still decide remaining quantity for another operation.
check(projection.includes('canOpenReturn: mutableWorkingOrder'), 'Committed Return/Exchange incorrectly makes future Return terminal')
check(projection.includes('canOpenExchange: mutableWorkingOrder'), 'Committed Return/Exchange incorrectly makes future Exchange terminal')

check(!app.includes('действующий возврат'), 'UI still tells operators that every completed Return is “active”')
check(app.includes('уже проведён возврат или обмен'), 'Order action message does not explain committed downstream operation')
check(table.includes("'Есть проведённый обмен'"), 'Orders table does not expose Exchange downstream state')
check(table.includes("'Есть проведённый возврат'"), 'Orders table does not expose Return downstream state')

console.log('STAGE01 RETURN/EXCHANGE DOWNSTREAM SEMANTICS R19 PASSED — completed Returns and Exchanges are explicit downstream facts, not fake active-return lifecycle state')
