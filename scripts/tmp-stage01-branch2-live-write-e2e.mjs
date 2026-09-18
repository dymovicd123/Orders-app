const base = String(process.env.BRANCH2_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('BRANCH2_BASE_URL missing')
const runId = String(process.env.GITHUB_RUN_ID || Date.now())
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date())
const check = (condition, message) => { if (!condition) throw new Error(message) }

async function api(path, options = {}, expected = [200]) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${text.slice(0, 1200)}`)
  }
  if (data && typeof data === 'object' && 'ok' in data) check(data.ok === true, `${path} returned ok=false: ${text.slice(0, 1200)}`)
  return { status: response.status, data }
}

function requestId(label) {
  return `stage01-live-${label}-${runId}`
}

const refs = (await api('/api/reference-data')).data
check(Array.isArray(refs.managerOptions) && refs.managerOptions.length > 0, 'No active manager available for Branch2 E2E')
check(Array.isArray(refs.paymentMethods) && refs.paymentMethods.length > 0, 'No payment method available for Branch2 E2E')
const manager = refs.managerOptions.find((row) => Number(row?.id) > 0)
const paymentMethod = String(refs.paymentMethods.find(Boolean) || '').trim()
check(manager?.id && manager?.name, 'No valid active manager for Branch2 E2E')
check(paymentMethod, 'No valid payment method for Branch2 E2E')

const catalog = (await api('/api/catalog')).data
const variant = (catalog.variants || []).find((row) => Number(row?.id) > 0 && row?.isActive && String(row?.productName || '').trim())
const product = variant
  ? (catalog.products || []).find((row) => Number(row?.id) === Number(variant.productId) && row?.isActive)
  : null
check(variant && product, 'No active canonical catalog variant available for Branch2 Workshop E2E')

const externalId = `QA-S01-${runId.slice(-10)}`
const item = {
  productName: String(product.name || variant.productName || ''),
  audienceType: String(variant.productCategory || product.category || '').toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
  gender: String(variant.gender || ''),
  color: String(variant.color || ''),
  material: String(variant.material || 'СТАНДАРТ'),
  length: String(variant.length || 'СТАНДАРТ'),
  size: String(variant.sizeLabel || ''),
  quantity: 1,
  unitPrice: 0,
  sourceType: 'workshop',
  workshopComment: 'Stage01 live E2E Workshop item',
  workshopUrgent: false,
  workshopDueDate: '',
  shortageAcknowledged: false,
}
check(item.productName, 'Canonical product name is empty for selected Workshop catalog row')

const createPayload = {
  externalId,
  orderDate: today,
  managerId: Number(manager.id),
  managerName: String(manager.name),
  customerPhone: '77000000000',
  customerName: 'QA STAGE01 E2E',
  city: 'QA',
  deliveryType: '',
  sourceType: 'warehouse',
  orderTotal: 10000,
  workshopStatus: 'in_workshop',
  orderStatus: 'active',
  comment: `Stage01 live E2E ${runId}`,
  items: [item],
  payments: [{
    paymentDate: today,
    method: paymentMethod,
    amount: 10000,
    paymentKind: 'primary',
    comment: 'Stage01 live E2E',
  }],
}
const created = await api('/api/orders', {
  method: 'POST',
  headers: { 'X-Idempotency-Key': requestId('create') },
  body: JSON.stringify(createPayload),
}, [201])
const orderId = Number(created.data?.orderId)
check(orderId > 0, 'Create order response did not contain orderId')
console.log(`created order #${orderId} ${externalId}`)

let order = (await api(`/api/orders/${orderId}`)).data?.order
check(order?.id === orderId, 'Created order cannot be read back')
check(Array.isArray(order.items) && order.items.length === 1, 'Created order item readback is wrong')
check(Boolean(order.items[0]?.isWorkshop) || String(order.items[0]?.sourceType || '').toLowerCase() === 'workshop', 'Created E2E order did not enter Workshop flow')
const originalItemId = Number(order.items[0]?.id)
check(originalItemId > 0, 'Created order item id missing')
check(Number(order.committed_return_count || 0) === 0 && Number(order.committed_exchange_count || 0) === 0, 'Fresh order already has downstream operations')

const search = (await api(`/api/orders?limit=50&q=${encodeURIComponent(item.productName)}`)).data
check((search.orders || []).some((row) => Number(row?.id) === orderId), 'R14 canonical product search cannot find the live E2E order')

