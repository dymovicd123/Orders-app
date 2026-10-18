import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const app = read('src/App.tsx')
const constants = read('src/app/constants.ts')
const hashRouter = read('src/app/utils.ts')
const create = read('src/features/sections/CreateOrderSection.tsx')
const worker = read('worker/index.ts')
const ordersWriter = read('worker/domains/orders-write.ts')
const orderReader = read('worker/domains/orders-read.ts')
const workshop = read('src/features/sections/WorkshopSection.tsx')
const movement = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const review = read('src/features/inventory/views/WriteoffReview.tsx')
const movementWriter = read('worker/domains/inventory-movement.ts')

const absent = (source, fragments, label) => {
  for (const fragment of fragments) assert(!source.includes(fragment), label + ': stale ' + fragment)
}
const present = (source, fragments, label) => {
  for (const fragment of fragments) assert(source.includes(fragment), label + ': missing ' + fragment)
}

absent(constants, ["id: 'kaspi', label: 'Kaspi'"], 'sidebar')
present(constants, ["kind: 'list', label: 'Все заказы'"], 'unified order tab')
present(hashRouter, ["case 'kaspi':\n      return 'orders'"], 'legacy bookmark')
absent(app, ["excludeOrderPaymentMethod", "setActiveSector('kaspi')", "kaspiFilters", "kaspiPaymentPending"], 'single Orders runtime')
present(app, [
  "const activeListFilters = filters",
  "payments: createDraft.payments.map",
  "evaluateItemizedCreatePricing(createDraft.items, createDraft.payments)",
  "setOrderPanel('list')",
], 'standard create and unified list')
present(orderReader, ["o.order_payment_method"], 'persisted Kaspi identity')
absent(ordersWriter, ["if (orderPaymentMethod === 'КАСПИ МАГАЗИН')", "Kaspi is debt-first"], 'standard order writer')
present(ordersWriter, ["buildItemizedOrderWritePlan(itemizedLines, normalizedPayments)"], 'factual payment pricing')
absent(worker, ["reconcileKaspiPaymentAfterShipping", "kaspi-shipping-payment:", "Оплата Kaspi магазин учитывается автоматически"], 'no shipping linked settlement')
present(worker, ["url.pathname === '/api/payments'", "createManualOrderPaymentCritical(env.DB"], 'canonical factual payments')
present(create, ["Способ оплаты заказа", "Можно добавить несколько способов оплаты, включая КАСПИ МАГАЗИН.", "+ Добавить оплату"], 'standard Kaspi payment form')
absent(create, ["После отметки «Отправлено» оставшийся долг закроется автоматически.", "isKaspiOrder"], 'no fabricated payment claims')
present(workshop, ["workshopChannel === 'kaspi'", "isKaspiTask", "Kaspi магазин — отдельная приоритетная очередь."], 'priority workshop Kaspi channel')
present(movement, [
  "const writeoffVisibleRows",
  ".slice(0, 8)",
  "inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'writeoff'",
  "Выбранные позиции списания",
  "+ Добавить ещё товар",
  "Найти нужный цвет, размер или материал",
], 'guided multi-SKU writeoff')
present(review, ["summarizeWriteoff(lines)", "Проверить списание", "Подтвердить списание"], 'writeoff consequences')
present(movementWriter, ["if (items.length > 100)", "const items = movementType === 'manual_set' ? rawItems : mergeInventoryItems(rawItems)"], 'batch and anti-duplicate backend')
console.log('UNIFIED_KASPI_ORDERS_STANDARD_PAYMENTS_WORKSHOP_PRIORITY_MULTI_WRITE_OFF_CHECK_PASSED')
