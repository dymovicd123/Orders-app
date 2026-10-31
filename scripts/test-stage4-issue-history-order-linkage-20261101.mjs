import assert from 'node:assert/strict'
import fs from 'node:fs'

const read=path=>fs.readFileSync(path,'utf8')
const section=read('src/features/sections/InventorySection.tsx')
const panel=read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
const timeline=read('src/features/inventory/views/StockVariantTimeline.tsx')
const problems=read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const css=read('src/styles/w18-history-investigation.css')
// Exact-SKU + source reservation readback is independent of historic movements.
assert(section.includes('loadInventoryReservations(source, variantId, 0)'))
assert(section.includes("Number(order.variantId) === variantId && order.source === source && order.status === 'active'"))
assert(section.includes('requestId !== historyRequestRef.current'), 'Prevent stale request overwrites')
assert(section.includes("setHistoryActiveOrders([])") && section.includes('setHistoryActiveOrdersError('))
assert(panel.includes('reservations={historyActiveOrders}'))
assert(panel.includes('openReserveOrder={openHistoryReserveOrder}'))
assert(section.includes('openHistoryReserveOrder: (order: InventoryReservation) => void openOrderFromFinance('))
assert(timeline.includes('Number(order.variantId) === variant.variantId'))
assert(timeline.includes("order.source === variant.source"))
assert(timeline.includes("order.status === 'active'"))
assert(timeline.includes('order.externalOrderId || order.orderId'))
assert(timeline.includes('onClick={() => openReserveOrder(order)}'))
assert(timeline.includes('Это обязательства по заказам, а не результат физического пересчёта.'))
assert(timeline.includes('reservationsError ? <p role="alert">'), 'Reservation load error must be visible, not false zero count')
assert(timeline.includes('Более поздняя загруженная сверка совпала с учётом.'),
  'Historical difference must not be falsely labelled active')
assert(timeline.includes("derivedBefore >= 0 ? quantity(derivedBefore) : 'не установлен по этой записи'"),
  'Historical inconsistent before quantity cannot be displayed as verified negative physical')
assert(timeline.includes('не доказательство ошибки сотрудника'))
assert(problems.includes('technicalIdentityQuestions') && problems.includes('confirmedHumanQuestions'))
assert(problems.includes('они не считаются ошибками сотрудников'))
assert(css.includes('.w18-reservation-orders') && css.includes('@media(max-width:540px)'))
console.log('STAGE4_ISSUE_HISTORY_ORDER_CORRELATION_PASS: exact SKU+source and live order reserve, stale guard, reliable historical evidence, separate staff vs technical queue')
