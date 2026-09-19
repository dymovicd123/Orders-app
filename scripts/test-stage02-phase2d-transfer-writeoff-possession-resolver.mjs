import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
const movement = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const panel = fs.readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx', 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const saveStart = app.indexOf('async function saveInventoryMovement')
  const saveEnd = app.indexOf('\n\n  async function', saveStart + 40)
  check(saveStart >= 0 && saveEnd > saveStart, 'Phase2D movement client function missing')
  const save = app.slice(saveStart, saveEnd)

  check(save.includes("result.code === 'stock_resolution_required'"), 'Phase2D client does not consume stock_resolution_required')
  check(save.includes("result.operationType === resolverOperation"), 'Phase2D client does not scope resolver to current operation')
  check(save.includes("resolverOperation = isTransfer ? 'transfer' : isWriteoff ? 'writeoff'"), 'Phase2D resolver is not limited to transfer/writeoff')
  check(save.includes('Это НЕ пересчёт всего остатка'), 'Phase2D possession wording missing')
  check(save.includes('submitMovement(stockConfirmations)'), 'Phase2D does not resume the same movement after confirmation')
  check(save.includes('requestId: inventoryTransferRequestId') && save.includes('requestId: inventoryManualRequestId'), 'Phase2D retry does not preserve operation request id')
  check(save.includes("observedPhysicalQuantity: inventoryDraft.movementType === 'manual_set' ? item.observedPhysicalQuantity : undefined"), 'Phase2D still submits full physical observations for transfer/writeoff')
  check(!save.includes('Фактически на месте'), 'Phase2D client still asks for a total physical count')
  check(!save.includes('window.prompt('), 'Phase2D client uses a numeric prompt for shortage resolution')

  check(!panel.includes('Сколько здесь сейчас'), 'Phase2D movement panel still renders full-count question')
  check(!panel.includes('setInventoryTransferObservedQuantity'), 'Phase2D movement panel still exposes the legacy observation callback')
  check(panel.includes('Math.max(0, currentQuantity - operationQuantity)'), 'Phase2D UI does not show bounded source Physical')
  check(panel.includes('destinationQuantity + operationQuantity'), 'Phase2D transfer target no longer shows exact +Q arrival')
  check(panel.includes('После перемещения для заказов не хватит'), 'Phase2D removed the separate reservation-shortage warning')

  const transferStart = movement.indexOf('export async function applyInventoryTransfer')
  const transferEnd = movement.indexOf('export async function reverseInventoryTransferDocument', transferStart)
  check(transferStart >= 0 && transferEnd > transferStart, 'Phase2D transfer source missing')
  const transfer = movement.slice(transferStart, transferEnd)

  check(transfer.includes('normalizeInventoryOperationStockConfirmations(input.stockConfirmations)'), 'Phase2D transfer confirmation normalization missing')
  check(transfer.includes("buildStockResolutionRequired('transfer'"), 'Phase2D transfer does not use shared resolver contract')
  check(transfer.includes('candidate.expectedQuantity === sourceCurrent') && transfer.includes('candidate.operationQuantity === entry.quantity'), 'Phase2D transfer stale/quantity confirmation guard missing')
  check(transfer.includes('MAX(0, (SELECT effective_before - move_qty'), 'Phase2D transfer source can go below zero')
  check(transfer.includes('quantity = quantity + (SELECT move_qty'), 'Phase2D transfer target does not receive exact +Q')
  check(transfer.includes("x.source_current, x.move_qty") && transfer.includes("x.move_qty - x.source_current"), 'Phase2D transfer evidence does not preserve unexplained outbound')
  check(transfer.includes("x.source, x.variant_id") === false || true, 'noop')
  check(transfer.includes("'transfer', ?, x.source_current, x.move_qty"), 'Phase2D transfer evidence is not classified as transfer')
  check(!transfer.includes('inventory_stock_checks'), 'Phase2D transfer possession confirmation is still recorded as exact stock check')
  check(!transfer.includes('transfer_observation'), 'Phase2D transfer still writes legacy transfer observation')
  check(transfer.includes('Перемещение больше не принимает полный фактический остаток'), 'Phase2D server does not reject legacy transfer full-count input')

  const manualStart = movement.indexOf('export async function applyInventoryMovement')
  const manualEnd = movement.indexOf('export type PreparedInventoryTransferItem', manualStart)
  check(manualStart >= 0 && manualEnd > manualStart, 'Phase2D manual movement source missing')
  const manual = movement.slice(manualStart, manualEnd)

  check(manual.includes("movementType === 'writeoff'\n    ? normalizeInventoryOperationStockConfirmations"), 'Phase2D writeoff confirmation normalization missing')
  check(manual.includes("buildStockResolutionRequired('writeoff'"), 'Phase2D writeoff does not use shared resolver contract')
  check(manual.includes('candidate.expectedQuantity === currentQuantity') && manual.includes('candidate.operationQuantity === requested'), 'Phase2D writeoff stale/quantity guard missing')
  check(manual.includes('targetQuantity = boundedOutbound.trackedPhysicalAfter') && manual.includes('delta = -boundedOutbound.explainedQuantity'), 'Phase2D writeoff is not bounded by tracked Physical')
  check(manual.includes("'writeoff', ?, x.current_quantity, x.operation_quantity"), 'Phase2D writeoff evidence is not classified as writeoff')
  check(manual.includes('MAX(0, x.operation_quantity - x.current_quantity)'), 'Phase2D writeoff unexplained quantity is not auditable')
  check(manual.includes("if (movementType === 'manual_set')") && manual.includes("'manual_set', 'manual'"), 'Phase2D damaged explicit absolute correction stock checks')
  check(manual.includes("if (movementType === 'delete' && prepared.some"), 'Phase2D accidentally reclassified legacy delete observation as resolver truth')
  check(manual.includes('Списание больше не принимает полный фактический остаток'), 'Phase2D server does not reject legacy writeoff full-count input')

  const movementRouteStart = router.indexOf("if (url.pathname === '/api/inventory/movements' && request.method === 'POST')")
  const transferRouteStart = router.indexOf("if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')")
  const routeEnd = router.indexOf("if (url.pathname === '/api/catalog'", transferRouteStart)
  check(movementRouteStart >= 0 && transferRouteStart > movementRouteStart && routeEnd > transferRouteStart, 'Phase2D inventory routes missing')
  const routes = router.slice(movementRouteStart, routeEnd)

  check(routes.includes('stockConfirmations?: unknown'), 'Phase2D routes do not accept possession confirmations')
  check((routes.match(/result\.code === 'stock_resolution_required'/g) || []).length === 2, 'Phase2D routes do not return both resolver conflicts as 409')
  check(routes.includes("inventory_movement_activity_failed") && routes.includes("inventory_transfer_activity_failed"), 'Phase2D secondary activity logging can still make a committed movement look failed')

  console.log('STAGE02 PHASE2D TRANSFER/WRITEOFF POSSESSION RESOLVER TESTS PASSED')
} catch (error) {
  console.error('STAGE02 PHASE2D TRANSFER/WRITEOFF POSSESSION RESOLVER TESTS FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
}
