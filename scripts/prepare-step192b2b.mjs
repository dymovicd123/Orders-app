import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const write = (relative, value) => {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value, 'utf8')
}
const replaceExact = (relative, before, after) => {
  const current = read(relative)
  if (!current.includes(before)) throw new Error(`${relative}: expected patch anchor not found`)
  if (current.split(before).length !== 2) throw new Error(`${relative}: patch anchor is not unique`)
  write(relative, current.replace(before, after))
}

const rendererPath = 'src/features/inventory/views/renderInventoryMovementPanel.tsx'
replaceExact(
  rendererPath,
  "import type { InventoryRenderContext } from './types'\n",
  "import type { InventoryRenderContext } from './types'\nimport { refineMovementPickerContext } from '../movementPickerB2B'\nimport '../../../styles/192b2b-movement-picker.css'\n",
)
replaceExact(
  rendererPath,
  "export function renderInventoryMovementPanel(ctx: PanelContext) {\n  const {",
  "export function renderInventoryMovementPanel(ctx: PanelContext) {\n  // STEP 192B2B: refine only the read/UX context; the accepted JSX and transfer mutation runtime stay unchanged.\n  const movementCtx = refineMovementPickerContext(ctx)\n  const {",
)
replaceExact(rendererPath, "  } = ctx\n\n  return (", "  } = movementCtx\n\n  return (")

