import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, reason) => { if (!condition) throw new Error(reason) }
const deletion = read('worker/domains/order-delete.ts')
const critical = read('worker/domains/critical.ts')
const app = read('src/App.tsx')

// Read-only evidence must be taken from the SAME order and SAME fulfilled reservations
// that block deletion. An overall "not_sent" flag does not rule out per-item fulfilment.
check(deletion.includes('oi.product_name_snapshot, oi.color_snapshot, oi.material_snapshot, oi.size_snapshot'), 'missing precise issued SKU snapshot')
check(deletion.includes('WHERE r.order_id = ? AND r.status = \'fulfilled\''), 'issued evidence must be scoped to the order')
check(deletion.includes('confirmationRequired.details = {'), 'read-only blocker details are absent')
check(deletion.includes('issuedItemsTotal: fulfilledReservations.length'), 'missing issued item count')
check(deletion.includes('activeExchangeCount:'), 'active exchange impact missing')
check(deletion.includes('activeReturnCount:'), 'active return impact missing')
check(deletion.indexOf('confirmationRequired.details = {') < deletion.indexOf('const activeExchangeRows ='), 'read-only blocker must precede downstream operations')
check(critical.includes("error.code === 'order_delete_physical_confirmation_required' ? error.details"), 'blocker details are not transmitted narrowly')

// The inline admin dialog replaces the old browser popup. Itemized preview
// must show SKU/source/quantity and only accept explicit confirmation.
const table=read('src/features/sections/OrdersTableSection.tsx')
check(table.includes('stock.name')&&table.includes('stock.quantity')&&table.includes('stock.source'),
  'in-dialog impact must show precise product/location/quantity')
check(table.includes('Товар действительно передавался клиенту?'), 'the human fact question is not displayed inside the deletion dialog')
check(table.includes('Нет, товар не передавался')&&table.includes('Да, товар был передан клиенту'),
  'both real physical outcomes must be clearly worded')
check(table.includes("physicalAnswer==='issued'")&&table.includes('Перейти к редактированию заказа'),
  'a confirmed customer handover must stop deletion and offer editing')
check(table.includes("physicalAnswer!=='not_issued'"),
  'the delete action must remain disabled until no-handover is explicitly confirmed')
check(app.includes('let attempt = await sendDelete(physicalOutcome)'),
  'direct deletion must transmit explicit no-handover selection on first POST')
check(app.includes('confirmAdminDeletePhysicalBeforeChain'),
  'dependent cancellation must safely reconcile a false handover from the same dialog')
check(!app.includes('const notIssued = window.confirm(['), 'legacy browser confirmation must not reappear')

console.log('ORDER DELETE PHYSICAL GUIDANCE PASSED — exact source/SKU evidence, exchange impact, separate shipping status and normal cancellation')
