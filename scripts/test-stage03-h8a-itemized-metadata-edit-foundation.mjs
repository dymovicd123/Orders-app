import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const write = read('worker/domains/orders-write.ts')
const app = read('src/App.tsx')
const manifest = JSON.parse(read('scripts/stage03-h8a-itemized-metadata-edit-worker-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H8A: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H8A: Branch2 D1 binding drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H8A: Production D1 identity leaked into Branch2')

check(manifest?.version === 1 && manifest?.revision === 'stage03-h8a-itemized-metadata-edit-foundation', 'H8A Worker manifest missing')
check(Object.keys(manifest.files || {}).join(',') === 'worker/domains/orders-write.ts', 'H8A Worker allow-list widened')

const start = write.indexOf('export async function updateOrderCritical')
const end = write.indexOf('\n\nexport async function getOrder', start)
check(start >= 0 && end > start, 'H8A: updateOrderCritical boundary missing')
const edit = write.slice(start, end)

check(edit.includes("const itemizedMetadataOnlyEdit = existingPricingMode === 'itemized_v1'"), 'H8A: restricted itemized edit lane missing')
for (const marker of [
  'input.externalId === undefined',
  'input.items === undefined',
  'input.payments === undefined',
  'input.orderTotal === undefined',
  'input.pricingMode === undefined',
  'input.sourceType === undefined',
  'input.workshopStatus === undefined',
  'input.orderStatus === undefined',
  'input.shippingStatus === undefined',
  'input.shippingDate === undefined',
]) check(edit.includes(marker), 'H8A: itemized metadata lane missing hard stop: ' + marker)

check(edit.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete' && !itemizedMetadataOnlyEdit"), 'H8A: unsupported itemized edits no longer fail closed')
check(edit.includes('Разрешены только безопасные исправления реквизитов, проведённых оплат, отдельная коррекция цены продажи и безопасная замена состава'), 'H8A: controlled conflict message missing')
check(edit.includes('const requestedItems = replacementItems') && edit.includes(": (Array.isArray(input.items) ? normalizeOrderItems(input.items, nextSource) : null)"), 'H8A: absent items no longer remain absent outside the dedicated H8D replacement lane')
check(edit.includes('const requestedPayments = Array.isArray(input.payments) ? normalizeOrderPayments(input.payments, nextOrderDate) : null'), 'H8A: absent payments no longer remain absent')
check(edit.includes('const itemContentChanged = Boolean(requestedItems && !sameNormalizedOrderItemsForEdit'), 'H8A: metadata-only lane can unexpectedly rewrite item content')
check(edit.includes('const rewriteItems = Boolean(requestedItems && !sameNormalizedOrderItemsExceptPriceForEdit'), 'H8A: metadata-only lane can unexpectedly trigger stock rewrite')
check(edit.includes('const rewritePayments = !deletingOrder && Boolean(requestedPayments && !sameNormalizedOrderPaymentsForEdit'), 'H8A: metadata-only lane can unexpectedly replace payment ledger')
check(edit.includes('input.orderTotal !== undefined ? input.orderTotal : existingAny.total_amount'), 'H8A: metadata-only lane does not preserve persisted commercial total')
check(!edit.includes('UPDATE order_items SET catalog_price_snapshot') && !edit.includes('catalog_price_snapshot = ?'), 'H8A: restricted edit path unexpectedly rewrites historical Catalog snapshots in place')

check(app.includes("const isItemizedEdit = order.pricing_mode === 'itemized_v1'"), 'H8A: H8B frontend no longer selects the restricted itemized path')
check(app.includes('const payload = isItemizedEdit ? {'), 'H8A: H8B frontend no longer sends the restricted itemized payload')
check(app.includes('itemPriceCorrections'), 'H8A: H8C dedicated price correction field is missing from the restricted payload')
check(!app.includes('Старый редактор пока отключён для таких заказов'), 'H8A: obsolete blanket itemized editor block returned')

console.log('STAGE03-H8A ITEMIZED METADATA EDIT FOUNDATION PASSED — full item/payment/total/source/lifecycle rewrites remain blocked while H8B metadata/payment corrections and the dedicated H8C sold-price correction field stay isolated')
