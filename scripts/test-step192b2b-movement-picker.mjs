import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const helperPath = 'src/features/inventory/movementPickerB2B.ts'
  const helperSource = read(helperPath)
  const renderer = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
  const controller = read('src/app/controllers/useOperationalViewModel.ts')
  const css = read('src/styles/192b2b-movement-picker.css')

  for (const marker of [
    'TRANSFER_DEFAULT_ROW_LIMIT = 12',
    'TRANSFER_RECOVERY_ROW_LIMIT = 8',
    'Нет в учёте этой точки',
    'Исполнение: стандартное',
    'groupSearchText',
  ]) check(helperSource.includes(marker), `B2B helper marker missing: ${marker}`)

  check(renderer.includes("refineMovementPickerContext(ctx)"), 'Movement renderer does not apply B2B read-context refinement')
  check(renderer.includes("import '../../../styles/192b2b-movement-picker.css'"), 'B2B movement CSS is not loaded')
  check(!/\buse(?:State|Effect|Memo|Ref|Callback)\s*\(/.test(helperSource), 'B2B picker helper must remain hook-free')

  for (const marker of [
    'const targetRows = inventoryStockRowsForSource(inventoryDraft.targetSource)',
    'inventorySource: inventoryDraft.source',
    'quantity: 0',
    'return [...sourceRows, ...targetRows]',
  ]) check(controller.includes(marker), `Source-mismatch recovery path changed or missing: ${marker}`)

  for (const marker of [
    '.inventory-operation-card-transfer .inventory-operation-variants-table-shell',
    'position: sticky',
    'max-height: min(58vh, 560px)',
  ]) check(css.includes(marker), `B2B CSS marker missing: ${marker}`)

  const transpiled = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
  const mod = await import(moduleUrl)
  const refine = mod.refineMovementPickerContext
  check(typeof refine === 'function', 'B2B refineMovementPickerContext did not load')

  const rows = Array.from({ length: 15 }, (_unused, index) => ({
    id: index < 5 ? index + 1 : 0,
    variantId: index + 1,
    productName: 'ТЕСТ',
    material: index % 2 ? 'ЗАМША' : 'СТАНДАРТ',
    length: index % 3 ? 'СТАНДАРТ' : 'ДЛИННЫЙ',
    color: `ЦВЕТ ${index + 1}`,
    size: String(40 + index),
    gender: 'ЖЕН',
    quantity: index < 5 ? index + 1 : 0,
  }))
  const base = {
    inventoryDraft: { movementType: 'transfer' },
    inventoryExistingVariantSearch: '',
    inventoryOperationSearch: '',
    inventoryOperationAllProductGroups: [
      { key: 'target-only', productName: 'БЕЗ ОСТАТКА', totalQuantity: 0, rows: rows.slice(5) },
      { key: 'physical', productName: 'ТЕСТ', totalQuantity: 15, rows },
    ],
    selectedInventoryOperationGroup: { key: 'physical', productName: 'ТЕСТ', totalQuantity: 15, rows },
    selectedOperationDraftItems: [],
    operationVisibleRows: rows,
    inventoryOperationRowPrimary: (row) => `${row.color} · ${row.size}`,
    inventoryOperationRowSecondary: (row) => [row.material, row.length, 'Взрослый', row.gender].filter(Boolean).join(' · '),
  }

  const calm = refine(base)
  check(calm.operationVisibleRows.length <= mod.TRANSFER_DEFAULT_ROW_LIMIT, 'Default transfer list was not capped')
  check(calm.operationVisibleRows.every((row) => Number(row.quantity) > 0), 'Target-only recovery rows still crowd the normal transfer list')
  check(calm.inventoryOperationAllProductGroups[0].key === 'physical', 'Products physically present at source are not prioritized')

  const searched = refine({ ...base, inventoryExistingVariantSearch: 'ЦВЕТ 12', operationVisibleRows: rows.slice(10, 12) })
  check(searched.operationVisibleRows.length === 2, 'Explicit variant search must preserve all matching rows')
  check(searched.operationVisibleRows.some((row) => Number(row.id) === 0), 'Explicit search cannot reach source-mismatch recovery rows')

  const selectedRecovery = refine({
    ...base,
    selectedOperationDraftItems: [{ item: { variantId: 12 } }],
    operationVisibleRows: rows,
  })
  check(selectedRecovery.operationVisibleRows.some((row) => Number(row.variantId) === 12), 'Selected recovery row disappears when search is cleared')

  const recoveryOnlyRows = rows.slice(5)
  const recoveryOnly = refine({
    ...base,
    selectedInventoryOperationGroup: { key: 'target-only', productName: 'БЕЗ ОСТАТКА', totalQuantity: 0, rows: recoveryOnlyRows },
    operationVisibleRows: recoveryOnlyRows,
  })
  check(recoveryOnly.operationVisibleRows.length === mod.TRANSFER_RECOVERY_ROW_LIMIT, 'Recovery-only product does not keep a bounded fallback list')
  check(recoveryOnly.inventoryOperationRowSecondary(recoveryOnlyRows[0]).includes('Нет в учёте этой точки'), 'Recovery row is not explained to the manager')
  check(calm.inventoryOperationRowSecondary(rows[1]).startsWith('Исполнение:'), 'Execution is not surfaced before technical variant context')

  const searchable = refine({ ...base, inventoryOperationSearch: 'ЗАМША 46' })
  check(searchable.inventoryOperationAllProductGroups.some((group) => group.key === 'physical'), 'Product search no longer matches variant characteristics')

  console.log('STEP 192B2B MOVEMENT PICKER UX TESTS PASSED')
} catch (error) {
  console.error(`STEP 192B2B MOVEMENT PICKER UX TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
