// Read-only, per-SKU and per-location decision plan. Neither a merge nor a writeoff.
// The employee must reconcile disputed physical quantities, not the reference label.
export type InventoryLocation = 'warehouse' | 'boutique'
export type ReconciliationMethod = 'sum' | 'keep_source' | 'keep_keeper' | 'physical_count' | 'defer'
export type LocationStock = {
  location: string
  sourcePhysical: number
  targetPhysical: number
  sourceReserved: number
  targetReserved: number
}
export type StockCheckEvidence = {
  variantId: number
  location: string
  countedQuantity: number
  checkedAt: string
  checkType: string
  checkedBy: string | null
}
type StockScenario = {
  method: ReconciliationMethod
  resultingPhysical: number | null
  changeFromSum: number | null
  reservedShortage: number | null
  needsPhysicalEvidence: boolean
  isExecutableNow: boolean
  note: string
}

export function buildStockReconciliationPlan(
  stock: LocationStock[],
  checks: StockCheckEvidence[],
  sourceVariantId: number,
  keeperVariantId: number,
) {
  const allowed = ['warehouse', 'boutique'] as const
  const invalid = stock.length !== 2
    || new Set(stock.map(place => place.location)).size !== 2
    || stock.some(place => !allowed.some(source => source === place.location)
      || [place.sourcePhysical, place.targetPhysical, place.sourceReserved, place.targetReserved]
        .some(quantity => !Number.isSafeInteger(quantity) || quantity < 0))
  if (invalid || !Number.isSafeInteger(sourceVariantId) || !Number.isSafeInteger(keeperVariantId)
    || sourceVariantId <= 0 || keeperVariantId <= 0 || sourceVariantId === keeperVariantId) {
    throw new Error('Некорректные или неполные складские данные: сверка невозможна.')
  }
  const locations = stock.map(place => {
    const combined = place.sourcePhysical + place.targetPhysical
    const reserved = place.sourceReserved + place.targetReserved
    if (!Number.isSafeInteger(combined) || !Number.isSafeInteger(reserved)) {
      throw new Error('Количество товаров превышает безопасный диапазон чисел.')
    }
    const latest = (variantId: number) =>
      checks.find(check => check.variantId === variantId && check.location === place.location) ?? null
    const plan = (method: ReconciliationMethod, proposed: number | null, note: string): StockScenario => ({
      method,
      resultingPhysical: proposed,
      changeFromSum: proposed === null ? null : proposed - combined,
      reservedShortage: proposed === null ? null : Math.max(0, reserved - proposed),
      needsPhysicalEvidence: method !== 'defer',
      isExecutableNow: false, // no unaudited balance mutation via this preview
      note,
    })
    return {
      location: place.location as InventoryLocation,
      sourceVariantId, keeperVariantId,
      sourcePhysical: place.sourcePhysical,
      keeperPhysical: place.targetPhysical,
      sourceReserved: place.sourceReserved,
      keeperReserved: place.targetReserved,
      reservedTotal: reserved,
      combinedPhysical: combined,
      requiresDecision: place.sourcePhysical > 0,
      needsInvestigation: place.sourcePhysical > 0 && place.targetPhysical > 0,
      lastSourceCount: latest(sourceVariantId),
      lastKeeperCount: latest(keeperVariantId),
      scenarios: [
        plan('sum', combined, 'Только если обе записи учитывают разные физические экземпляры.'),
        plan('keep_source', place.sourcePhysical, 'Только после подтверждения, что остаток основного варианта ошибочен или продублирован.'),
        plan('keep_keeper', place.targetPhysical, 'Только после подтверждения, что остаток лишнего варианта ошибочен или продублирован.'),
        plan('physical_count', null, 'Сотрудник пересчитывает реальный товар; фактическое количество не угадывается.'),
        plan('defer', null, 'Оставить пару без изменений до выяснения фактического количества.'),
      ],
    }
  })
  return {
    locations,
    requiresHumanStockDecision: locations.some(place => place.requiresDecision),
    // The old additive writer must remain unusable for stock-bearing source SKU.
    canRunLegacyAdditiveMerge: locations.every(place => !place.requiresDecision),
    requiresSeparateAuditedStockAdjustment: locations.some(place => place.requiresDecision),
    message: 'Объединение названий не определяет физические остатки. Решение принимается отдельно для каждого товара и места хранения.',
  }
}
