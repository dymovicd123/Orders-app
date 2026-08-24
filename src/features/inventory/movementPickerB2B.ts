type MovementPickerGroup = {
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
  const defaultRowLimit = sortedRows.some((row) => numberValue(row?.quantity) > 0)
    ? TRANSFER_DEFAULT_ROW_LIMIT
    : TRANSFER_RECOVERY_ROW_LIMIT
  if (!searchActive && sortedRows.length > defaultRowLimit) {
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
