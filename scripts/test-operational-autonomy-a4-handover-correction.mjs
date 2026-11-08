import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
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

  // Actual browser shipping/stock-handover code, compiled and invoked without a D1 connection.
  // Covers the human possession decision, historical physical checkpoint and idempotent correction.
  const compiled = await build({
    entryPoints: ['src/features/orders/orderShippingHandoverActions.ts'],
    bundle: true, platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
  })
  const { createOrderShippingHandoverActions } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
  )
  const order = { id: 1701, external_id: 'QA-1701', order_status: 'active', shipping_status: 'not_sent', items: [], payments: [] }
  const handoverItem = {
    orderItemId: 42, productName: 'ШАПАН QA', quantity: 2,
    checkpointAt: '2026-10-04T09:00:00Z', checkpointId: 13, checkpointKind: 'revision',
    source: 'warehouse', variantId: 71,
  }
  const globalWindow = globalThis.window
  globalThis.window = { confirm: () => true }
  try {
    let calls = [], completed = [], confirmations = [], invalidations = [], messages = [], errors = []
    let orderMutations = [], shipmentRefreshes = [], actionItemIds = []
    const prepare = (key, payload) => ({
      requestId: 'qa-ship-critical', payload: { ...payload, requestId: 'qa-ship-critical' },
    })
    const args = {
      orders: [order], stockHandoverOrder: order, stockHandoverActionItemId: null, savingOrder: false,
      setStockHandoverOrder: () => {}, setStockHandoverData: () => {},
      setStockHandoverBusy: () => {}, setStockHandoverActionItemId: id => actionItemIds.push(id),
      setError: err => { if (err) errors.push(err) },
      setMessage: message => { if (message) messages.push(message) },
      setSavingOrder: () => {}, setSelectedOrderId: () => {},
      setOrderCatalogResolutionOrder: () => {},
      apiFetch: async () => { throw Error('test must explicitly select an HTTP result') },
      askStockResolution: async prompt => { confirmations.push(prompt); return true },
      getOrderOperationalProjection: async () => ({ canShip: true, canCorrectShipping: true }),
      prepareCriticalRequest: prepare,
      completeCriticalRequest: (key, requestId) => completed.push({ key, requestId }),
      upsertOrderInState: updated => orderMutations.push(updated),
      invalidateInventoryStockCaches: scope => invalidations.push('stock:' + String(scope)),
      invalidateFinanceReadCaches: () => invalidations.push('finance'),
      refreshDashboard: force => shipmentRefreshes.push('orders:' + String(force)),
      refreshWorkshop: () => shipmentRefreshes.push('workshop'),
    }
    const issueItem = {
      source: 'warehouse', variantId: 71, productName: 'ШАПАН QA',
      trackedPhysicalQuantity: 0, operationQuantity: 2,
    }
    const shipment = createOrderShippingHandoverActions({
      ...args,
      apiFetch: async (url, options = {}) => {
        calls.push({ url: String(url), options })
        if (calls.length === 1) {
          return new Response(JSON.stringify({
            code: 'stock_resolution_required', operationType: 'shipping', items: [issueItem],
          }), { status: 409, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({
          ok: true, order: { ...order, shipping_status: 'sent' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    })
    assert.equal(await shipment.markOrderSentToClient(order), true)
    assert.deepEqual(calls.map(x => x.url), ['/api/orders/1701/shipping', '/api/orders/1701/shipping'])
    assert(calls.every(x => x.options.method === 'PATCH'))
    assert.equal(confirmations.length, 1)
    assert.match(confirmations[0].note, /не пересчёт/)
    assert.deepEqual(JSON.parse(calls[0].options.body).stockConfirmations, undefined)
    const approvedShip = JSON.parse(calls[1].options.body)
    assert.deepEqual(approvedShip.stockConfirmations, [{
      source: 'warehouse', variantId: 71, expectedQuantity: 0, operationQuantity: 2,
    }], 'Human approval is scoped to this shipment, not absolute physical inventory editing')
    assert.equal(approvedShip.shippingStatus, 'sent')
    assert.equal(approvedShip.observedPhysicalQuantity, undefined)
    assert.deepEqual(completed, [{ key: 'order-shipping:1701', requestId: 'qa-ship-critical' }])
    assert.deepEqual(invalidations, ['stock:true', 'finance'])
    assert.equal(orderMutations.length, 1)
    assert.deepEqual(shipmentRefreshes, ['workshop'])

    calls = []; completed = []; invalidations = []; confirmations = []; messages = []
    const handover = createOrderShippingHandoverActions({
      ...args, apiFetch: async (url, options = {}) => {
        calls.push({ url: String(url), options })
        if (calls.length === 1) {
          return new Response(JSON.stringify({
            ok: false, code: 'stock_resolution_required', operationType: 'handover', items: [issueItem],
          }), { status: 409, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ ok: true, order, state: { ok: true, items: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    })
    await handover.runOrderStockHandoverAction(handoverItem, 'issue_now')
    assert.equal(calls.length, 2, 'Handover must request a physical confirmation rather than silently retrying')
    assert.deepEqual(calls.map(x => x.url), [
      '/api/orders/1701/stock-handover', '/api/orders/1701/stock-handover',
    ])
    assert.equal(confirmations.length, 1)
    assert.deepEqual(JSON.parse(calls[1].options.body).stockConfirmations, [{
      source: 'warehouse', variantId: 71, expectedQuantity: 0, operationQuantity: 2,
    }])
    assert.equal(JSON.parse(calls[1].options.body).action, 'issue_now')
    assert.equal(JSON.parse(calls[1].options.body).orderItemId, 42)
    assert.equal(JSON.parse(calls[1].options.body).checkpointId, 13)
    assert.equal(invalidations.at(-1), 'stock:true')
    assert(messages.some(m => m.includes('второй раз не спишется')),
      'Confirmed physical issue must not be charged a second time upon final shipment')
    assert.deepEqual(actionItemIds.slice(-2), [42, null])

    calls = []; completed = []; invalidations = []; messages = []
    await createOrderShippingHandoverActions({
      ...args, apiFetch: async (url, options = {}) => {
        calls.push({ url: String(url), options })
        return new Response(JSON.stringify({ ok: true, exchangeCurrentTruth: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    }).correctMistakenOrderShipping(order)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/orders/1701/shipping/correct')
    assert.equal(calls[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      physicalOutcome: 'not_issued', requestId: 'qa-ship-critical',
    }, 'A false-shipment correction may restore only the physically not-issued state')
    assert.deepEqual(completed, [{ key: 'order-handover-correction:1701', requestId: 'qa-ship-critical' }])
    assert.equal(invalidations.at(-1), 'stock:true')
    assert(messages.some(m => m.includes('Обмен сохранён')),
      'Correction must retain the active exchange rather than reversing its items')

    calls = []; completed = []; invalidations = []; errors = []
    await createOrderShippingHandoverActions({
      ...args, apiFetch: async (url, options = {}) => {
        calls.push({ url: String(url), options })
        throw Error('unknown correction transport result')
      },
    }).correctMistakenOrderShipping(order)
    assert.equal(calls.length, 1)
    assert.equal(completed.length, 0, 'Unknown correction outcome cannot retire idempotency key')
    assert.deepEqual(invalidations, [], 'Unknown correction outcome cannot pretend physical stock changed')
    assert.match(errors.at(-1), /unknown correction transport result/)
  } finally {
    if (globalWindow === undefined) delete globalThis.window
    else globalThis.window = globalWindow
  }

  console.log('Operational Autonomy A4 handover correction checks passed.')
} catch (error) {
  console.error(`Operational Autonomy A4 checks failed: ${error?.message || error}`)
  process.exit(1)
}
