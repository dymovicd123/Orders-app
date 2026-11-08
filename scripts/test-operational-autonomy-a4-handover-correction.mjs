import fs from 'node:fs'
const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
try {
  const reservations = read('worker/domains/order-reservations.ts')
  const { correctMistakenOrderHandoverWithCurrentExchange: publicCorrection } = await import('../worker/domains/returns-exchanges.ts')
  const { correctMistakenOrderHandoverWithCurrentExchange: extractedCorrection } = await import('../worker/domains/order-handover-exchange-correction.ts')
  check(publicCorrection === extractedCorrection, 'Legacy Returns/Exchanges entrypoint lost the live exchange handover correction')
  await extractedCorrection({} , 0, {physicalOutcome:'not_issued'}).then(
    () => { throw new Error('Missing order ID must fail before any database mutation') },
    (error) => check(error?.message === 'Заказ не найден.', 'Order ID validation or error contract changed'),
  )

  const orderDelete = read('worker/domains/order-delete.ts')
  const ordersWrite = read('worker/domains/orders-write.ts')
  const worker = read('worker/index.ts')
  const app = read('src/App.tsx')
  const shipping = read('src/features/orders/orderShippingHandoverActions.ts')
  const table = read('src/features/sections/OrdersTableSection.tsx')

  check(reservations.includes('export async function correctMistakenOrderHandover'), 'dedicated handover correction domain action missing')
  check(reservations.includes("physicalOutcome).toLowerCase() !== 'not_issued'"), 'explicit physical-not-issued confirmation missing')
  check(reservations.includes("COALESCE(r.status, 'completed') <> 'cancelled'") && reservations.includes('AS has_item_return'), 'standalone item return conflict guard missing')
  check(reservations.includes('allowCommittedExchangeCurrentTruth'), 'exchange-aware correction escape hatch missing')
  check(reservations.includes("COALESCE(e.status, 'completed') <> 'cancelled') AS has_exchange"), 'active exchange detection missing')
  check(reservations.includes("SET status = 'active', fulfilled_at = NULL"), 'fulfilled reservation reactivation missing')
  check(reservations.includes("stock_writeoff_status = 'reserved'"), 'order item is not returned to reservation state')
  check(reservations.includes('SUM(r.quantity) FROM inventory_reservations r'), 'reserved_quantity rebuild from active reservations missing')
  check(reservations.includes('quantityBefore - quantityAfter'), 'actual physical delta calculation missing')
  check(reservations.includes('newerPhysicalTruth?.found ? 0 : physicalDelta'), 'newer physical truth protection missing')
  check(reservations.includes("shipping_status = 'not_sent', shipping_date = NULL"), 'shipping fact correction missing')
  check(reservations.includes("'order_handover_correction'"), 'handover correction inventory reference missing')

  check(orderDelete.includes('oi.stock_quantity_before, oi.stock_quantity_after'), 'delete false-shipment recovery does not read actual physical delta')
  check(orderDelete.includes('const physicalRestoreQuantity = Math.max(0, Math.min('), 'delete recovery still restores reservation quantity blindly')
  check(orderDelete.includes('falseShipmentFreshnessProtectedQuantity += physicalRestoreQuantity'), 'delete freshness protection still uses wrong quantity')

  check(ordersWrite.includes("existingShippingStatus === 'sent' && nextShippingStatus !== 'sent'"), 'ordinary sent -> not_sent edit guard was weakened')
  check(worker.includes('orderShippingCorrectionMatch'), 'dedicated correction route missing')
  check(worker.includes('correctMistakenOrderHandoverWithCurrentExchange(env.DB, id'), 'correction route is not wired to exchange-aware domain action')
  check(worker.includes("nextShippingStatus !== 'sent'"), 'ordinary shipping route no longer remains send-only')

  check(app.includes('createOrderShippingHandoverActions({') && shipping.includes('async function correctMistakenOrderShipping(order: OrderRecord)'), 'frontend correction handler missing')
  check(shipping.includes("physicalOutcome: 'not_issued' as const"), 'frontend correction does not explicitly confirm physical outcome')
  check(shipping.includes('/shipping/correct'), 'frontend does not use dedicated correction endpoint')
  check(table.includes('Снять «Отправлен»'), 'sent-order correction action not visible in Orders table')
  check(!table.includes('активная обменённая позиция'), 'ordinary Orders UI exposes exchange implementation detail')
  const { projectOrderOperationalState } = await import('../src/app/orderOperationalProjection.ts')
  const operationOrder = {order_status:'active', shipping_status:'sent', items:[],
    has_committed_item_return:true, committed_return_count:1, committed_exchange_count:0}
  check(projectOrderOperationalState(operationOrder).canCorrectShipping === false,
    'Committed item Return must block a false-shipment correction without undoing physical Return')
  check(projectOrderOperationalState({...operationOrder,
    has_committed_item_return:false,committed_return_count:0,committed_exchange_count:1}).canCorrectShipping === true,
    'An active Exchange must still allow correction of a false sent mark on the current replacement')
  check(table.includes('projection.canCorrectShipping &&'),
    'Orders table must use the shared return/exchange-safe correction permission')
  check(projectOrderOperationalState({...operationOrder,
    shipping_status:'not_sent',has_committed_item_return:false,committed_return_count:0}).canCorrectShipping === false,
    'Correction action must not be offered for an order that was not sent')

  console.log('Operational Autonomy A4 handover correction checks passed.')
} catch (error) {
  console.error(`Operational Autonomy A4 checks failed: ${error?.message || error}`)
  process.exit(1)
}
