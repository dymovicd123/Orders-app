import type { EditorItem, ExchangeDraft, OrderRecord } from './types'

// Pure, side-effect-free preparation of saved/unsaved legacy Exchange pairs.
// UI state, financial posting and the per-pair idempotent writes stay in App.
export function prepareLegacyExchangePairs(
  exchangeSelectedOrder: OrderRecord,
  exchangeDraft: ExchangeDraft,
  getOrderSourceAvailability: (
    item: EditorItem,
    requiredQuantity: number,
  ) => { canObservePhysical?: boolean; currentPhysical?: number | null } | null | undefined,
) {
  const itemizedExchange = exchangeSelectedOrder.pricing_mode === 'itemized_v1'
    const exchangeableOldItems = exchangeSelectedOrder.items.filter((item) => Number(item.id || 0) > 0 && Number(item.availableOperationQuantity ?? item.quantity ?? 0) > 0)
    const queuedPairs = exchangeDraft.queuedPairs || []
    const requestedCurrentOldItem = exchangeableOldItems.find((item) => Number(item.id || 0) === Number(exchangeDraft.oldItemId || 0)) || null
    const visibleCurrentOldItem = requestedCurrentOldItem || exchangeableOldItems[0] || null
    const currentPair = String(exchangeDraft.newItem.productName || '').trim() && visibleCurrentOldItem ? {
      draftKey: exchangeDraft.currentPairKey,
      oldItemId: Number(visibleCurrentOldItem.id || 0),
      oldQuantity: Math.max(1, Number(exchangeDraft.oldQuantity || 1)),
      oldReturnSource: exchangeDraft.oldPhysicalState === 'warehouse' || exchangeDraft.oldPhysicalState === 'boutique' ? exchangeDraft.oldPhysicalState : 'none',
      oldPhysicalState: exchangeDraft.oldPhysicalState,
      newItem: exchangeDraft.newItem,
      newSourceWasManuallyChanged: exchangeDraft.newSourceWasManuallyChanged,
      saved: false,
    } : null
    const pairDrafts = [...queuedPairs, ...(currentPair ? [currentPair] : [])]
    if (!pairDrafts.length) {
      return { ok: false as const, error: exchangeableOldItems.length ? 'Добавьте хотя бы одну позицию обмена.' : 'В заказе не осталось доступных позиций для обмена.' }
    }
    if (exchangeDraft.financialAction !== 'none' && Number(exchangeDraft.financialAmount || 0) <= 0) {
      return { ok: false as const, error: 'Укажите сумму доплаты или возврата больше нуля.' }
    }
    if (exchangeDraft.financialAction !== 'none' && !exchangeDraft.paymentMethod.trim()) {
      return { ok: false as const, error: exchangeDraft.financialAction === 'refund' ? 'Выберите способ возврата денег.' : 'Выберите способ оплаты для доплаты.' }
    }

    const unsavedPairs: Array<{
      index: number
      draftKey: string
      isQueued: boolean
      selectedOldItem: OrderRecord['items'][number]
      oldQuantity: number
      oldReturnSource: 'none' | 'warehouse' | 'boutique'
      oldPhysicalState: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'
      effectiveNewItem: EditorItem
      newSourceWasManuallyChanged: boolean
    }> = []
    const requestedByOldItem = new Map<number, number>()

    for (let index = 0; index < pairDrafts.length; index += 1) {
      const pair = pairDrafts[index]
      if (pair.saved) continue
      const selectedOldItem = exchangeableOldItems.find((item) => Number(item.id || 0) === Number(pair.oldItemId || 0)) || null
      if (!selectedOldItem) {
        return { ok: false as const, error: `Позиция обмена ${index + 1}: старая вещь уже недоступна. Уберите эту строку и выберите актуальную позицию.` }
      }
      const oldQuantity = Math.max(1, Number(pair.oldQuantity || 1))
      const oldItemId = Number(selectedOldItem.id || 0)
      const accumulated = (requestedByOldItem.get(oldItemId) || 0) + oldQuantity
      requestedByOldItem.set(oldItemId, accumulated)
      const availableOldQuantity = Math.max(0, Number(selectedOldItem.availableOperationQuantity ?? selectedOldItem.quantity ?? 0))
      if (accumulated > availableOldQuantity) {
        return { ok: false as const, error: `Позиция обмена ${index + 1}: суммарно выбрано ${accumulated} шт., доступно ${availableOldQuantity} шт.` }
      }
      if (!String(pair.newItem?.productName || '').trim()) {
        return { ok: false as const, error: `Позиция обмена ${index + 1}: заполните новый товар.` }
      }

      const inheritedReplacementSource = selectedOldItem.sourceType === 'workshop'
        ? 'workshop'
        : selectedOldItem.sourceType === 'boutique'
          ? 'boutique'
          : 'warehouse'
      const effectiveNewItem = pair.newSourceWasManuallyChanged
        ? pair.newItem
        : { ...pair.newItem, sourceType: inheritedReplacementSource as EditorItem['sourceType'] }
      if (itemizedExchange) {
        const oldActiveQuantity = Number(selectedOldItem.quantity)
        const oldUnitPrice = Number(selectedOldItem.unitPrice)
        const oldLineTotal = Number(selectedOldItem.lineTotal)
        const oldCatalogSnapshot = selectedOldItem.catalogPriceSnapshot == null ? null : Number(selectedOldItem.catalogPriceSnapshot)
        const newUnitPrice = effectiveNewItem.unitPrice == null ? Number.NaN : Number(effectiveNewItem.unitPrice)
        const newCatalogSnapshot = effectiveNewItem.catalogPriceSnapshot == null ? null : Number(effectiveNewItem.catalogPriceSnapshot)
        if (!Number.isSafeInteger(oldActiveQuantity) || oldActiveQuantity <= 0
          || !Number.isSafeInteger(oldUnitPrice) || oldUnitPrice < 0
          || !Number.isSafeInteger(oldLineTotal) || oldLineTotal !== oldActiveQuantity * oldUnitPrice
          || (oldCatalogSnapshot !== null && (!Number.isSafeInteger(oldCatalogSnapshot) || oldCatalogSnapshot < 0))) {
          return { ok: false as const, error: `Позиция обмена ${index + 1}: ценовые данные старой позиции устарели или повреждены. Обновите заказ и откройте обмен заново.` }
        }
        if (!Number.isSafeInteger(newUnitPrice) || newUnitPrice < 0) {
          return { ok: false as const, error: `Позиция обмена ${index + 1}: укажите фактическую цену продажи новой позиции.` }
        }
        if (newCatalogSnapshot !== null && (!Number.isSafeInteger(newCatalogSnapshot) || newCatalogSnapshot < 0)) {
          return { ok: false as const, error: `Позиция обмена ${index + 1}: снимок цены Каталога некорректен. Обновите товар в форме обмена.` }
        }
      }
      const exchangeRequiredQuantity = Math.max(1, Number(effectiveNewItem.quantity || 1))
      const exchangeAvailability = effectiveNewItem.sourceType === 'workshop'
        ? null
        : getOrderSourceAvailability(effectiveNewItem, exchangeRequiredQuantity)
      const needsPhysicalConfirmation = Boolean(exchangeAvailability?.canObservePhysical && Number(exchangeAvailability.currentPhysical || 0) < exchangeRequiredQuantity)
      if (needsPhysicalConfirmation && !effectiveNewItem.stockObservationEnabled) {
        return { ok: false as const, error: `Позиция обмена ${index + 1}: по учёту товара недостаточно. Подтвердите только наличие конкретных вещей для выдачи — общий остаток изменять не нужно.` }
      }

      unsavedPairs.push({
        index,
        draftKey: pair.draftKey || `pair-${index + 1}`,
        isQueued: index < queuedPairs.length,
        selectedOldItem,
        oldQuantity,
        oldReturnSource: pair.oldPhysicalState === 'warehouse' || pair.oldPhysicalState === 'boutique' ? pair.oldPhysicalState : 'none',
        oldPhysicalState: pair.oldPhysicalState,
        effectiveNewItem: { ...effectiveNewItem, observedPhysicalQuantity: null },
        newSourceWasManuallyChanged: Boolean(pair.newSourceWasManuallyChanged),
      })
    }

    if (!unsavedPairs.length) {
      return { ok: false as const, error: 'Все позиции этого обмена уже были сохранены. Обновите историю обменов.' }
    }
    return { ok: true as const, pairDrafts, unsavedPairs }
}
