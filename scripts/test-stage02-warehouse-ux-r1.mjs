import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const operational = read('src/app/controllers/useOperationalViewModel.ts')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const stocktake = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
  const movement = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
  const attention = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
  const history = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
  const movementCss = read('src/styles/192b2b-movement-picker.css')

  check(
    operational.includes('if (!warehouseRow && !boutiqueRow) continue'),
    'S2-04: Warehouse model can again expand into catalog-only zero variants after lazy Catalog load',
  )
  check(
    operational.includes('Warehouse views must describe tracked inventory positions'),
    'S2-04: stable tracked-inventory search scope rationale missing',
  )

  check(
    overview.includes('placeholder="Товар, цвет, размер, материал…"'),
    'S2-08: exact characteristic search affordance missing',
  )
  check(
    overview.includes('уже обещано заказам') && overview.includes('оно не означает, что вещь физически отложена отдельно'),
    'S2-02: reservation wording again implies a physically set-aside item',
  )
  check(
    overview.includes('Эта позиция нужна этим заказам'),
    'S2-02: reservation detail heading again overstates physical disposition',
  )

  check(
    stocktake.includes('На старте показаны только товары, где сейчас есть физический остаток или резерв'),
    'S2-05: selective-stocktake scope is not explained',
  )
  check(
    stocktake.includes('добавьте её через «Нашли ещё позицию» внутри начатой проверки'),
    'S2-05: system-zero found-on-shelf recovery path is not exposed',
  )

  check(
    movement.includes("operationQuantity > 0 && shortageAfter > 0 ? 'inventory-transfer-after has-shortage'"),
    'S2-E09: transfer shows a post-transfer shortage before any quantity is entered',
  )
  for (const label of ["content: 'Позиция'", "content: 'По системе'", "content: 'Переместить'", "content: 'После'"]) {
    check(movementCss.includes(label), `S2-06: mobile transfer label missing: ${label}`)
  }
  check(
    movementCss.includes('.inventory-operation-card-transfer .inventory-operation-variants-table {') &&
      movementCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr));') &&
      movementCss.includes('.inventory-operation-card-transfer .inventory-operation-quantity-cell input'),
    'S2-06: transfer table is not converted to a readable mobile card layout',
  )

  check(
    inventory.includes("if (movement.referenceType === 'return_cancel') return 'Отмена возврата'") &&
      inventory.includes("if (movement.referenceType === 'exchange_cancel') return 'Отмена обмена'"),
    'S2-07: reversal movements again collapse into generic revision wording',
  )
  check(
    history.includes('Причина движения') &&
      history.includes('Отменён складской эффект возврата') &&
      history.includes('Отменён складской эффект обмена'),
    'S2-07: Warehouse history does not explain reversal business cause',
  )

  check(
    attention.includes("'openOrderFromFinance'") &&
      (attention.match(/Открыть заказ/g) || []).length >= 2 &&
      attention.includes('Для исправления нужен администратор'),
    'S2-01: manager Attention cards again expose a dead-end admin-only message without order context',
  )
  check(
    inventory.includes('openAttentionFoundCatalog: openFoundInventoryCatalog,\n        openOrderFromFinance,'),
    'S2-01: order-context action is not wired into Warehouse Attention',
  )

  console.log('STAGE02 WAREHOUSE UX R1 TESTS PASSED — stable tracked-stock search scope, explicit system-zero stocktake path, actionable manager Attention, business-readable reversal history, and mobile transfer cards are protected.')
} catch (error) {
  console.error(`STAGE02 WAREHOUSE UX R1 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
