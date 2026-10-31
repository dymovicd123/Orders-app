import type { InventoryCheckHistoryRow, InventoryHistoryResponse, InventoryOperationAttempt } from '../../app/types'

export type StockMovement = InventoryHistoryResponse['movements'][number]
export type StockTimelineEvent =
  | { kind: 'movement'; moment: string; key: string; movement: StockMovement }
  | { kind: 'check'; moment: string; key: string; check: InventoryCheckHistoryRow }
  | { kind: 'attempt'; moment: string; key: string; attempt: InventoryOperationAttempt }

export function stockCheckHasDifference(check: InventoryCheckHistoryRow): boolean {
  return check.expectedQuantity !== undefined && check.countedQuantity !== undefined
    && Number(check.expectedQuantity) !== Number(check.countedQuantity)
}

export function buildStockVariantTimeline(
  movements: StockMovement[], checks: InventoryCheckHistoryRow[],
  source: 'warehouse' | 'boutique', variantId: number, attempts: InventoryOperationAttempt[] = [],
) {
  // Identity is exact. The source API is expected to filter by source and variant,
  // but the presentation must not ever mix separate location histories.
  const exactMovements = movements.filter(movement =>
    movement.inventorySource === source && Number(movement.variantId) === variantId)
  const exactChecks = checks.filter(check =>
    check.source === source && check.expectedQuantity !== undefined && check.countedQuantity !== undefined)
  const firstObservedDifference = exactChecks.filter(stockCheckHasDifference)
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt) || String(a.id).localeCompare(String(b.id)))[0] || null
  const events: StockTimelineEvent[] = [
    ...exactMovements.map(movement => ({
      kind: 'movement' as const, moment: movement.createdAt,
      key: `m-${movement.id}`, movement,
    })),
    ...attempts.filter(attempt => attempt.source === source && attempt.variantId === variantId).map(attempt => ({
      kind: 'attempt' as const, moment: attempt.recordedAt,
      key: `a-${attempt.id}`, attempt,
    })),
    ...exactChecks.map(check => ({
      kind: 'check' as const, moment: check.checkedAt,
      key: `c-${check.id}`, check,
    })),
  ].sort((a, b) => a.moment.localeCompare(b.moment) || a.key.localeCompare(b.key))
  return { events, firstObservedDifference }
}
