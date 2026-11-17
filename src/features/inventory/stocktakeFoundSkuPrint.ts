import type { InventoryStocktakeSession } from '../../../shared/api-contracts.ts'
import type { ArrivalSkuPrintReceipt } from './views/BarcodePrintWorkspace'

/**
 * Only explicit new rows introduced after a stocktake began qualify for the
 * automatic label prompt. Original session rows and unresolved found stock
 * are never silently treated as additional physical deliveries.
 */
export function stocktakeFoundSkuPrintReceipt(session: InventoryStocktakeSession | null): ArrivalSkuPrintReceipt | null {
  if (!session || session.status !== 'completed' || !session.id || !session.startedAt ||
      (session.source !== 'warehouse' && session.source !== 'boutique')) return null
  const items = (session.items || []).flatMap(row => {
    const variantId = Number(row.variantId)
    const applied = row.appliedQuantity
    const baseline = Number(row.baselineQuantity)
    const counted = row.countedQuantity
    const newlyAdded = Boolean(row.createdAt && row.createdAt > session.startedAt)
    if (!newlyAdded || row.status !== 'applied' ||
        !Number.isSafeInteger(variantId) || variantId <= 0 ||
        !Number.isSafeInteger(applied) || !Number.isSafeInteger(baseline) ||
        applied === null || applied === undefined || counted === null || counted === undefined ||
        !Number.isSafeInteger(counted) || counted !== applied ||
        baseline < 0 || applied <= baseline) return []
    const quantity = applied - baseline
    return [{
      variantId, quantity,
      productName: row.productName,
      variantLabel: [row.gender, row.material, row.length, row.color, row.size]
        .filter(Boolean).filter(value => value !== 'СТАНДАРТ').join(' · '),
    }]
  })
  if (!items.length) return null
  // The printer verifies active catalog identity again immediately before print.
  const byVariant = new Map<number, (typeof items)[number]>()
  for (const item of items) {
    const existing = byVariant.get(item.variantId)
    byVariant.set(item.variantId, existing
      ? { ...existing, quantity: existing.quantity + item.quantity } : item)
  }
  return {
    operationId: 'stocktake:' + session.id,
    source: session.source,
    items: [...byVariant.values()],
  }
}