const exchanged = await api('/api/exchanges', {
  method: 'POST',
  headers: { 'X-Idempotency-Key': requestId('exchange') },
  body: JSON.stringify({
    orderId,
    exchangeDate: today,
    oldItemId: originalItemId,
    oldQuantity: 1,
    oldReturnSource: 'none',
    oldPhysicalState: 'pending',
    newSourceWasManuallyChanged: true,
    newItem: {
      ...item,
      sourceType: 'workshop',
      workshopComment: 'Stage01 live E2E replacement',
      workshopUrgent: false,
      workshopDueDate: '',
    },
    financialAction: 'none',
    financialAmount: 0,
    paymentMethod: '',
    comment: 'Stage01 live E2E exchange without refund',
  }),
}, [201])
const exchangeId = Number(exchanged.data?.exchangeId)
check(exchangeId > 0, 'Exchange response did not contain exchangeId')

order = (await api(`/api/orders/${orderId}`)).data?.order
check(Number(order.committed_exchange_count || 0) === 1, 'Committed Exchange is missing from order readback')
check((order.items || []).some((row) => Boolean(row?.isWorkshop) || String(row?.sourceType || '').toLowerCase() === 'workshop'), 'Exchange replacement did not enter Workshop flow')

await api(`/api/exchanges/${exchangeId}/cancel`, {
  method: 'PATCH',
  headers: { 'X-Idempotency-Key': requestId('exchange-cancel') },
  body: JSON.stringify({ comment: 'Stage01 live E2E cancel exchange' }),
})
order = (await api(`/api/orders/${orderId}`)).data?.order
check(Number(order.committed_exchange_count || 0) === 0, 'Cancelled Exchange still blocks order readback')
const restoredItem = (order.items || []).find((row) => Number(row?.id) === originalItemId)
check(restoredItem && Number(restoredItem.quantity) >= 1, 'Cancelling Exchange did not restore the original order item')

const returned = await api('/api/returns', {
  method: 'POST',
  headers: { 'X-Idempotency-Key': requestId('money-return') },
  body: JSON.stringify({
    orderId,
    returnDate: today,
    amount: 1000,
    paymentMethod,
    comment: 'Stage01 live E2E money-only refund',
    restockSource: 'none',
    items: [],
  }),
}, [201])
const returnId = Number(returned.data?.returnId)
check(returnId > 0, 'Money-only Return response did not contain returnId')

order = (await api(`/api/orders/${orderId}`)).data?.order
check(Number(order.committed_return_count || 0) === 1, 'Money-only Return is missing from committed history')
check(order.has_committed_item_return === false, 'Money-only Return was misclassified as an item Return')
check(Number(order.committed_exchange_count || 0) === 0, 'Cancelled Exchange leaked into downstream count')

const workshop = (await api(`/api/workshop?limit=500&q=${encodeURIComponent(externalId)}`)).data
const activeTask = (workshop.tasks || []).find((task) => Number(task?.orderId) === orderId)
check(activeTask?.id, 'Restored Workshop task is missing before shipping')
await api(`/api/workshop/${Number(activeTask.id)}`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'ready' }),
})
order = (await api(`/api/orders/${orderId}`)).data?.order
check(String(order.workshop_status || '').toLowerCase() !== 'in_workshop', 'Workshop readiness did not clear after restored task was marked ready')

await api(`/api/orders/${orderId}/shipping`, {
  method: 'PATCH',
  body: JSON.stringify({ shippingStatus: 'sent', shippingDate: today, observations: [] }),
})
order = (await api(`/api/orders/${orderId}`)).data?.order
check(String(order.shipping_status || '').toLowerCase() === 'sent', 'Money-only Return dead-ended live shipping')

await api(`/api/returns/${returnId}/cancel`, {
  method: 'PATCH',
  headers: { 'X-Idempotency-Key': requestId('money-return-cancel') },
  body: JSON.stringify({ comment: 'Stage01 live E2E cleanup refund' }),
})
order = (await api(`/api/orders/${orderId}`)).data?.order
check(Number(order.committed_return_count || 0) === 0, 'Cancelled money-only Return still blocks order history')
check(order.has_committed_item_return === false, 'Cancelled money-only Return left physical downstream state')

console.log(JSON.stringify({
  ok: true,
  orderId,
  externalId,
  sourceType: 'workshop',
  variantId: Number(variant.id),
  exchangeId,
  returnId,
  shippingStatus: order.shipping_status,
}))
console.log('STAGE01 BRANCH2 LIVE WRITE E2E PASSED — Workshop create/search, Exchange+cancel, money-only refund, Workshop readiness, shipping and refund cancellation are mutually consistent')
