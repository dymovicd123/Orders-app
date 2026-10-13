import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = path => fs.readFileSync(path, 'utf8')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const classic = read('src/features/sections/OrderExchangeSection.tsx')
const smart = read('src/features/sections/OrderExchangeSmartSection.tsx')
const orders = read('worker/domains/orders-write.ts')
const reservations = read('worker/domains/order-reservations.ts')
const lifecycle = read('worker/domains/lifecycle.ts')

const orderUi = workspace.split('  function renderOrderSourceAvailability(')[1]?.split('  const inventoryMatrixProductVariants')[0] || ''
assert.ok(orderUi.includes('Заказ можно сохранить. Физический остаток автоматически не изменится.'), 'Order shortage explanation is missing')
assert.ok(orderUi.includes('зарезервировано') && orderUi.includes('для этого заказа нужно'), 'Order must show physical, reserved and requested separately')
assert.ok(orderUi.includes('existingReservationDeficit'), 'Pre-existing reservation deficit should not be confused with order quantity')
assert.ok(!orderUi.includes('stockObservationEnabled'), 'Order form still offers a hidden physical count')
assert.ok(!orderUi.includes('observedPhysicalQuantity'), 'Order form still accepts a whole-SKU count')
assert.ok(!orderUi.includes('<button'), 'Order shortage must not offer a separate count or acknowledgment workflow')
assert.ok(!workspace.includes('Посчитать сейчас'), 'Outdated inline stocktake button remains')
assert.ok(!workspace.includes('это сразу исправит физический остаток'), 'Order still falsely promises to change physical stock')
assert.ok(!workspace.includes('Склад → Внимание'), 'Order shortage still routes to the obsolete attention view')
assert.ok(!workspace.includes('Для заказа не хватает ${shortageForOrder} шт.'), 'Headline counts pre-existing deficit as missing items for a single order')

for (const [label, code] of [['classic', classic], ['smart', smart]]) {
  assert.ok(code.includes('По учёту недостаточно вещей для выдачи'), label + ' exchange lacks its own shortage wording')
  assert.ok(code.includes('в резерве'), label + ' exchange hides existing reservations')
  assert.ok(code.includes('Подтверждение относится только к выдаче'), label + ' exchange does not explain the scope of possession evidence')
  assert.ok(code.includes('Подтверждаю: для этого обмена физически есть'), label + ' exchange is missing an explicit possession assertion')
  assert.ok(!code.includes('Посчитать сейчас'), label + ' exchange still asks for stocktake')
}
assert.match(classic, /type="checkbox" checked=\{exchangeIssueConfirmed\} style=\{\{[^\n]*\}\}/)
assert.match(smart, /type="checkbox" checked=\{groupConfirmed\} style=\{\{[^\n]*\}\}/)
assert.match(orders, /observedPhysicalQuantity: null, shortageAcknowledged: true/)
assert.match(reservations, /const observedPhysical: null = null;/)
assert.match(lifecycle, /outboundPossessionConfirmed !== true/)

console.log('STOCK SHORTAGE UI PASSED — orders disclose counts without inline recount; exchange confirms only issued things; inventory truth stays separate')
