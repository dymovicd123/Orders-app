// @ts-nocheck -- Exchange Set V2 is intentionally isolated from the legacy pair view while the old compatibility flow remains available.
import { useEffect, useMemo, useState } from 'react'
import '../../styles/193-exchange-set-v2.css'

type SectionContext = Record<string, any>

const issuedStockStatuses = new Set(['fulfilled', 'written_off', 'negative'])

export function OrderExchangeSmartSection({ ctx }: { ctx: SectionContext }) {
  const {
    addExchangeSetNewItem,
    applyExchangeSetNewItemPatch,
    applyExchangeSetNewProductPick,
    cancelExchangeEntry,
    closeExchangeForm,
    exchangeBusy,
    exchangeDraft,
    exchangeFormRef,
    exchangeHistory,
    exchangeHistoryBusy,
    exchangeHistoryError,
    exchangeHistoryFilters,
    exchangeHistoryHasMore,
    exchangeHistorySummary,
    exchangeSelectedOrder,
    formatMoney,
    FriendlyNumberInput,
    getOrderSourceAvailability,
    loadExchangeHistory,
    ManagerBadge,
    managerColorFor,
    orderPanelStyle,
    receiveReturnedItemAction,
    reconcileKnownInventoryLifecycle,
    removeExchangeSetNewItem,
    saveExchange,
    sectorStyle,
    setExchangeDraft,
    setExchangeHistoryFilters,
    setOrderPanel,
    SmartPickerInput,
    sourceLabel,
    suggestionValues,
  } = ctx

  const [receiptDestinations, setReceiptDestinations] = useState<Record<string, 'warehouse' | 'boutique' | 'no_stock'>>({})
  const [receivingExchangeId, setReceivingExchangeId] = useState<number | null>(null)

  const itemDetails = (item: any) => [item?.gender, item?.color, item?.material, item?.length, item?.size].filter(Boolean).join(' · ') || 'Характеристики не указаны'
  const historyItemDetails = (item: any) => itemDetails(item)
  const oldLineDefaultState = (item: any) => {
    const status = String(item?.stockWriteoffStatus || '').trim()
    const sentWorkshop = item?.sourceType === 'workshop' && exchangeSelectedOrder?.shipping_status === 'sent'
    const issued = issuedStockStatuses.has(status) || sentWorkshop || (!status && exchangeSelectedOrder?.shipping_status === 'sent')
    return issued ? 'pending' : 'not_issued'
  }

  const selectedOldById = useMemo(
    () => new Map((exchangeDraft.oldSelections || []).map((entry: any) => [Number(entry.orderItemId || 0), entry])),
    [exchangeDraft.oldSelections],
  )
  const exchangeableOldItems = (exchangeSelectedOrder?.items || []).filter((item: any) =>
    Number(item.id || 0) > 0 && Number(item.availableOperationQuantity ?? item.quantity ?? 0) > 0
  )

  const toggleOldItem = (item: any) => {
    const id = Number(item.id || 0)
    setExchangeDraft((current: any) => {
      const existing = (current.oldSelections || []).find((entry: any) => Number(entry.orderItemId || 0) === id)
      return {
        ...current,
        oldSelections: existing
          ? (current.oldSelections || []).filter((entry: any) => Number(entry.orderItemId || 0) !== id)
          : [...(current.oldSelections || []), { orderItemId: id, quantity: 1, physicalState: oldLineDefaultState(item) }],
      }
    })
  }
  const patchOldItem = (orderItemId: number, patch: Record<string, unknown>) => setExchangeDraft((current: any) => ({
    ...current,
    oldSelections: (current.oldSelections || []).map((entry: any) =>
      Number(entry.orderItemId || 0) === Number(orderItemId || 0) ? { ...entry, ...patch } : entry
    ),
  }))

  const removedValue = (exchangeDraft.oldSelections || []).reduce((sum: number, selected: any) => {
    const item = (exchangeSelectedOrder?.items || []).find((candidate: any) => Number(candidate.id || 0) === Number(selected.orderItemId || 0))
    return sum + Math.max(0, Number(selected.quantity || 0)) * Math.max(0, Number(item?.unitPrice || 0))
  }, 0)
  const addedValue = (exchangeDraft.newItems || []).reduce((sum: number, entry: any) =>
    sum + Math.max(0, Number(entry.item?.quantity || 0)) * Math.max(0, Number(entry.item?.unitPrice || 0)), 0)
  const removedQuantity = (exchangeDraft.oldSelections || []).reduce((sum: number, selected: any) =>
    sum + Math.max(0, Number(selected.quantity || 0)), 0)
  const addedQuantity = (exchangeDraft.newItems || []).reduce((sum: number, entry: any) =>
    sum + (String(entry.item?.productName || '').trim() ? Math.max(1, Number(entry.item?.quantity || 1)) : 0), 0)
  const currentTotal = Math.max(0, Number(exchangeSelectedOrder?.total_amount || 0))
  const currentNetPaid = Math.max(0, Number(exchangeSelectedOrder?.received_amount || 0) - Number(exchangeSelectedOrder?.return_amount || 0))
  const projectedTotal = Math.max(0, currentTotal - removedValue + addedValue)
  const dueBeforeSettlement = Math.max(0, projectedTotal - currentNetPaid)
  const refundAmount = Math.max(0, currentNetPaid - projectedTotal)
  const draftPaymentAmount = Math.max(0, Math.trunc(Number(exchangeDraft.paymentAmount || 0)))
  const paymentNow = refundAmount > 0 ? 0 : draftPaymentAmount
  const remainingDebt = Math.max(0, dueBeforeSettlement - paymentNow)

  useEffect(() => {
    if (draftPaymentAmount <= 0) return
    if (refundAmount <= 0 && draftPaymentAmount <= dueBeforeSettlement) return
    setExchangeDraft((current: any) => {
      const currentAmount = Math.max(0, Math.trunc(Number(current.paymentAmount || 0)))
      if (currentAmount <= 0) return current
      return { ...current, paymentAmount: 0, paymentMethod: '' }
    })
  }, [draftPaymentAmount, dueBeforeSettlement, refundAmount, setExchangeDraft])

  const filledNewItems = (exchangeDraft.newItems || []).filter((entry: any) => String(entry.item?.productName || '').trim())
  const newPricesReady = filledNewItems.every((entry: any) => {
    const price = entry.item?.unitPrice == null ? Number.NaN : Number(entry.item.unitPrice)
    return Number.isSafeInteger(price) && price >= 0
  })
  const saveBlockReason = !(exchangeDraft.oldSelections || []).length
    ? 'Выберите хотя бы один товар, который клиент возвращает.'
    : !filledNewItems.length
      ? 'Добавьте товар, который клиент получает.'
      : !newPricesReady
        ? 'Укажите цену продажи для каждого нового товара.'
        : refundAmount > 0 && draftPaymentAmount > 0
          ? 'После пересчёта доплата больше не нужна. Сумма оплаты будет очищена.'
          : refundAmount <= 0 && draftPaymentAmount > dueBeforeSettlement
            ? 'Введённая оплата больше нового долга. Сумма оплаты будет очищена.'
            : refundAmount > 0 && !String(exchangeDraft.refundMethod || '').trim()
              ? 'Выберите способ возврата денег.'
              : paymentNow > 0 && !String(exchangeDraft.paymentMethod || '').trim()
                ? 'Выберите способ оплаты.'
                : ''

  const pendingGroups = useMemo(() => (exchangeHistory || []).map((entry: any) => {
    const items = entry.isSetExchange
      ? (entry.oldItems || []).filter((item: any) => entry.status !== 'cancelled' && item.physicalTracking && !item.physicalReceivedAt && item.id)
      : entry.status !== 'cancelled' && entry.oldPhysicalTracking && !entry.oldPhysicalReceivedAt && entry.oldOperationItemId
        ? [{
            id: entry.oldOperationItemId,
            productName: entry.oldProductName,
            quantity: entry.oldQuantity,
            gender: entry.oldGender,
            color: entry.oldColor,
            material: entry.oldMaterial,
            length: entry.oldLength,
            size: entry.oldSize,
            isWorkshop: entry.oldIsWorkshop,
            sourceType: entry.oldSourceType,
          }]
        : []
    return { entry, items }
  }).filter((group: any) => group.items.length), [exchangeHistory])

  const loadedPendingQuantity = pendingGroups.reduce((sum: number, group: any) =>
    sum + group.items.reduce((itemSum: number, item: any) => itemSum + Math.max(0, Number(item.quantity || 0)), 0), 0)

  const defaultReturnedDestination = (item: any): 'warehouse' | 'boutique' | 'no_stock' =>
    item.sourceType === 'workshop' || item.isWorkshop
      ? 'no_stock'
      : item.sourceType === 'boutique'
        ? 'boutique'
        : 'warehouse'
  const receiptKey = (exchangeId: number, itemId: number) => `exchange:${exchangeId}:${itemId}`
  const destinationFor = (exchangeId: number, item: any) =>
    receiptDestinations[receiptKey(exchangeId, Number(item.id || 0))] || defaultReturnedDestination(item)

  const receiveWholeExchange = async (group: any) => {
    if (!group.items.length) return
    setReceivingExchangeId(Number(group.entry.id || 0))
    try {
      for (const item of group.items) {
        const received = await receiveReturnedItemAction({
          operationType: 'exchange',
          operationId: Number(group.entry.id || 0),
          operationItemId: Number(item.id || 0),
          destination: destinationFor(Number(group.entry.id || 0), item),
          productName: item.productName,
          externalId: group.entry.externalId,
          deferRefresh: true,
        })
        if (!received) break
      }
      await loadExchangeHistory()
    } finally {
      setReceivingExchangeId(null)
    }
  }

  const newItemStockIdentityKey = (item: any) => [
    item?.sourceType || 'warehouse',
    item?.productName,
    item?.audienceType,
    item?.gender,
    item?.color,
    item?.material,
    item?.length,
    item?.size,
  ].map((value) => String(value || '').trim().toUpperCase()).join('¦')

  const setObservedPhysicalForGroup = (indexes: number[], value: number | null, enabled = true) => {
    const selectedIndexes = new Set(indexes)
    setExchangeDraft((current: any) => ({
      ...current,
      newItems: (current.newItems || []).map((entry: any, itemIndex: number) =>
        selectedIndexes.has(itemIndex)
          ? { ...entry, item: { ...entry.item, stockObservationEnabled: enabled, observedPhysicalQuantity: value } }
          : entry
      ),
    }))
  }

  const oldHistoryStatus = (item: any) => {
    if (item.wasNotIssued || item.inventorySource === 'not_issued') return 'Не выдавалась клиенту — осталась на месте'
    if (!item.physicalTracking) return 'В старой записи возврат товара не отмечался'
    if (!item.physicalReceivedAt) return 'Ещё у клиента'
    if (item.inventorySource === 'warehouse') return item.lifecycleStatus === 'pending' ? 'Вернули → Склад · нужно завершить учёт' : 'Вернули → Склад'
    if (item.inventorySource === 'boutique') return item.lifecycleStatus === 'pending' ? 'Вернули → Бутик · нужно завершить учёт' : 'Вернули → Бутик'
    return 'Вернули · в остаток не добавляли'
  }

  return (
    <article className="card wide sector-orders exchange-set-page" id="order-exchange" style={{ ...sectorStyle('orders'), ...orderPanelStyle('exchange') }}>
      <div className="exchange-set-hero">
        <div>
          <div className="card-label">Обмен</div>
          <h2>Обмен заказа</h2>
          <p>Сначала выберите, что убираем из заказа, затем — что клиент получает взамен. Сумму и доплату система посчитает сама.</p>
        </div>
        <button className="secondary compact" type="button" onClick={() => setOrderPanel('list')}>К заказам</button>
      </div>

      {Number(exchangeHistorySummary.pendingPhysicalQuantity || 0) > 0 ? (
        <section className="exchange-return-queue" aria-label="Товары по обменам, которые ещё у клиентов">
          <div className="exchange-set-section-head">
            <div>
              <span className="exchange-set-kicker">Ожидают возврата</span>
              <h3>Товары ещё у клиентов · {exchangeHistorySummary.pendingPhysicalQuantity} шт.</h3>
              <p>Когда товары вернутся, укажите, куда принять каждый из них, и подтвердите возврат одной кнопкой.</p>
            </div>
          </div>
          <div className="exchange-return-groups">
            {pendingGroups.map((group: any) => (
              <div className="exchange-return-group" key={`pending-set-${group.entry.id}`}>
                <div className="exchange-return-group-head">
                  <div>
                    <strong>{group.entry.externalId}</strong>
                    <span>{group.entry.customer || 'Клиент не указан'} · обмен от {group.entry.exchangeDate || '—'}</span>
                  </div>
                  <b>{group.items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)} шт.</b>
                </div>
                <div className="exchange-return-lines">
                  {group.items.map((item: any) => (
                    <div className="exchange-return-line" key={receiptKey(group.entry.id, item.id)}>
                      <div>
                        <strong>{item.productName} × {item.quantity}</strong>
                        <span>{historyItemDetails(item)}</span>
                      </div>
                      <label>
                        <span>Что сделать</span>
                        <select
                          value={destinationFor(group.entry.id, item)}
                          disabled={exchangeBusy || receivingExchangeId === Number(group.entry.id)}
                          onChange={(event) => setReceiptDestinations((current) => ({
                            ...current,
                            [receiptKey(group.entry.id, item.id)]: event.target.value as 'warehouse' | 'boutique' | 'no_stock',
                          }))}
                        >
                          <option value="warehouse">Вернуть на Склад</option>
                          <option value="boutique">Вернуть в Бутик</option>
                          <option value="no_stock">Не добавлять в остаток</option>
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
                <button
                  className="primary exchange-return-confirm"
                  type="button"
                  disabled={exchangeBusy || receivingExchangeId !== null}
                  onClick={() => void receiveWholeExchange(group)}
                >
                  {receivingExchangeId === Number(group.entry.id) ? 'Принимаю товары…' : 'Подтвердить прибытие всех товаров'}
                </button>
              </div>
            ))}
          </div>
          {!pendingGroups.length ? <div className="history-load-state"><span>Ожидающие позиции есть дальше в истории.</span></div> : null}
          {exchangeHistoryHasMore && loadedPendingQuantity < Number(exchangeHistorySummary.pendingPhysicalQuantity || 0) ? (
            <button className="secondary compact" type="button" disabled={exchangeHistoryBusy} onClick={() => void loadExchangeHistory({ append: true })}>Загрузить ещё ожидающие</button>
          ) : null}
        </section>
      ) : null}

      {!exchangeSelectedOrder ? (
        <section className="exchange-set-empty-start">
          <strong>Откройте обмен у нужного заказа</strong>
          <span>В таблице заказов нажмите «Обмен». Здесь появятся реальные товары этого заказа и их цены продажи.</span>
          <button className="primary compact" type="button" onClick={() => setOrderPanel('list')}>Открыть заказы</button>
        </section>
      ) : (
        <section className="exchange-set-workspace" ref={exchangeFormRef}>
          <div className="exchange-order-context">
            <div>
              <span>Заказ</span>
              <strong>{exchangeSelectedOrder.external_id}</strong>
              <small>{exchangeSelectedOrder.customer_name || exchangeSelectedOrder.customer_phone || 'Клиент не указан'}</small>
            </div>
            <div><span>Сумма заказа</span><strong>{formatMoney(currentTotal)}</strong></div>
            <div><span>Уже оплачено</span><strong>{formatMoney(currentNetPaid)}</strong></div>
            <div><span>Долг</span><strong>{formatMoney(Math.max(0, currentTotal - currentNetPaid))}</strong></div>
          </div>

          <section className="exchange-set-step">
            <div className="exchange-set-section-head">
              <div><span className="exchange-set-kicker">1 · Старые товары</span><h3>Что убираем из заказа</h3><p>Выберите товары из этого заказа и нужное количество.</p></div>
            </div>
            <div className="exchange-old-grid">
              {exchangeableOldItems.map((item: any) => {
                const selected = selectedOldById.get(Number(item.id || 0))
                const orderQuantity = Math.max(0, Number(item.quantity || 0))
                const maxQuantity = Math.max(1, Number(item.availableOperationQuantity ?? item.quantity ?? 1))
                const itemStockStatus = String(item.stockWriteoffStatus || '').trim()
                const sentWorkshop = item.sourceType === 'workshop' && exchangeSelectedOrder.shipping_status === 'sent'
                const issued = issuedStockStatuses.has(itemStockStatus) || sentWorkshop || (!itemStockStatus && exchangeSelectedOrder.shipping_status === 'sent')
                return (
                  <div className={`exchange-old-card${selected ? ' is-selected' : ''}`} key={`old-set-${item.id}`}>
                    <button className="exchange-old-pick" type="button" onClick={() => toggleOldItem(item)}>
                      <span className="exchange-check">{selected ? '✓' : ''}</span>
                      <span className="exchange-old-main"><strong>{item.productName}</strong><small>{itemDetails(item)}</small></span>
                      <span className="exchange-old-order-info"><strong>{orderQuantity} шт.</strong><small>в заказе</small>{maxQuantity < orderQuantity ? <small>Можно обменять: {maxQuantity} шт.</small> : null}<em>Цена: {formatMoney(Number(item.unitPrice || 0))} / шт.</em></span>
                    </button>
                    {selected ? (
                      <div className="exchange-old-controls">
                        {maxQuantity > 1 ? (
                          <div className="exchange-quantity-control">
                            <span>Меняем</span>
                            <button type="button" onClick={() => patchOldItem(item.id, { quantity: Math.max(1, Number(selected.quantity || 1) - 1) })}>−</button>
                            <strong>{selected.quantity} из {maxQuantity}</strong>
                            <button type="button" onClick={() => patchOldItem(item.id, { quantity: Math.min(maxQuantity, Number(selected.quantity || 1) + 1) })}>+</button>
                          </div>
                        ) : <span className="exchange-one-unit">Меняем 1 шт.</span>}
                        {!issued ? (
                          <div className="exchange-auto-state"><strong>Товар клиенту не выдавали</strong><span>Просто уберём его из заказа — остаток не увеличится.</span></div>
                        ) : (
                          <div className="exchange-physical-choice">
                            <span>Товар уже вернулся?</span>
                            <div className="exchange-choice-row">
                              <button type="button" className={selected.physicalState === 'pending' ? 'is-active' : ''} onClick={() => patchOldItem(item.id, { physicalState: 'pending' })}>Нет, ещё у клиента</button>
                              <button type="button" className={selected.physicalState !== 'pending' ? 'is-active' : ''} onClick={() => patchOldItem(item.id, { physicalState: defaultReturnedDestination(item) })}>Да, уже у нас</button>
                            </div>
                            {selected.physicalState === 'pending' ? <small>Когда товар вернётся, он появится в списке ожидающих сверху.</small> : (
                              <label>
                                <span>Куда вернуть товар</span>
                                <select value={selected.physicalState} onChange={(event) => patchOldItem(item.id, { physicalState: event.target.value })}>
                                  <option value="warehouse">На склад</option>
                                  <option value="boutique">В бутик</option>
                                  <option value="no_stock">Не добавлять в остаток</option>
                                </select>
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {!exchangeableOldItems.length ? <div className="exchange-set-empty-inline">В заказе не осталось товаров, доступных для обмена.</div> : null}
            </div>
          </section>

          <section className="exchange-set-step">
            <div className="exchange-set-section-head">
              <div><span className="exchange-set-kicker">2 · Клиент получает</span><h3>Что выдаём взамен</h3><p>Добавьте товар, затем проверьте размер, цвет и количество.</p></div>
            </div>
            <div className="exchange-new-list">
              {(exchangeDraft.newItems || []).map((entry: any, index: number) => {
                const item = entry.item
                const required = Math.max(1, Number(item.quantity || 1))
                const identityKey = newItemStockIdentityKey(item)
                const matchingIndexes = item.sourceType === 'workshop'
                  ? [index]
                  : (exchangeDraft.newItems || [])
                      .map((candidate: any, candidateIndex: number) => newItemStockIdentityKey(candidate.item) === identityKey ? candidateIndex : -1)
                      .filter((candidateIndex: number) => candidateIndex >= 0)
                const batchRequired = matchingIndexes.reduce((sum: number, candidateIndex: number) =>
                  sum + Math.max(1, Number(exchangeDraft.newItems[candidateIndex]?.item?.quantity || 1)), 0)
                const groupObserved = matchingIndexes
                  .map((candidateIndex: number) => exchangeDraft.newItems[candidateIndex]?.item?.observedPhysicalQuantity)
                  .find((value: unknown) => value !== null && value !== undefined)
                const availability = item.sourceType === 'workshop' ? null : getOrderSourceAvailability(item, batchRequired)
                const physicalShortage = Boolean(availability?.canObservePhysical && Number(availability.currentPhysical || 0) < batchRequired)
                const observationOwner = matchingIndexes[0] === index
                return (
                  <div className="exchange-new-card" key={entry.draftKey}>
                    <div className="exchange-new-card-head">
                      <div><span>Товар {index + 1}</span><strong>{item.productName || 'Выберите товар'}</strong></div>
                      <button className="ghost danger compact" type="button" onClick={() => removeExchangeSetNewItem(index)}>Убрать</button>
                    </div>
                    <div className="exchange-new-primary-fields">
                      <label><span>Товар</span><SmartPickerInput value={item.productName || ''} options={suggestionValues.products} placeholder="Начните вводить название" onChange={(value) => applyExchangeSetNewItemPatch(index, { productName: value, unitPrice: undefined, catalogPriceSnapshot: null, priceOrigin: 'missing', priceNeedsConfirmation: false })} onPick={(value) => applyExchangeSetNewProductPick(index, value)} /></label>
                      <label><span>Количество</span><FriendlyNumberInput type="number" min="1" step="1" value={required} onChange={(event) => applyExchangeSetNewItemPatch(index, { quantity: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} /></label>
                      <label><span>Откуда выдаём</span><select value={item.sourceType || 'warehouse'} onChange={(event) => applyExchangeSetNewItemPatch(index, { sourceType: event.target.value })}><option value="warehouse">Склад</option><option value="boutique">Бутик</option><option value="workshop">Цех</option></select></label>
                    </div>
                    {String(item.productName || '').trim() ? (
                      <>
                        <div className="exchange-new-details">
                          <span className="exchange-field-group-title">Характеристики</span>
                          <div className="exchange-new-fields">
                            <label><span>Категория</span><select value={item.audienceType || 'ВЗРОСЛЫЙ'} onChange={(event) => applyExchangeSetNewItemPatch(index, { audienceType: event.target.value }, true)}><option value="ВЗРОСЛЫЙ">Взрослый</option><option value="ДЕТСКИЙ">Детский</option></select></label>
                            <label><span>Пол</span><select value={item.gender || ''} onChange={(event) => applyExchangeSetNewItemPatch(index, { gender: event.target.value })}><option value="">Не указан</option><option value="ЖЕН">Жен</option><option value="МУЖ">Муж</option></select></label>
                            <label><span>Цвет</span><SmartPickerInput value={item.color || ''} options={suggestionValues.colors} placeholder="Цвет" onChange={(value) => applyExchangeSetNewItemPatch(index, { color: value })} /></label>
                            <label><span>Материал</span><SmartPickerInput value={item.material || ''} options={suggestionValues.materials} placeholder="Материал" onChange={(value) => applyExchangeSetNewItemPatch(index, { material: value }, true)} /></label>
                            <label><span>Длина</span><SmartPickerInput value={item.length || ''} options={suggestionValues.lengths} placeholder="Длина" onChange={(value) => applyExchangeSetNewItemPatch(index, { length: value }, true)} /></label>
                            <label><span>{String(item.audienceType || '').includes('ДЕТ') ? 'Возраст' : 'Размер'}</span><SmartPickerInput value={item.size || ''} options={String(item.audienceType || '').includes('ДЕТ') ? suggestionValues.childAges : suggestionValues.sizes} placeholder={String(item.audienceType || '').includes('ДЕТ') ? 'Возраст' : 'Размер'} onChange={(value) => applyExchangeSetNewItemPatch(index, { size: value })} /></label>
                          </div>
                        </div>
                        <div className="exchange-new-price">
                          <div><span>Цена по каталогу</span><strong>{item.catalogPriceSnapshot == null ? 'Нет цены' : formatMoney(Number(item.catalogPriceSnapshot || 0))}</strong></div>
                          <label><span>Цена продажи</span><FriendlyNumberInput type="number" min="0" value={item.unitPrice ?? ''} onChange={(event) => applyExchangeSetNewItemPatch(index, { unitPrice: event.target.value === '' ? undefined : Math.max(0, Math.trunc(Number(event.target.value) || 0)), priceOrigin: 'manual' })} /></label>
                          <div><span>Итого за позицию</span><strong>{item.unitPrice == null ? '—' : formatMoney(required * Number(item.unitPrice || 0))}</strong></div>
                        </div>
                      </>
                    ) : <div className="exchange-new-hint">Сначала выберите товар — после этого появятся его характеристики и цена.</div>}
                    {availability ? (
                      <div className={`exchange-stock-note is-${availability.tone}`}>
                        <strong>{availability.label}</strong><span>{availability.note}</span>
                        {physicalShortage ? (
                          <div className="exchange-stock-confirm">
                            <span>{matchingIndexes.length > 1 ? `Для этих одинаковых позиций нужно ${batchRequired} шт. ` : ''}В системе товара не хватает. Если он действительно есть у вас, укажите количество на месте.</span>
                            {observationOwner ? (
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={groupObserved ?? ''}
                                placeholder="На месте"
                                onChange={(event) => setObservedPhysicalForGroup(
                                  matchingIndexes,
                                  event.target.value === '' ? null : Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                                  true,
                                )}
                              />
                            ) : <small>Фактическое количество задаётся один раз у первой одинаковой позиции.</small>}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {item.sourceType === 'workshop' ? (
                      <div className="exchange-workshop-fields">
                        <label className="exchange-workshop-note"><span>Комментарий цеху</span><input value={item.workshopComment || ''} onChange={(event) => applyExchangeSetNewItemPatch(index, { workshopComment: event.target.value })} /></label>
                        <label className="exchange-workshop-urgent"><input type="checkbox" checked={Boolean(item.workshopUrgent)} onChange={(event) => applyExchangeSetNewItemPatch(index, { workshopUrgent: event.target.checked, ...(event.target.checked ? {} : { workshopDueDate: '', workshopDueTime: '' }) })} /> Срочно для цеха</label>
                        {item.workshopUrgent ? (
                          <div className="exchange-workshop-deadline">
                            <label><span>Срок</span><input type="date" value={item.workshopDueDate || ''} onChange={(event) => applyExchangeSetNewItemPatch(index, { workshopDueDate: event.target.value })} /></label>
                            <label><span>Время</span><input type="time" value={item.workshopDueTime || ''} onChange={(event) => applyExchangeSetNewItemPatch(index, { workshopDueTime: event.target.value })} /></label>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <button className="secondary exchange-add-new" type="button" onClick={addExchangeSetNewItem}>+ Добавить товар</button>
            </div>
          </section>

          <section className="exchange-set-step exchange-money-step">
            <div className="exchange-set-section-head"><div><span className="exchange-set-kicker">3 · Деньги</span><h3>Расчёт после обмена</h3><p>Система сравнила новый итог заказа с тем, что клиент уже оплатил.</p></div></div>
            <div className="exchange-money-result">
              <div className="exchange-money-result-main"><span>Новый итог заказа</span><strong>{formatMoney(projectedTotal)}</strong></div>
              <div><span>Было</span><strong>{formatMoney(currentTotal)}</strong></div>
              <div><span>Уже оплачено</span><strong>{formatMoney(currentNetPaid)}</strong></div>
            </div>

            {refundAmount > 0 ? (
              <div className="exchange-settlement-card is-refund">
                <div><span>Вернуть клиенту</span><strong>{formatMoney(refundAmount)}</strong><small>Новый итог меньше уже оплаченной суммы.</small></div>
                <label><span>Способ возврата</span><SmartPickerInput value={exchangeDraft.refundMethod || ''} options={suggestionValues.paymentMethods} placeholder="Например, НАЛИЧКА" onChange={(value) => setExchangeDraft((current: any) => ({ ...current, refundMethod: value, paymentAmount: 0 }))} /></label>
              </div>
            ) : dueBeforeSettlement > 0 ? (
              <div className="exchange-settlement-card">
                <div><span>Нужно доплатить</span><strong>{formatMoney(dueBeforeSettlement)}</strong><small>Можно принять всю сумму сейчас, часть или оставить долг.</small></div>
                <label><span>Получаем сейчас</span><FriendlyNumberInput type="number" min="0" max={dueBeforeSettlement} value={exchangeDraft.paymentAmount || 0} onChange={(event) => setExchangeDraft((current: any) => ({ ...current, paymentAmount: Math.min(dueBeforeSettlement, Math.max(0, Math.trunc(Number(event.target.value) || 0))) }))} /></label>
                {paymentNow > 0 ? <label><span>Способ оплаты</span><SmartPickerInput value={exchangeDraft.paymentMethod || ''} options={suggestionValues.paymentMethods} placeholder="Например, KASPI" onChange={(value) => setExchangeDraft((current: any) => ({ ...current, paymentMethod: value }))} /></label> : null}
                <div className="exchange-debt-after"><span>Останется долг</span><strong>{formatMoney(remainingDebt)}</strong></div>
              </div>
            ) : (
              <div className="exchange-settlement-card is-even"><strong>Доплата не нужна</strong><span>Клиент уже оплатил ровно новый итог заказа.</span></div>
            )}
          </section>

          <section className="exchange-final-summary exchange-final-summary-compact">
            <div className="exchange-final-summary-head"><span className="exchange-set-kicker">Готово к сохранению</span><h3>Провести обмен</h3></div>
            <div className="exchange-final-checkline">
              <span>Убираем <strong>{removedQuantity} шт.</strong></span>
              <span>Получает <strong>{addedQuantity} шт.</strong></span>
              <span>Итог заказа <strong>{formatMoney(projectedTotal)}</strong></span>
              <span className={refundAmount > 0 ? 'is-refund' : dueBeforeSettlement > 0 ? 'is-payment' : 'is-even'}>
                {refundAmount > 0 ? <>Вернуть <strong>{formatMoney(refundAmount)}</strong></> : dueBeforeSettlement > 0 ? <>К доплате <strong>{formatMoney(dueBeforeSettlement)}</strong></> : <strong>Доплата не нужна</strong>}
              </span>
            </div>
            <div className="exchange-final-meta">
              <label><span>Дата обмена</span><input type="date" value={exchangeDraft.exchangeDate} onChange={(event) => setExchangeDraft((current: any) => ({ ...current, exchangeDate: event.target.value }))} /></label>
              <label className="wide-field"><span>Комментарий</span><input value={exchangeDraft.comment || ''} onChange={(event) => setExchangeDraft((current: any) => ({ ...current, comment: event.target.value }))} placeholder="Необязательно" /></label>
            </div>
            {saveBlockReason ? <div className="exchange-final-save-hint">{saveBlockReason}</div> : null}
            <div className="exchange-final-actions">
              <button className="primary" type="button" disabled={exchangeBusy || Boolean(saveBlockReason)} onClick={() => void saveExchange()}>{exchangeBusy ? 'Провожу обмен…' : 'Провести обмен'}</button>
              <button className="secondary" type="button" disabled={exchangeBusy} onClick={() => closeExchangeForm(true)}>Отменить и вернуться</button>
            </div>
          </section>
        </section>
      )}

      <section className="exchange-history-v2">
        <div className="exchange-set-section-head">
          <div><span className="exchange-set-kicker">История</span><h3>Проведённые обмены</h3><p>Здесь видно, что клиент вернул и что получил взамен.</p></div>
          <button className="secondary compact" type="button" disabled={exchangeHistoryBusy} onClick={() => void loadExchangeHistory()}>Обновить</button>
        </div>
        <div className="history-filter-bar">
          <label className="history-search-field"><span>Поиск</span><input value={exchangeHistoryFilters.q} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, q: event.target.value }))} placeholder="Заказ, клиент, товар" /></label>
          <label><span>С</span><input type="date" value={exchangeHistoryFilters.dateFrom} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, dateFrom: event.target.value }))} /></label>
          <label><span>По</span><input type="date" value={exchangeHistoryFilters.dateTo} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, dateTo: event.target.value }))} /></label>
          <label><span>Статус</span><select value={exchangeHistoryFilters.status} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, status: event.target.value }))}><option value="all">Все</option><option value="completed">Проведённые</option><option value="cancelled">Отменённые</option></select></label>
          <button className="primary compact" type="button" disabled={exchangeHistoryBusy} onClick={() => void loadExchangeHistory({ filters: exchangeHistoryFilters })}>Показать</button>
        </div>
        {exchangeHistoryError ? <div className="history-load-state is-error"><strong>Не удалось загрузить историю обменов.</strong><span>{exchangeHistoryError}</span></div>
          : exchangeHistoryBusy && !exchangeHistory.length ? <div className="history-load-state">Загружаю историю…</div>
            : exchangeHistory.length ? (
              <div className="exchange-history-list-v2">
                {exchangeHistory.map((entry: any) => {
                  const olds = entry.isSetExchange ? (entry.oldItems || []) : [{ id: entry.oldOperationItemId, productName: entry.oldProductName, quantity: entry.oldQuantity, gender: entry.oldGender, color: entry.oldColor, material: entry.oldMaterial, length: entry.oldLength, size: entry.oldSize, inventorySource: entry.oldReturnSource, physicalTracking: entry.oldPhysicalTracking, physicalReceivedAt: entry.oldPhysicalReceivedAt, isWorkshop: entry.oldIsWorkshop, wasNotIssued: entry.oldWasNotIssued, lifecycleStatus: entry.oldLifecycleStatus, lifecycleId: entry.oldLifecycleId, lifecycleVariantId: entry.oldLifecycleVariantId, currentVariantId: entry.oldCurrentVariantId }]
                  const news = entry.isSetExchange ? (entry.newItems || []) : [{ productName: entry.newProductName, quantity: entry.newQuantity, gender: entry.newGender, color: entry.newColor, material: entry.newMaterial, length: entry.newLength, size: entry.newSize, inventorySource: entry.newSourceType, lifecycleStatus: entry.newLifecycleStatus }]
                  const removedHistoryQuantity = olds.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.quantity || 0)), 0)
                  const addedHistoryQuantity = news.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.quantity || 0)), 0)
                  return (
                    <details className={`exchange-history-card-v2${entry.status === 'cancelled' ? ' is-cancelled' : ''}`} key={`exchange-history-v2-${entry.id}`}>
                      <summary><div><strong>{entry.externalId}</strong><span>{entry.customer || '—'} · {entry.exchangeDate || '—'}</span></div><div><b>Убрали: {removedHistoryQuantity} шт. · Добавили: {addedHistoryQuantity} шт.</b><span>{entry.status === 'cancelled' ? 'Отменён' : 'Проведён'}</span></div><span>Подробнее</span></summary>
                      <div className="exchange-history-body-v2">
                        <div className="exchange-history-side"><h4>Убрали из заказа</h4>{olds.map((item: any, index: number) => <div className="exchange-history-item-v2" key={`hist-old-${entry.id}-${item.id || index}`}><strong>{item.productName} × {item.quantity}</strong><span>{historyItemDetails(item)}</span><em>{oldHistoryStatus(item)}</em>{entry.status !== 'cancelled' && item.physicalReceivedAt && item.lifecycleStatus === 'pending' && item.lifecycleId && (item.lifecycleVariantId || item.currentVariantId) ? <button className="secondary compact" type="button" onClick={() => void reconcileKnownInventoryLifecycle(Number(item.lifecycleId || 0)).then((result: any) => result?.ok ? loadExchangeHistory() : null)}>Завершить приёмку</button> : null}</div>)}</div>
                        <div className="exchange-history-side"><h4>Добавили в заказ</h4>{news.map((item: any, index: number) => <div className="exchange-history-item-v2" key={`hist-new-${entry.id}-${item.id || index}`}><strong>{item.productName} × {item.quantity}</strong><span>{historyItemDetails(item)}</span><em>{item.inventorySource === 'workshop' ? 'Из цеха' : `Выдали: ${sourceLabel(item.inventorySource || 'warehouse')}`}</em></div>)}</div>
                      </div>
                      <div className="exchange-history-footer-v2">
                        <div><span>Деньги</span><strong>{entry.financialAction === 'extra_payment' ? `Получено +${formatMoney(entry.financialAmount)} · ${entry.paymentMethod || '—'}` : entry.financialAction === 'refund' ? `Возвращено −${formatMoney(entry.financialAmount)} · ${entry.paymentMethod || '—'}` : 'Без движения'}</strong></div>
                        {entry.comment ? <div><span>Комментарий</span><strong>{entry.comment}</strong></div> : null}
                        {entry.status !== 'cancelled' ? <button className="ghost danger compact" type="button" disabled={exchangeBusy} onClick={() => void cancelExchangeEntry(entry)}>Отменить обмен</button> : null}
                      </div>
                    </details>
                  )
                })}
                {exchangeHistoryHasMore ? <button className="secondary" type="button" disabled={exchangeHistoryBusy} onClick={() => void loadExchangeHistory({ append: true })}>Показать ещё</button> : null}
              </div>
            ) : <div className="history-load-state">Обменов по выбранным условиям нет.</div>}
      </section>
    </article>
  )
}
