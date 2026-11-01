import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectOrderOperationalState } from '../src/app/orderOperationalProjection.ts'

const base = {
  id: 91, external_id: 'ORD-TEST-PARTIAL',
  order_status: 'active', shipping_status: 'not_sent',
  committed_return_count: 1, has_committed_item_return: true,
  committed_exchange_count: 1,
  return_amount: 1000, received_amount: 3000, debt_amount: 0,
  stock_handover_has_active_items: true,
  workshop_status: 'in_workshop',
  items: [
    { id: 101, quantity: 1, isWorkshop: false, sourceType: 'warehouse', stockWriteoffStatus: 'fulfilled' },
    { id: 102, quantity: 1, isWorkshop: false, sourceType: 'warehouse', stockWriteoffStatus: 'reserved' },
    { id: 103, quantity: 1, isWorkshop: true, sourceType: 'workshop', workshopTaskStatus: 'active' },
  ],
}
const open = projectOrderOperationalState(base, { isAdmin: false })
assert.equal(open.canOpenReturn, true, 'An earlier Return cannot make the order read-only')
assert.equal(open.canOpenExchange, true, 'An earlier Exchange cannot block a new legitimate operation')
assert.equal(open.canOpenStockHandover, true, 'A separate ready warehouse item remains issuable while workshop pending')
assert.equal(open.canShip, false, 'Do not mark the whole order shipped while workshop is pending')
assert.equal(open.canEdit, false, 'Do not use the wholesale item editor to overwrite completed physical events')
const sent = projectOrderOperationalState({ ...base, shipping_status: 'sent' })
assert.equal(sent.canCorrectShipping, true, 'A Return on a different item cannot hide the shipment correction action')

const header = readFileSync('src/features/sections/OrdersHeaderSection.tsx', 'utf8')
const table = readFileSync('src/features/sections/OrdersTableSection.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
assert.doesNotMatch(header, /orders-stock-attention|Открыть случаи и действия|Складские случаи для проверки/,
  'Inventory issue diagnostics must not dominate the everyday Orders screen')
assert.doesNotMatch(table, /row-returned|Есть проведённые возврат и обмен/,
  'A Return should not make an otherwise active order look like a problem')
assert.match(table, /Изменить заказ/, 'All active orders need an ordinary edit entry point')
assert.match(table, /openMetadataCorrection\(linkedAdminEditOrder\)/,
  'Manager must have a safe metadata edit path after a Return or Exchange')
assert.match(table, /isAdmin && Array\.isArray\(linkedAdminEditOrder\.payments\)/,
  'Restricted recorded-payment method correction must not leak to managers')
assert.doesNotMatch(app, /activeSector === 'orders'\) void loadWarehouseAttention\(\)/,
  'Do not load a hidden warehouse problem wall just to view ordinary Orders')
console.log('ORDERS_NORMAL_AFTER_PARTIAL_RETURN_EXCHANGE_UI_PASS')
