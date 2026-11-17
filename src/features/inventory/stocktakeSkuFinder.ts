type StocktakeSkuRow = { id: number | string; variantId?: number | null; productName?: string; color?: string; size?: string }
type StocktakeSkuGroup = { rows: StocktakeSkuRow[]; productName: string }

export function findStocktakeSku(groups: StocktakeSkuGroup[], variantId: number) {
  if (!Number.isSafeInteger(variantId) || variantId <= 0) return null
  const matches: Array<{ groupIndex: number; itemId: number; label: string }> = []
  groups.forEach((group, groupIndex) => {
    for (const row of group.rows || []) {
      if (Number(row.variantId) !== variantId || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0) continue
      matches.push({
        groupIndex,
        itemId: Number(row.id),
        label: [group.productName, row.color, row.size].filter(Boolean).join(' · '),
      })
    }
  })
  // Never silently navigate to an arbitrary duplicate/colliding physical item.
  return matches.length === 1 ? matches[0] : null
}