write('src/features/inventory/movementPickerB2B.ts', `type MovementPickerGroup = {
  key?: string
  productName?: string
  totalQuantity?: number
  rows?: any[]
}

type MovementPickerContext = {
  inventoryDraft?: { movementType?: string }
  inventoryExistingVariantSearch?: string
  inventoryOperationSearch?: string
  inventoryOperationAllProductGroups?: MovementPickerGroup[]
  selectedInventoryOperationGroup?: MovementPickerGroup | null
  selectedOperationDraftItems?: Array<{ item?: { variantId?: string | number } }>
  operationVisibleRows?: any[]
  inventoryOperationRowPrimary?: (row: any) => string
  inventoryOperationRowSecondary?: (row: any) => string
}

export const TRANSFER_DEFAULT_ROW_LIMIT = 12
export const TRANSFER_RECOVERY_ROW_LIMIT = 8

const numberValue = (value: unknown) => Number(value || 0)
const variantKey = (value: unknown) => String(value ?? '')
const normalize = (value: unknown) => String(value || '').trim().toLocaleUpperCase('ru-RU')
const isStandard = (value: unknown) => !normalize(value) || normalize(value) === 'СТАНДАРТ'
const isSourceRecoveryRow = (row: any) => numberValue(row?.quantity) <= 0 && numberValue(row?.id) === 0

function rowSortText(row: any) {
  return [row?.material, row?.length, row?.color, row?.size, row?.gender]
    .filter(Boolean)
    .join(' ')
}

function groupSearchText(group: MovementPickerGroup) {
  return (group.rows || [])
    .map((row) => [row?.productName, row?.material, row?.length, row?.color, row?.size, row?.gender]
      .filter(Boolean)
      .map(normalize)
      .join(' '))
    .join(' ')
}

function uniqueRows(rows: any[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = variantKey(row?.variantId)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function refineMovementPickerContext<T extends MovementPickerContext>(ctx: T): T {
  if (ctx.inventoryDraft?.movementType !== 'transfer') return ctx

  const rawGroups = Array.isArray(ctx.inventoryOperationAllProductGroups) ? ctx.inventoryOperationAllProductGroups : []
  const selectedGroupKey = String(ctx.selectedInventoryOperationGroup?.key || '')
  const productSearchTokens = normalize(ctx.inventoryOperationSearch).split(/\s+/).filter(Boolean)
  const searchedGroups = productSearchTokens.length
    ? rawGroups.filter((group) => {
        const haystack = groupSearchText(group)
        return productSearchTokens.every((token) => haystack.includes(token))
      })
    : rawGroups
  const candidateGroups = searchedGroups.length ? searchedGroups : rawGroups
  const inventoryOperationAllProductGroups = [...candidateGroups].sort((left, right) => {
    const leftSelected = selectedGroupKey && String(left.key || '') === selectedGroupKey ? 1 : 0
    const rightSelected = selectedGroupKey && String(right.key || '') === selectedGroupKey ? 1 : 0
    if (leftSelected !== rightSelected) return rightSelected - leftSelected
    const leftPhysical = (left.rows || []).some((row) => numberValue(row?.quantity) > 0) ? 1 : 0
    const rightPhysical = (right.rows || []).some((row) => numberValue(row?.quantity) > 0) ? 1 : 0
    if (leftPhysical !== rightPhysical) return rightPhysical - leftPhysical
    const quantityDelta = numberValue(right.totalQuantity) - numberValue(left.totalQuantity)
    if (quantityDelta) return quantityDelta
    return String(left.productName || '').localeCompare(String(right.productName || ''), 'ru', { numeric: true })
  })

  const selectedVariantIds = new Set(
    (ctx.selectedOperationDraftItems || [])
      .map((entry) => variantKey(entry?.item?.variantId))
      .filter(Boolean),
  )
  const searchActive = Boolean(String(ctx.inventoryExistingVariantSearch || '').trim())
  const rawVisibleRows = Array.isArray(ctx.operationVisibleRows) ? ctx.operationVisibleRows : []
  const sortedRows = [...rawVisibleRows].sort((left, right) => {
    const leftSelected = selectedVariantIds.has(variantKey(left?.variantId)) ? 1 : 0
    const rightSelected = selectedVariantIds.has(variantKey(right?.variantId)) ? 1 : 0
    if (leftSelected !== rightSelected) return rightSelected - leftSelected
    const leftPhysical = numberValue(left?.quantity) > 0 ? 1 : 0
    const rightPhysical = numberValue(right?.quantity) > 0 ? 1 : 0
    if (leftPhysical !== rightPhysical) return rightPhysical - leftPhysical
    const leftRecovery = isSourceRecoveryRow(left) ? 1 : 0
    const rightRecovery = isSourceRecoveryRow(right) ? 1 : 0
    if (leftRecovery !== rightRecovery) return leftRecovery - rightRecovery
    return rowSortText(left).localeCompare(rowSortText(right), 'ru', { numeric: true })
  })

  let operationVisibleRows = sortedRows
  if (!searchActive && sortedRows.length > TRANSFER_DEFAULT_ROW_LIMIT) {
    const selectedRows = sortedRows.filter((row) => selectedVariantIds.has(variantKey(row?.variantId)))
    const physicalRows = sortedRows.filter((row) => !selectedVariantIds.has(variantKey(row?.variantId)) && numberValue(row?.quantity) > 0)
    const sourceZeroRows = sortedRows.filter((row) => !selectedVariantIds.has(variantKey(row?.variantId)) && numberValue(row?.quantity) <= 0 && !isSourceRecoveryRow(row))
    const recoveryRows = sortedRows.filter((row) => !selectedVariantIds.has(variantKey(row?.variantId)) && isSourceRecoveryRow(row))

    if (physicalRows.length) {
      const limit = Math.max(TRANSFER_DEFAULT_ROW_LIMIT, selectedRows.length)
      operationVisibleRows = uniqueRows([...selectedRows, ...physicalRows, ...sourceZeroRows]).slice(0, limit)
    } else {
      const limit = Math.max(TRANSFER_RECOVERY_ROW_LIMIT, selectedRows.length)
      operationVisibleRows = uniqueRows([...selectedRows, ...sourceZeroRows, ...recoveryRows]).slice(0, limit)
    }
  }

  const rawPrimary = ctx.inventoryOperationRowPrimary || ((row: any) => String(row?.productName || ''))
  const rawSecondary = ctx.inventoryOperationRowSecondary || (() => '')
  const inventoryOperationRowPrimary = (row: any) => rawPrimary(row)
  const inventoryOperationRowSecondary = (row: any) => {
    const executionParts = [
      !isStandard(row?.material) ? String(row.material).trim() : '',
      !isStandard(row?.length) ? String(row.length).trim() : '',
    ].filter(Boolean)
    const executionLabel = executionParts.length
      ? `Исполнение: ${executionParts.join(' · ')}`
      : 'Исполнение: стандартное'
    const originalParts = String(rawSecondary(row) || '')
      .split(' · ')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part !== 'Стандартный вариант' && !executionParts.some((execution) => normalize(execution) === normalize(part)))
    const recoveryLabel = isSourceRecoveryRow(row) ? 'Нет в учёте этой точки — можно подтвердить фактическое наличие' : ''
    return [executionLabel, ...originalParts, recoveryLabel].filter(Boolean).join(' · ')
  }

  return {
    ...ctx,
    inventoryOperationAllProductGroups,
    operationVisibleRows,
    inventoryOperationRowPrimary,
    inventoryOperationRowSecondary,
  } as T
}
`)

