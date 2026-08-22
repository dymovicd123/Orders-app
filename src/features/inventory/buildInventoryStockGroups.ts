import type { InventorySortMode, InventorySourceKey, InventoryStockGroup, InventoryStockRecord } from '../../app/types'
import { canonicalCatalogProductKey, canonicalStockPositionValue, stockPositionDisplayName } from '../../app/utils'

type BuildInventoryStockGroupsOptions = {
  source: InventorySourceKey
  rows: InventoryStockRecord[]
  sortMode: InventorySortMode
  getCategory: (row: InventoryStockRecord) => 'adult' | 'child'
}

function sortGroups(groups: InventoryStockGroup[], sortMode: InventorySortMode) {
  return [...groups].sort((left, right) => {
    if (sortMode === 'quantityDesc') {
      return right.totalQuantity - left.totalQuantity || left.displayName.localeCompare(right.displayName, 'ru')
    }
    if (sortMode === 'quantityAsc') {
      return left.totalQuantity - right.totalQuantity || left.displayName.localeCompare(right.displayName, 'ru')
    }
    if (sortMode === 'updated') {
      return String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')) || left.displayName.localeCompare(right.displayName, 'ru')
    }
    return left.displayName.localeCompare(right.displayName, 'ru', { numeric: true })
  })
}

export function buildInventoryStockGroups({ source, rows, sortMode, getCategory }: BuildInventoryStockGroupsOptions) {
  const groups = new Map<string, InventoryStockGroup>()

  for (const rawRow of rows) {
    const category = getCategory(rawRow)
    const material = canonicalStockPositionValue(rawRow.material)
    const length = canonicalStockPositionValue(rawRow.length)
    const row = { ...rawRow, material, length }
    // Product IDs from old imports are not always unique: the same base product
    // can exist twice because of a hyphen or Kazakh/Russian spelling differences.
    // Visible stock positions must follow the business identity of the name, not
    // split colors across duplicate catalog IDs.
    const productIdentity = canonicalCatalogProductKey(row.productName) || `id:${Number(row.productId || 0)}`
    const key = [source, productIdentity, category, material, length].join('¦')
    const current = groups.get(key) || {
      key,
      source,
      productName: row.productName || 'Без названия',
      displayName: stockPositionDisplayName(row.productName, material, length),
      positionMaterial: material,
      positionLength: length,
      category,
      adultVariantCount: 0,
      childVariantCount: 0,
      rows: [],
      totalQuantity: 0,
      variantCount: 0,
      negativeCount: 0,
      zeroCount: 0,
      positiveCount: 0,
      updatedAt: '',
      colors: [],
      sizes: [],
      materials: [material],
      genders: [],
    }

    const quantity = Number(row.quantity || 0)
    current.rows.push(row)
    current.totalQuantity += quantity
    current.variantCount += 1
    if (category === 'child') current.childVariantCount += 1
    else current.adultVariantCount += 1
    if (quantity < 0) current.negativeCount += 1
    else if (quantity === 0) current.zeroCount += 1
    else current.positiveCount += 1
    if (String(row.updatedAt || '') > String(current.updatedAt || '')) current.updatedAt = row.updatedAt

    for (const [field, value] of [
      ['colors', row.color],
      ['sizes', row.size],
      ['genders', row.gender],
    ] as Array<[keyof Pick<InventoryStockGroup, 'colors' | 'sizes' | 'genders'>, string]>) {
      const clean = String(value || '').trim()
      if (clean && !current[field].includes(clean)) current[field].push(clean)
    }
    groups.set(key, current)
  }

  const normalized = [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((left, right) => {
      const leftQuantity = Number(left.quantity || 0)
      const rightQuantity = Number(right.quantity || 0)
      if (sortMode === 'quantityDesc') return rightQuantity - leftQuantity
      if (sortMode === 'quantityAsc') return leftQuantity - rightQuantity
      if (sortMode === 'updated') return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
      return [left.gender, left.color, left.size].join(' ').localeCompare([right.gender, right.color, right.size].join(' '), 'ru', { numeric: true })
    }),
  }))

  return sortGroups(normalized, sortMode)
}
