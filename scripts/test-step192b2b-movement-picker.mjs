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
  const legacyCss = read('src/styles/192b2b-movement-picker.css')
  const w4Css = read('src/styles/w4-human-operations.css')

  for (const marker of [
    'TRANSFER_PRIMARY_ROW_LIMIT = 6',
    'TRANSFER_SEARCH_ROW_LIMIT = 14',
    'partitionTransferVariantRows',
    'Нет в учёте этой точки',
    'groupSearchText',
    'hasMessyFormatting',
    'variantSimilarityKey',
  ]) check(helperSource.includes(marker), `B2B/W4 helper marker missing: ${marker}`)

  check(renderer.includes('refineMovementPickerContext(ctx)'), 'Movement renderer does not apply B2B read-context refinement')
  check(renderer.includes('partitionTransferVariantRows('), 'Movement renderer does not partition the human first-screen list')
  check(renderer.includes("import '../../../styles/192b2b-movement-picker.css'"), 'B2B movement CSS is not loaded')
  check(renderer.includes("import '../../../styles/w4-human-operations.css'"), 'W4 movement CSS is not loaded')
  check(renderer.includes('Ещё {transferPartition.extra.length} вариантов'), 'Overflow variants are not visibly recoverable')
  check(!/\buse(?:State|Effect|Memo|Ref|Callback)\s*\(/.test(helperSource), 'B2B picker helper must remain hook-free')

  for (const marker of [
    'const targetRows = inventoryStockRowsForSource(inventoryDraft.targetSource)',
    'inventorySource: inventoryDraft.source',
    'quantity: 0',
    'return [...sourceRows, ...targetRows]',
  ]) check(controller.includes(marker), `Source-mismatch recovery path changed or missing: ${marker}`)

  // Keep the established desktop shell and W4 mobile/overflow affordances.
  for (const marker of [
    '.inventory-operation-card-transfer .inventory-operation-variants-table-shell',
    'position: sticky',
    'max-height: min(58vh, 560px)',
  ]) check(legacyCss.includes(marker), `B2B CSS marker missing: ${marker}`)
  for (const marker of [
    '.inventory-transfer-extra-variants',
    '.inventory-transfer-extra-row',
    '@media (max-width: 760px)',
  ]) check(w4Css.includes(marker), `W4 CSS marker missing: ${marker}`)

  const transpiled = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
  const mod = await import(moduleUrl)
  const refine = mod.refineMovementPickerContext
  const partition = mod.partitionTransferVariantRows
  check(typeof refine === 'function', 'B2B refineMovementPickerContext did not load')
  check(typeof partition === 'function', 'W4 partitionTransferVariantRows did not load')

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

  // W4 deliberately preserves the full semantic result set in the helper. The renderer
  // bounds visual load and keeps overflow reachable instead of silently deleting rows.
  const calm = refine(base)
  check(calm.operationVisibleRows.length === rows.length, 'W4 helper silently drops transfer variants')
  check(calm.operationVisibleRows.some((row) => Number(row.id) === 0), 'Zero/source-mismatch variants disappeared before the renderer can disclose them')
  check(calm.inventoryOperationAllProductGroups[0].key === 'physical', 'Products physically present at source are not prioritized')

  const calmPartition = partition(calm.operationVisibleRows, [], false)
  check(calmPartition.primary.length === mod.TRANSFER_PRIMARY_ROW_LIMIT, 'Default first-screen variant list is not bounded to six rows')
  check(calmPartition.extra.length === rows.length - mod.TRANSFER_PRIMARY_ROW_LIMIT, 'Overflow variants are lost instead of moving under “Ещё варианты”')
  check([...calmPartition.primary, ...calmPartition.extra].length === rows.length, 'Partition does not preserve every exact variant')
  check(calmPartition.extra.some((row) => Number(row.id) === 0), 'Zero/source-mismatch rows are not reachable in overflow')

  const searchedRows = rows.slice(5)
  const searched = refine({ ...base, inventoryExistingVariantSearch: 'ЦВЕТ 12', operationVisibleRows: searchedRows })
  check(searched.operationVisibleRows.length === searchedRows.length, 'Explicit variant search loses matching/recovery rows')
  const searchedPartition = partition(searched.operationVisibleRows, [], true)
  check(searchedPartition.primary.length === searchedRows.length, 'Small explicit search must show all matching rows')
  check(searchedPartition.primary.some((row) => Number(row.id) === 0), 'Explicit search cannot reach source-mismatch recovery rows')

  const selectedRecovery = refine({
    ...base,
    selectedOperationDraftItems: [{ item: { variantId: 12 } }],
    operationVisibleRows: rows,
  })
  const selectedPartition = partition(selectedRecovery.operationVisibleRows, [12], false)
  check(selectedPartition.primary.some((row) => Number(row.variantId) === 12), 'Selected recovery row disappears from the first screen when search is cleared')

  const recoveryOnlyRows = rows.slice(5)
  const recoveryOnly = refine({
    ...base,
    selectedInventoryOperationGroup: { key: 'target-only', productName: 'БЕЗ ОСТАТКА', totalQuantity: 0, rows: recoveryOnlyRows },
    operationVisibleRows: recoveryOnlyRows,
  })
  const recoveryPartition = partition(recoveryOnly.operationVisibleRows, [], false)
  check(recoveryPartition.primary.length === mod.TRANSFER_PRIMARY_ROW_LIMIT, 'Recovery-only product does not keep a bounded first screen')
  check(recoveryPartition.extra.length === recoveryOnlyRows.length - mod.TRANSFER_PRIMARY_ROW_LIMIT, 'Recovery-only overflow becomes unreachable')
  check(recoveryOnly.inventoryOperationRowSecondary(recoveryOnlyRows[0]).includes('Нет в учёте этой точки'), 'Recovery row is not explained to the manager')
  check(calm.inventoryOperationRowSecondary(rows[1]).includes('ЗАМША'), 'Execution detail disappeared from the human variant label')

  // Quantity is never a garbage signal. A zero variant can be ordinary; only identity/noise
  // heuristics may make it visually secondary.
  const zeroOrdinary = { id: 0, variantId: 1001, productName: 'ТЕСТ', material: 'ЗАМША', length: 'СТАНДАРТ', color: 'ЧЕРНЫЙ', size: '46', gender: 'ЖЕН', quantity: 0 }
  const zeroPartition = partition([zeroOrdinary], [], false)
  check(!zeroPartition.unusualIds.has('1001'), 'Zero quantity incorrectly marks a valid variant as garbage')

  const searchable = refine({ ...base, inventoryOperationSearch: 'ЗАМША 46' })
  check(searchable.inventoryOperationAllProductGroups.some((group) => group.key === 'physical'), 'Product search no longer matches variant characteristics')

  console.log('STEP 192B2B MOVEMENT PICKER UX TESTS PASSED — full variant truth is preserved while W4 bounds the first screen and keeps zero/recovery variants reachable')
} catch (error) {
  console.error(`STEP 192B2B MOVEMENT PICKER UX TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