write('src/styles/192b2b-movement-picker.css', `/* Step 192B2B — calm movement picker; Arrival is intentionally untouched. */
.inventory-operation-card-transfer .inventory-operation-product-picker {
  max-width: none;
}

.inventory-operation-card-transfer .inventory-operation-variant-filter {
  max-width: none;
  padding: 10px 12px;
  border: 1px solid #dbe5ef;
  border-radius: 11px;
  background: #f8fafc;
}

.inventory-operation-card-transfer .inventory-operation-variant-filter input {
  width: min(100%, 520px);
  min-height: 42px;
}

.inventory-operation-card-transfer .inventory-operation-variants-table-shell {
  max-height: min(58vh, 560px);
  overflow: auto;
  overscroll-behavior: contain;
}

.inventory-operation-card-transfer .inventory-operation-variants-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  box-shadow: inset 0 -1px #e2e8f0;
}

.inventory-operation-card-transfer .inventory-operation-variants-table td:first-child > strong {
  font-size: .9rem;
}

.inventory-operation-card-transfer .inventory-operation-variants-table td:first-child > span {
  max-width: 520px;
  line-height: 1.35;
}

.inventory-operation-card-transfer .inventory-operation-selected-product {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 11px;
  background: #fbfdff;
}

@media (max-width: 760px) {
  .inventory-operation-card-transfer .inventory-operation-variants-table-shell {
    max-height: 54vh;
  }

  .inventory-operation-card-transfer .inventory-operation-variant-filter {
    padding: 9px;
  }
}
`)

write('scripts/test-step192b2b-movement-picker.mjs', `import fs from 'node:fs'
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
`)

const releasePath = 'scripts/release-check.mjs'
replaceExact(
  releasePath,
  "    'scripts/test-step192b2a4-order-create-save-integrity.mjs',\n    'shared/api-contracts.ts',",
  "    'scripts/test-step192b2a4-order-create-save-integrity.mjs',\n    'scripts/test-step192b2b-movement-picker.mjs',\n    'src/features/inventory/movementPickerB2B.ts',\n    'src/styles/192b2b-movement-picker.css',\n    'shared/api-contracts.ts',",
)
replaceExact(
  releasePath,
  "  run('Step 192B2A4 order create/save integrity tests', process.execPath, [path.join(root, 'scripts/test-step192b2a4-order-create-save-integrity.mjs')])\n  run('Current database safety tests'",
  "  run('Step 192B2A4 order create/save integrity tests', process.execPath, [path.join(root, 'scripts/test-step192b2a4-order-create-save-integrity.mjs')])\n  run('Step 192B2B movement picker UX tests', process.execPath, [path.join(root, 'scripts/test-step192b2b-movement-picker.mjs')])\n  run('Current database safety tests'",
)

console.log('STEP 192B2B source patch prepared.')
