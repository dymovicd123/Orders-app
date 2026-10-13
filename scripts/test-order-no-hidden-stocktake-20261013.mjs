import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const app = read('src/App.tsx')
const orders = read('worker/domains/orders-write.ts')
const reservation = read('worker/domains/order-reservations.ts')
const inventory = read('worker/domains/inventory-movement.ts')
const inventoryRoute = read('worker/index.ts')
const movementPanel = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')

// Normal order create/edit must never send a total stock-count claim.
assert.equal(
  (app.match(/observedPhysicalQuantity: item\.sourceType !== 'workshop' && item\.stockObservationEnabled/g) || []).length,
  0,
  'Order create/edit still forwards an unverified absolute count',
)
assert.ok(!app.includes('Укажите фактическое количество для «${missingObservation.productName'),
  'Order save still forces the old fake stocktake prompt')

// Defense in depth: even stale clients sending 1 cannot edit physical truth.
assert.match(orders, /normalizeOrderItems\(items, sourceType\)\.map\(item => \([\s\S]*?observedPhysicalQuantity: null, shortageAcknowledged: true/)
assert.match(orders, /if \(rewriteItems\) \{[\s\S]*?item\.observedPhysicalQuantity = null;[\s\S]*?item\.shortageAcknowledged = true;/)
assert.match(reservation, /const observedPhysical = referenceType === 'exchange_new' && item\.observedPhysicalQuantity != null[\s\S]*?: null;/,
  'Only the explicitly separate legacy exchange workflow may still observe Physical')
assert.match(reservation, /SET quantity = CASE WHEN \? IS NULL THEN quantity ELSE \? END/,
  'Stock reservation update must leave Physical unchanged when there is no full count')
assert.match(reservation, /reserved_quantity = MAX\(0, COALESCE\(reserved_quantity, 0\) \+ \?\)/,
  'A valid order must still reserve stock')
assert.match(inventory, /if \(movementType === 'manual_set'\)/,
  'Administrator-initiated absolute correction must remain available')
assert.match(app, /postSaveShortages\.length\)[\s\S]*?Физический остаток не менялся/,
  'The UI must disclose shortages rather than quietly turning 1 into stock truth')

// Temporary warehouse access is intentionally EXPLICIT, never a side-effect of
// creating/editing an order. Only an independent warehouse action writes Physical.
assert.match(inventoryRoute, /managerWarehouseOperation = \['arrival', 'manual_set', 'writeoff'\]\.includes\(movementType\)/,
  'Unexpectedly broad warehouse mutation permission')
assert.match(movementPanel, /<details className="inventory-operation-more-actions">/,
  'Managers must see the deliberate arrival/correction actions under Warehouse')
assert.match(movementPanel, /\['manual_set','Исправить количество'\]/,
  'The deliberate count-correction action disappeared')

// The separate exchange workflow is deliberately NOT redesigned by this patch.
assert.match(reservation, /referenceType === 'exchange_new'/)
console.log('ORDER NO HIDDEN STOCKTAKE PASSED: ordinary orders preserve Physical; warehouse correction is a deliberate, separate action')
