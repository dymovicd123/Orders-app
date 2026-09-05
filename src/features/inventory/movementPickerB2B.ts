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

export const TRANSFER_PRIMARY_ROW_LIMIT = 6
export const TRANSFER_SEARCH_ROW_LIMIT = 14

const numberValue = (value: unknown) => Number(value || 0)
const variantKey = (value: unknown) => String(value ?? '')
const normalize = (value: unknown) => String(value || '').trim().toLocaleUpperCase('ru-RU')
const isStandard = (value: unknown) => !normalize(value) || normalize(value) === 'СТАНДАРТ'
const isSourceRecoveryRow = (row: any) => numberValue(row?.quantity) <= 0 && numberValue(row?.id) === 0

function compactNormalize(value: unknown) {
  return normalize(value)
    .replaceAll('Ё', 'Е')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
}

function variantSimilarityKey(row: any) {
  return [row?.gender, row?.color, row?.size, row?.material, row?.length]
    .map(compactNormalize)
    .join('|')
}

function hasMessyFormatting(row: any) {
  return [row?.gender, row?.color, row?.size, row?.material, row?.length].some((value) => {
    const raw = String(value || '')
    if (!raw) return false
    return raw !== raw.trim() || /\s{2,}/.test(raw) || /[.,;:]$/.test(raw.trim())
  })
}

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

export function partitionTransferVariantRows(
  rows: any[],
  selectedVariantIds: Iterable<string | number> = [],
  searchActive = false,
) {
  const selected = new Set(Array.from(selectedVariantIds, variantKey).filter(Boolean))
  const unique = uniqueRows(rows)
  const similarity = new Map<string, any[]>()
  for (const row of unique) {
    const key = variantSimilarityKey(row)
    const list = similarity.get(key) || []
    list.push(row)
    similarity.set(key, list)
  }

  const unusualIds = new Set<string>()
  for (const candidates of similarity.values()) {
    if (candidates.length <= 1) continue
    const canonical = [...candidates].sort((left, right) => {
      const leftSelected = selected.has(variantKey(left?.variantId)) ? 1 : 0
      const rightSelected = selected.has(variantKey(right?.variantId)) ? 1 : 0
      if (leftSelected !== rightSelected) return rightSelected - leftSelected
      const quantityDelta = numberValue(right?.quantity) - numberValue(left?.quantity)
      if (quantityDelta) return quantityDelta
      return numberValue(left?.variantId) - numberValue(right?.variantId)
    })[0]
    for (const row of candidates) {
      if (variantKey(row?.variantId) !== variantKey(canonical?.variantId)) unusualIds.add(variantKey(row?.variantId))
    }
  }
  for (const row of unique) {
    if (hasMessyFormatting(row)) unusualIds.add(variantKey(row?.variantId))
  }

  const ranked = [...unique].sort((left, right) => {
    const leftSelected = selected.has(variantKey(left?.variantId)) ? 1 : 0
    const rightSelected = selected.has(variantKey(right?.variantId)) ? 1 : 0
    if (leftSelected !== rightSelected) return rightSelected - leftSelected
    const leftUnusual = unusualIds.has(variantKey(left?.variantId)) ? 1 : 0
    const rightUnusual = unusualIds.has(variantKey(right?.variantId)) ? 1 : 0
    if (leftUnusual !== rightUnusual) return leftUnusual - rightUnusual
    const leftPhysical = numberValue(left?.quantity) > 0 ? 1 : 0
    const rightPhysical = numberValue(right?.quantity) > 0 ? 1 : 0
    if (leftPhysical !== rightPhysical) return rightPhysical - leftPhysical
    const leftRecovery = isSourceRecoveryRow(left) ? 1 : 0
    const rightRecovery = isSourceRecoveryRow(right) ? 1 : 0
    if (leftRecovery !== rightRecovery) return leftRecovery - rightRecovery
    return rowSortText(left).localeCompare(rowSortText(right), 'ru', { numeric: true })
  })

  const limit = searchActive ? TRANSFER_SEARCH_ROW_LIMIT : TRANSFER_PRIMARY_ROW_LIMIT
  const primary = ranked.slice(0, Math.max(limit, selected.size))
  const primaryIds = new Set(primary.map((row) => variantKey(row?.variantId)))
  const extra = ranked.filter((row) => !primaryIds.has(variantKey(row?.variantId)))
  return { primary, extra, unusualIds }
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
  const rawVisibleRows = Array.isArray(ctx.operationVisibleRows) ? ctx.operationVisibleRows : []
  const operationVisibleRows = [...rawVisibleRows].sort((left, right) => {
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

  const rawPrimary = ctx.inventoryOperationRowPrimary || ((row: any) => String(row?.productName || ''))
  const rawSecondary = ctx.inventoryOperationRowSecondary || (() => '')
  const inventoryOperationRowPrimary = (row: any) => rawPrimary(row)
  const inventoryOperationRowSecondary = (row: any) => {
    const executionParts = [
      !isStandard(row?.material) ? String(row.material).trim() : '',
      !isStandard(row?.length) ? String(row.length).trim() : '',
    ].filter(Boolean)
    const executionLabel = executionParts.length ? executionParts.join(' · ') : ''
    const originalParts = String(rawSecondary(row) || '')
      .split(' · ')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part !== 'Стандартный вариант' && !executionParts.some((execution) => normalize(execution) === normalize(part)))
    const recoveryLabel = isSourceRecoveryRow(row) ? 'Нет в учёте этой точки' : ''
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
