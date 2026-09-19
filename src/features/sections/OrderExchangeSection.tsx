// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
type SectionContext = Record<string, any>

export function OrderExchangeSection({ ctx }: { ctx: SectionContext }) {
  const {
    applyExchangeProductPick,
    cancelExchangeEntry,
    closeExchangeForm,
    correctExchangeFinancialEntry,
    createExchangeDraft,
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
    saveExchange,
    sectorStyle,
    setExchangeDraft,
    setExchangeHistoryFilters,
    setOrderPanel,
    SmartPickerInput,
    sourceLabel,
    suggestionValues,
  } = ctx

  const [financialCorrection, setFinancialCorrection] = useState<any>(null)
  const [receiptDestinations, setReceiptDestinations] = useState<Record<string, 'warehouse' | 'boutique' | 'no_stock'>>({})

  const openFinancialCorrection = (entry: any) => {
    setFinancialCorrection({
      exchangeId: entry.id,
      exchangeDate: entry.exchangeDate || '',
      financialAmount: Number(entry.financialAmount || 0),
      paymentMethod: entry.paymentMethod || '',
      comment: entry.comment || '',
    })
  }

  const formatHistoryCharacteristics = (entry: any, prefix: 'old' | 'new') => {
    const fields = [
      ['Пол', entry[`${prefix}Gender`]],
      ['Цвет', entry[`${prefix}Color`]],
      ['Материал', entry[`${prefix}Material`]],
      ['Длина', entry[`${prefix}Length`]],
      ['Размер/возраст', entry[`${prefix}Size`]],
    ]
      .filter(([, value]) => String(value || '').trim())
      .map(([label, value]) => `${label}: ${String(value).trim()}`)

    return fields.length ? fields.join(' · ') : 'Характеристики не указаны'
  }

  const oldReceiptNeedsRecovery = (entry: any) => Boolean(
    entry.oldPhysicalTracking
    && entry.oldPhysicalReceivedAt
    && (entry.oldReturnSource === 'warehouse' || entry.oldReturnSource === 'boutique')
    && !entry.oldLifecycleStatus
  )
  const oldKnownIntakePending = (entry: any) => Boolean(
    entry.oldPhysicalTracking
    && entry.oldPhysicalReceivedAt
    && entry.oldLifecycleId
    && (entry.oldLifecycleVariantId || entry.oldCurrentVariantId)
    && entry.oldLifecycleStatus === 'pending'
    && (entry.oldReturnSource === 'warehouse' || entry.oldReturnSource === 'boutique')
  )
  const finishKnownExchangeIntake = async (entry: any) => {
    const result = await reconcileKnownInventoryLifecycle(Number(entry.oldLifecycleId || 0))
    if (result?.ok) await loadExchangeHistory()
  }
  const oldReturnLabel = (entry: any) => {
    if (!entry.oldPhysicalTracking) return 'Старая запись — физическое получение не отслеживалось'
    if (!entry.oldPhysicalReceivedAt) return 'Ещё не пришла'
    if (entry.oldReturnSource !== 'warehouse' && entry.oldReturnSource !== 'boutique') return 'Получена, в остаток не добавляли'
    const destination = entry.oldReturnSource === 'warehouse' ? 'Склад' : 'Бутик'
    if (!entry.oldLifecycleStatus) return `Получена → ${destination}; складской учёт не завершён`
    if (entry.oldLifecycleStatus === 'pending') return `Получена → ${destination}; остаток требует уточнения`
    if (entry.oldLifecycleStatus === 'cancelled') return `Получена; проведение в ${destination} отменено`
    if (entry.oldLifecycleStatus === 'applied') return `Получена → ${destination}`
    return `Получена → ${destination}; статус учёта: ${entry.oldLifecycleStatus}`
  }

  const newIssueLabel = (source: string, lifecycleStatus?: string | null) => {
    if (source === 'workshop') return 'Новая вещь: Цех'
    const origin = source === 'boutique' ? 'бутик' : 'склад'
    if (lifecycleStatus === 'pending') return `Ожидает выдачи: ${origin}`
    if (lifecycleStatus === 'cancelled') return 'Физическая выдача отменена'
    if (lifecycleStatus === 'applied') return `Выдано: ${origin}`
    return `Источник: ${sourceLabel(source as OrderRecord['source_type'])}`
  }

  const queuedPairs = exchangeDraft.queuedPairs || []
  const queuedOldQuantityByItem = new Map<number, number>()
  for (const pair of queuedPairs) {
    if (pair.saved) continue
    const orderItemId = Number(pair.oldItemId || 0)
    if (!orderItemId) continue
    queuedOldQuantityByItem.set(orderItemId, (queuedOldQuantityByItem.get(orderItemId) || 0) + Math.max(1, Number(pair.oldQuantity || 1)))
  }
  const exchangeableOldItems = (exchangeSelectedOrder?.items || [])
    .map((item: any) => ({
      ...item,
      operationAvailableQuantity: Math.max(
        0,
        Number(item.availableOperationQuantity ?? item.quantity ?? 0) - (queuedOldQuantityByItem.get(Number(item.id || 0)) || 0),
      ),
    }))
    .filter((item: any) => Number(item.id || 0) > 0 && Number(item.operationAvailableQuantity || 0) > 0)
  const draftOldItemIsValid = exchangeableOldItems.some((item: any) => (
    Number(item.id || 0) === Number(exchangeDraft.oldItemId || 0)
  ))
  // A controlled <select> visually shows its first option even when its value is
  // an empty string that matches no option. Resolve the same concrete item that
  // the user sees so the UI and the submitted payload can never disagree again.
  const effectiveOldItemId = draftOldItemIsValid
    ? Number(exchangeDraft.oldItemId || 0)
    : Number(exchangeableOldItems[0]?.id || 0)
  const effectiveOldItem = exchangeableOldItems.find((item: any) => Number(item.id || 0) === effectiveOldItemId) || null
  const effectiveOldItemIsWorkshop = effectiveOldItem?.sourceType === 'workshop'

  const replacementSourceForItem = (item: any) => item?.sourceType === 'workshop'
    ? 'workshop'
    : item?.sourceType === 'boutique'
      ? 'boutique'
      : 'warehouse'

  const resetObservedStock = (item: any, patch: Record<string, unknown>) => ({
    ...item,
    ...patch,
    stockObservationEnabled: false,
    observedPhysicalQuantity: null,
  })
  const exchangeAvailability = exchangeDraft.newItem.sourceType === 'workshop'
    ? null
    : getOrderSourceAvailability(exchangeDraft.newItem, Math.max(1, Number(exchangeDraft.newItem.quantity || 1)))
  const exchangeObservationEnabled = Boolean(exchangeDraft.newItem.stockObservationEnabled)
  const exchangeObservedPhysical = exchangeDraft.newItem.observedPhysicalQuantity
  const exchangeRequired = Math.max(1, Number(exchangeDraft.newItem.quantity || 1))
  const exchangePhysical = Number(exchangeAvailability?.currentPhysical || 0)
  const exchangeReserved = Math.max(0, Number(exchangeAvailability?.currentReserved || 0))
  const exchangePhysicalShortage = Boolean(exchangeAvailability?.canObservePhysical && exchangePhysical < exchangeRequired)
  const exchangeFreeAfterIssue = exchangePhysical - exchangeReserved - exchangeRequired
  const effectiveOldAvailableQuantity = Math.max(0, Number(effectiveOldItem?.operationAvailableQuantity || 0))
  const currentPairReady = Boolean(effectiveOldItem && effectiveOldAvailableQuantity > 0 && String(exchangeDraft.newItem.productName || '').trim())
  const queueCurrentExchangePair = () => {
    if (!currentPairReady) return
    if (exchangePhysicalShortage && !exchangeObservationEnabled) return
    if (exchangeObservationEnabled && (exchangeObservedPhysical === null || exchangeObservedPhysical === undefined || !Number.isInteger(Number(exchangeObservedPhysical)) || Number(exchangeObservedPhysical) < exchangeRequired)) return
    const fresh = createExchangeDraft(exchangeSelectedOrder)
    const pair = {
      draftKey: exchangeDraft.currentPairKey || fresh.currentPairKey,
      oldItemId: effectiveOldItemId,
      oldQuantity: Math.min(effectiveOldAvailableQuantity, Math.max(1, Number(exchangeDraft.oldQuantity || 1))),
      oldReturnSource: exchangeDraft.oldPhysicalState === 'warehouse' || exchangeDraft.oldPhysicalState === 'boutique' ? exchangeDraft.oldPhysicalState : 'none',
      oldPhysicalState: exchangeDraft.oldPhysicalState,
      newItem: { ...exchangeDraft.newItem },
      newSourceWasManuallyChanged: Boolean(exchangeDraft.newSourceWasManuallyChanged),
      saved: false,
    }
    setExchangeDraft((current) => ({
      ...fresh,
      orderId: current.orderId,
      exchangeDate: current.exchangeDate,
      queuedPairs: [...(current.queuedPairs || []), pair],
      financialAction: current.financialAction,
      financialAmount: current.financialAmount,
      paymentMethod: current.paymentMethod,
      comment: current.comment,
    }))
  }
  const removeQueuedExchangePair = (draftKey: string) => setExchangeDraft((current) => ({
    ...current,
    queuedPairs: (current.queuedPairs || []).filter((pair: any) => pair.draftKey !== draftKey || pair.saved),
  }))

  return (
    <article className="card wide sector-orders" id="order-exchange" style={{ ...sectorStyle('orders'), ...orderPanelStyle('exchange') }}>
              <div className="card-label">Обмен товара</div>
              <div className="card-meta">Обмен открывается из главной таблицы заказов или из активного цеха. Для старой вещи отдельно укажите: она ещё едет или уже физически пришла.</div>
    
              <section className="mini-panel exchange-start-note">
                <div className="mini-panel-head">
                  <div>
                    <h3>Обмен открывается из таблицы заказов</h3>
                    <p className="mini-panel-note">Нажмите кнопку <strong>«Обмен»</strong> в главной таблице заказов или в активном цехе. Так менеджер не ошибётся заказом.</p>
                  </div>
                  <button className="secondary compact back-action" type="button" onClick={() => setOrderPanel('list')}>К таблице заказов</button>
                </div>
              </section>
    
              <section className="mini-panel debt-form-panel" ref={exchangeFormRef}>
                <div className="mini-panel-head">
                  <h3>Форма обмена</h3>
                  <div className="mini-panel-actions">
                    {exchangeSelectedOrder ? (
                      <button className="secondary compact back-action" type="button" onClick={() => closeExchangeForm(false)} disabled={exchangeBusy}>
                        Назад
                      </button>
                    ) : null}
                    <button
                      className="secondary compact"
                      type="button"
                      onClick={() => setExchangeDraft(createExchangeDraft(exchangeSelectedOrder))}
                      disabled={!exchangeSelectedOrder || exchangeBusy}
                    >
                      Сбросить
                    </button>
                  </div>
                </div>
    
                {exchangeSelectedOrder ? (
                  <>
                    <div className="editor-summary debt-target-summary">
                      <div className="editor-summary-head">
                        <div>
                          <strong>{exchangeSelectedOrder.external_id}</strong>
                          <span>{exchangeSelectedOrder.order_date} · {exchangeSelectedOrder.manager_name || '—'} · {exchangeSelectedOrder.customer_name || exchangeSelectedOrder.customer_phone || '—'}</span>
                        </div>
                        <span className="status-pill status-warning">Обмен с доплатой или возвратом при необходимости</span>
                      </div>
                    </div>
    
                    <div className="stack">
                      {queuedPairs.length ? (
                        <div className="mini-item order-payment-card">
                          <div className="mini-item-head"><strong>Позиции, добавленные в этот обмен</strong><span className="soft-badge">{queuedPairs.length}</span></div>
                          <div className="stack">
                            {queuedPairs.map((pair: any, index: number) => {
                              const oldItem = (exchangeSelectedOrder?.items || []).find((item: any) => Number(item.id || 0) === Number(pair.oldItemId || 0))
                              return (
                                <div className="history-detail-grid" key={`queued-exchange-${pair.draftKey}`}>
                                  <div><span>Позиция {index + 1}</span><strong>{oldItem?.productName || `Позиция #${pair.oldItemId}`} × {pair.oldQuantity}</strong></div>
                                  <div><span>Новая вещь</span><strong>{pair.newItem?.productName || '—'} × {pair.newItem?.quantity || 1}</strong></div>
                                  <div><span>Статус</span><strong>{pair.saved ? 'Уже сохранено' : 'Готово к оформлению'}</strong></div>
                                  <div className="row-actions"><button className="ghost danger compact" type="button" disabled={exchangeBusy || pair.saved} onClick={() => removeQueuedExchangePair(pair.draftKey)}>{pair.saved ? 'Сохранено' : 'Убрать'}</button></div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ) : null}
                      <div className="mini-item order-payment-card">
                        <div className="mini-item-head"><strong>Старая позиция</strong></div>
                        <div className="subgrid order-payment-grid">
                          <label className="wide-field">
                            <span>Что клиент возвращает</span>
                            <select
                              value={String(effectiveOldItemId || '')}
                              onChange={(event) => {
                                const oldItemId = Number(event.target.value || 0)
                                const selectedItem = exchangeableOldItems.find((item: any) => Number(item.id || 0) === oldItemId) || null
                                setExchangeDraft((current) => ({
                                  ...current,
                                  oldItemId,
                                  oldQuantity: 1,
                                  oldReturnSource: 'none',
                                  oldPhysicalState: selectedItem?.sourceType === 'workshop' ? 'no_stock' : 'pending',
                                  newSourceWasManuallyChanged: false,
                                  newItem: resetObservedStock(current.newItem, {
                                    sourceType: replacementSourceForItem(selectedItem),
                                  }),
                                }))
                              }}
                              disabled={!exchangeableOldItems.length}
                            >
                              {!exchangeableOldItems.length ? <option value="">Нет доступных позиций</option> : null}
                              {exchangeableOldItems.map((item: any) => (
                                <option value={String(Number(item.id || 0))} key={`exchange-old-${item.id}`}>
                                  {item.productName} · {[item.gender, item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'без характеристик'} · доступно {item.operationAvailableQuantity} шт.
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Кол-во</span>
                            <FriendlyNumberInput
                              type="number"
                              min="1"
                              max={effectiveOldAvailableQuantity}
                              value={Math.min(effectiveOldAvailableQuantity || 1, Math.max(1, Number(exchangeDraft.oldQuantity || 1)))}
                              onChange={(event) => setExchangeDraft((current) => ({
                                ...current,
                                oldQuantity: Math.min(effectiveOldAvailableQuantity, Math.max(1, Number(event.target.value || 1))),
                              }))}
                            />
                            <small className="field-hint">Доступно сейчас: {effectiveOldAvailableQuantity} шт.</small>
                          </label>
                          <label>
                            <span>Старая вещь сейчас</span>
                            <select
                              value={exchangeDraft.oldPhysicalState}
                              onChange={(event) => {
                                const oldPhysicalState = event.target.value as 'pending' | 'warehouse' | 'boutique' | 'no_stock'
                                setExchangeDraft((current) => ({
                                  ...current,
                                  oldPhysicalState,
                                  oldReturnSource: oldPhysicalState === 'warehouse' || oldPhysicalState === 'boutique' ? oldPhysicalState : 'none',
                                }))
                              }}
                            >
                              <option value="pending">Ещё не пришла</option>
                              <option value="warehouse">Пришла → Склад</option>
                              <option value="boutique">Пришла → Бутик</option>
                              <option value="no_stock">Пришла, в остаток не добавлять</option>
                            </select>
                            {effectiveOldItemIsWorkshop ? <small className="field-hint">Для вещи из Цеха по умолчанию остаток не создаётся. Если вещь физически принимают в остатки, явно выберите «Склад» или «Бутик»; если она ещё едет — «Ещё не пришла».</small> : null}
                          </label>
                          <label>
                            <span>Дата обмена</span>
                            <input type="date" value={exchangeDraft.exchangeDate} onChange={(event) => setExchangeDraft((current) => ({ ...current, exchangeDate: event.target.value }))} />
                          </label>
                        </div>
                      </div>
    
                      <div className="mini-item order-payment-card">
                        <div className="mini-item-head"><strong>Новая позиция</strong></div>
                        <div className="subgrid order-item-grid">
                          <label className="wide-field">
                            <span>Товар</span>
                            <SmartPickerInput
                              value={exchangeDraft.newItem.productName}
                              options={suggestionValues.products}
                              placeholder="Название товара"
                              onChange={(value) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { productName: value }) }))}
                              onPick={applyExchangeProductPick}
                            />
                          </label>
                          <label>
                            <span>Источник новой позиции</span>
                            <select value={exchangeDraft.newItem.sourceType || 'warehouse'} onChange={(event) => setExchangeDraft((current) => ({ ...current, newSourceWasManuallyChanged: true, newItem: resetObservedStock(current.newItem, { sourceType: event.target.value as EditorItem['sourceType'] }) }))}>
                              <option value="warehouse">Склад</option>
                              <option value="boutique">Бутик</option>
                              <option value="workshop">Цех</option>
                            </select>
                            <small className="field-hint">По умолчанию источник новой позиции совпадает с выбранной старой позицией. При необходимости его можно изменить вручную.</small>
                          </label>
                          <label>
                            <span>Тип</span>
                            <select value={exchangeDraft.newItem.audienceType || 'ВЗРОСЛЫЙ'} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { audienceType: event.target.value as EditorItem['audienceType'] }) }))}>
                              <option value="ВЗРОСЛЫЙ">Взрослый</option>
                              <option value="ДЕТСКИЙ">Детский</option>
                            </select>
                          </label>
                          <label><span>Пол</span><select value={exchangeDraft.newItem.gender || ''} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { gender: event.target.value }) }))}><option value="">Выберите для унисекс</option><option value="ЖЕН">ЖЕН</option><option value="МУЖ">МУЖ</option></select></label>
                          <label><span>Цвет</span><SmartPickerInput value={exchangeDraft.newItem.color || ''} options={suggestionValues.colors} onChange={(value) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { color: value }) }))} /></label>
                          <label><span>Материал</span><SmartPickerInput value={exchangeDraft.newItem.material || ''} options={suggestionValues.materials} onChange={(value) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { material: value }) }))} /></label>
                          <label><span>Длина</span><SmartPickerInput value={exchangeDraft.newItem.length || ''} options={suggestionValues.lengths} onChange={(value) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { length: value }) }))} /></label>
                          <label><span>{exchangeDraft.newItem.audienceType === 'ДЕТСКИЙ' ? 'Возраст' : 'Размер'}</span><SmartPickerInput value={exchangeDraft.newItem.size || ''} options={exchangeDraft.newItem.audienceType === 'ДЕТСКИЙ' ? suggestionValues.childAges : suggestionValues.sizes} onChange={(value) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { size: value }) }))} /></label>
                          <label><span>Кол-во</span><FriendlyNumberInput type="number" min="1" value={exchangeDraft.newItem.quantity || 1} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { quantity: Math.max(1, Number(event.target.value || 1)) }) }))} /></label>
                          {exchangeAvailability ? (
                            <div className={`wide-field order-source-availability is-${exchangeAvailability.tone}${'needsAttention' in exchangeAvailability && exchangeAvailability.needsAttention ? ' needs-attention' : ''}`}>
                              <div className="order-source-availability-body">
                                {exchangeAvailability.canObservePhysical ? (
                                  <>
                                    <p><strong>{exchangePhysicalShortage ? `По учёту физически не хватает ${exchangeRequired - exchangePhysical} шт.` : `На месте ${exchangePhysical} шт.`}</strong></p>
                                    <p className="field-hint">
                                      {exchangePhysicalShortage
                                        ? `Для немедленной выдачи нужно ${exchangeRequired} шт. Если товар перед вами, не нужно отменять обмен — просто подтвердите фактическое количество ниже.`
                                        : exchangeFreeAfterIssue < 0
                                          ? `Физически товар есть. Уже в заказах ${exchangeReserved} шт.; после этой выдачи свободный запас станет отрицательным на ${Math.abs(exchangeFreeAfterIssue)} шт. Обмен не блокируется, но система сохранит нехватку для существующих резервов.`
                                          : `Уже в заказах ${exchangeReserved} шт. После выдачи обмена свободно останется ${exchangeFreeAfterIssue} шт.`}
                                    </p>
                                  </>
                                ) : (
                                  <p><strong>{exchangeAvailability.label}</strong> · {exchangeAvailability.note}</p>
                                )}
                                {exchangeAvailability.canObservePhysical ? (
                                  <div className={`order-stock-observation${exchangeObservationEnabled ? ' is-open' : ''}`}>
                                    {!exchangeObservationEnabled ? (
                                      <button
                                        type="button"
                                        className={exchangePhysicalShortage ? 'primary compact' : 'secondary compact'}
                                        onClick={() => setExchangeDraft((current) => ({ ...current, newItem: { ...current.newItem, stockObservationEnabled: true, observedPhysicalQuantity: null } }))}
                                      >
                                        {exchangePhysicalShortage ? 'Товар есть — уточнить фактический остаток' : 'Уточнить фактическое количество'}
                                      </button>
                                    ) : (
                                      <>
                                        <div className="order-stock-observation-head">
                                          <div>
                                            <strong>Сколько сейчас физически на месте?</strong>
                                            <span>Считайте всё в выбранной точке. Это исправит «На месте» перед резервом и выдачей обмена; старые резервы не переписываются.</span>
                                          </div>
                                          <button type="button" className="ghost compact" onClick={() => setExchangeDraft((current) => ({ ...current, newItem: { ...current.newItem, stockObservationEnabled: false, observedPhysicalQuantity: null } }))}>Не уточнять</button>
                                        </div>
                                        <div className="order-stock-observation-row">
                                          <label>
                                            <span>На месте сейчас</span>
                                            <input
                                              type="number"
                                              min="0"
                                              step="1"
                                              inputMode="numeric"
                                              value={exchangeObservedPhysical ?? ''}
                                              onChange={(event) => {
                                                const raw = event.target.value
                                                setExchangeDraft((current) => ({ ...current, newItem: { ...current.newItem, observedPhysicalQuantity: raw === '' ? null : Math.max(0, Math.trunc(Number(raw) || 0)) } }))
                                              }}
                                              placeholder="Например: 3"
                                            />
                                          </label>
                                          <div className="order-stock-observation-result">
                                            <span>Для обмена сейчас нужно: <strong>{exchangeRequired}</strong></span>
                                            {exchangeObservedPhysical === null || exchangeObservedPhysical === undefined
                                              ? <span>Введите количество, которое видите физически.</span>
                                              : Number(exchangeObservedPhysical) < exchangeRequired
                                                ? <strong className="is-shortage">Для выдачи не хватает {exchangeRequired - Number(exchangeObservedPhysical)} шт.</strong>
                                                : <strong>После выдачи физически останется минимум {Number(exchangeObservedPhysical) - exchangeRequired} шт.</strong>}
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          {exchangeDraft.newItem.sourceType === 'workshop' ? (
                            <>
                              <label className="wide-field"><span>Комментарий цеху</span><input value={exchangeDraft.newItem.workshopComment || ''} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: { ...current.newItem, workshopComment: event.target.value } }))} /></label>
                              <label className="workshop-urgent-editor"><input type="checkbox" checked={Boolean(exchangeDraft.newItem.workshopUrgent)} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: { ...current.newItem, workshopUrgent: event.target.checked } }))} /> Срочно для цеха</label>
                              <label><span>Нужно до</span><input type="date" value={exchangeDraft.newItem.workshopDueDate || ''} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: { ...current.newItem, workshopDueDate: event.target.value } }))} /></label>
                            </>
                          ) : null}
                          <div className="wide-field editor-summary debt-target-summary">
                            <div className="editor-summary-head">
                              <div>
                                <strong>Финансы обмена</strong>
                                <span>Цену отдельных товаров убрали. Если по обмену есть доплата или возврат средств, выберите действие и сумму вручную.</span>
                              </div>
                            </div>
                            <div className="subgrid order-payment-grid">
                              <label>
                                <span>Действие</span>
                                <select value={exchangeDraft.financialAction} onChange={(event) => setExchangeDraft((current) => ({ ...current, financialAction: event.target.value as ExchangeDraft['financialAction'] }))}>
                                  <option value="none">Без доплаты/возврата</option>
                                  <option value="extra_payment">Клиент доплачивает</option>
                                  <option value="refund">Вернуть клиенту</option>
                                </select>
                              </label>
                              <label>
                                <span>Сумма</span>
                                <FriendlyNumberInput type="number" min="0" value={exchangeDraft.financialAmount} onChange={(event) => setExchangeDraft((current) => ({ ...current, financialAmount: Math.max(0, Number(event.target.value || 0)) }))} />
                              </label>
                              {exchangeDraft.financialAction !== 'none' ? (
                                <label>
                                  <span>{exchangeDraft.financialAction === 'refund' ? 'Способ возврата денег' : 'Способ оплаты'}</span>
                                  <SmartPickerInput value={exchangeDraft.paymentMethod} options={suggestionValues.paymentMethods} placeholder={exchangeDraft.financialAction === 'refund' ? 'Например, НАЛИЧКА' : 'Например, KASPI'} onChange={(value) => setExchangeDraft((current) => ({ ...current, paymentMethod: value }))} />
                                </label>
                              ) : null}
                            </div>
                          </div>
                          <label className="wide-field"><span>Комментарий обмена</span><input value={exchangeDraft.comment} onChange={(event) => setExchangeDraft((current) => ({ ...current, comment: event.target.value }))} /></label>
                        </div>
                      </div>
                    </div>
    
                    <div className="actions order-create-actions form-bottom-actions">
                      <button className="secondary" type="button" onClick={queueCurrentExchangePair} disabled={exchangeBusy || !currentPairReady || (exchangePhysicalShortage && !exchangeObservationEnabled)}>
                        Добавить ещё позицию
                      </button>
                      <button className="primary" type="button" onClick={() => void saveExchange()} disabled={exchangeBusy || (!queuedPairs.length && !currentPairReady)}>
                        {exchangeBusy ? 'Сохраняю...' : `Оформить обмен${queuedPairs.length ? ` (${queuedPairs.length + (currentPairReady ? 1 : 0)} поз.)` : ''}`}
                      </button>
                      <button className="secondary back-action" type="button" onClick={() => closeExchangeForm(true)} disabled={exchangeBusy}>
                        Назад к таблице
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state debt-empty-state">Выберите заказ через кнопку «Обмен» в главной таблице заказов или в цехе.</div>
                )}
              </section>
    
              <section className="mini-panel debt-history-panel history-cards-panel">
                <div className="mini-panel-head history-section-head">
                  <div><h3>История обменов</h3><p className="mini-panel-note">Старая и новая вещь показаны одной операцией. Если загрузка не удалась, система покажет ошибку вместо пустой таблицы.</p></div>
                  <button className="secondary compact" type="button" onClick={() => void loadExchangeHistory()} disabled={exchangeHistoryBusy}>Обновить</button>
                </div>

                <div className="history-filter-bar">
                  <label className="history-search-field"><span>Поиск</span><input value={exchangeHistoryFilters.q} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, q: event.target.value }))} placeholder="Заказ, клиент, товар, комментарий" /></label>
                  <label><span>С</span><input type="date" value={exchangeHistoryFilters.dateFrom} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, dateFrom: event.target.value }))} /></label>
                  <label><span>По</span><input type="date" value={exchangeHistoryFilters.dateTo} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, dateTo: event.target.value }))} /></label>
                  <label><span>Статус</span><select value={exchangeHistoryFilters.status} onChange={(event) => setExchangeHistoryFilters((current: any) => ({ ...current, status: event.target.value }))}><option value="all">Все</option><option value="completed">Проведённые</option><option value="cancelled">Отменённые</option></select></label>
                  <button className="primary compact history-filter-submit" type="button" disabled={exchangeHistoryBusy} onClick={() => void loadExchangeHistory({ filters: exchangeHistoryFilters })}>Показать</button>
                </div>
                <div className="history-summary-line"><span><strong>{exchangeHistorySummary.count}</strong> операций</span><span>Проведено: <strong>{exchangeHistorySummary.activeCount}</strong></span><span>Ожидают приёмки: <strong>{exchangeHistorySummary.pendingPhysicalQuantity} шт.</strong></span>{exchangeHistorySummary.cancelledCount ? <span>Отменено: <strong>{exchangeHistorySummary.cancelledCount}</strong></span> : null}</div>

                {Number(exchangeHistorySummary.pendingPhysicalQuantity || 0) > 0 ? (
                  <div className="history-load-state is-warning">
                    <strong>Ожидают приёмки: {exchangeHistorySummary.pendingPhysicalQuantity} шт.</strong>
                    <span>Когда старая вещь приехала, откройте обмен ниже и нажмите «Принять товар». Если запись мусорная или неполная, уточнение товара откроется сразу.</span>
                  </div>
                ) : null}

                {exchangeHistoryError ? (
                  <div className="history-load-state is-error"><strong>Не удалось загрузить историю обменов.</strong><span>{exchangeHistoryError}</span><button className="secondary compact" type="button" onClick={() => void loadExchangeHistory()}>Повторить</button></div>
                ) : exchangeHistoryBusy && !exchangeHistory.length ? (
                  <div className="history-load-state"><strong>Загружаю историю обменов…</strong></div>
                ) : exchangeHistory.length ? (
                  <div className="history-card-list">
                    {exchangeHistory.map((entry) => (
                      <details className={`history-card ${entry.status === 'cancelled' ? 'is-cancelled' : ''}`} key={`exchange-history-${entry.id}`}>
                        <summary>
                          <div className="history-card-date"><strong>{entry.exchangeDate || '—'}</strong><span>Обмен №{entry.id}</span></div>
                          <div className="history-card-main"><strong>{entry.externalId}</strong><span>{entry.customer || '—'} · Менеджер: {entry.manager || '—'}</span></div>
                          <div className="history-card-swap"><strong>{entry.oldProductName}</strong><span>→</span><strong>{entry.newProductName}</strong></div>
                          <span className={`status-pill ${entry.status === 'cancelled' ? 'status-offline' : 'status-online'}`}>{entry.status === 'cancelled' ? 'Отменён' : 'Проведён'}</span>
                          <span className="history-card-open">Подробнее</span>
                        </summary>
                        <div className="history-card-body">
                          <div className="history-exchange-pair">
                            <div className="history-product-card">
                              <span>Вернули</span><strong>{entry.oldProductName} × {entry.oldQuantity}</strong><em>{formatHistoryCharacteristics(entry, 'old')}</em><b>{oldReturnLabel(entry)}</b>
                              {entry.status !== 'cancelled' && entry.oldPhysicalTracking && !entry.oldPhysicalReceivedAt && entry.oldOperationItemId ? (
                                <div className="mini-panel-actions">
                                  <select
                                    value={receiptDestinations[`exchange:${entry.id}:${entry.oldOperationItemId}`] || 'warehouse'}
                                    onChange={(event) => setReceiptDestinations((current) => ({ ...current, [`exchange:${entry.id}:${entry.oldOperationItemId}`]: event.target.value as 'warehouse' | 'boutique' | 'no_stock' }))}
                                    disabled={exchangeBusy}
                                  >
                                    <option value="warehouse">Склад</option>
                                    <option value="boutique">Бутик</option>
                                    <option value="no_stock">Без добавления в остаток</option>
                                  </select>
                                  <button
                                    className="primary compact"
                                    type="button"
                                    disabled={exchangeBusy}
                                    onClick={() => void receiveReturnedItemAction({
                                      operationType: 'exchange',
                                      operationId: entry.id,
                                      operationItemId: entry.oldOperationItemId,
                                      destination: receiptDestinations[`exchange:${entry.id}:${entry.oldOperationItemId}`] || 'warehouse',
                                      productName: entry.oldProductName,
                                      externalId: entry.externalId,
                                    })}
                                  >
                                    Товар пришёл
                                  </button>
                                </div>
                              ) : null}
                              {entry.status !== 'cancelled' && entry.oldOperationItemId && oldKnownIntakePending(entry) ? (
                                <div className="mini-panel-actions">
                                  <button
                                    className="primary compact"
                                    type="button"
                                    disabled={exchangeBusy || exchangeHistoryBusy}
                                    onClick={() => void finishKnownExchangeIntake(entry)}
                                  >
                                    Завершить приёмку
                                  </button>
                                </div>
                              ) : null}
                              {entry.status !== 'cancelled' && entry.oldOperationItemId && oldReceiptNeedsRecovery(entry) ? (
                                <div className="mini-panel-actions">
                                  <button
                                    className="primary compact"
                                    type="button"
                                    disabled={exchangeBusy}
                                    onClick={() => void receiveReturnedItemAction({
                                      operationType: 'exchange',
                                      operationId: entry.id,
                                      operationItemId: entry.oldOperationItemId,
                                      destination: entry.oldReturnSource as 'warehouse' | 'boutique',
                                      productName: entry.oldProductName,
                                      externalId: entry.externalId,
                                    })}
                                  >
                                    Завершить учёт
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            <div className="history-exchange-arrow">→</div>
                            <div className="history-product-card"><span>Выдали</span><strong>{entry.newProductName} × {entry.newQuantity}</strong><em>{formatHistoryCharacteristics(entry, 'new')}</em><b>{newIssueLabel(entry.newSourceType, entry.newLifecycleStatus)}</b></div>
                          </div>
                          <div className="history-detail-grid">
                            <div><span>Менеджер</span><ManagerBadge name={entry.manager || '—'} colorKey={entry.managerColor || managerColorFor(entry.manager)} compact /></div>
                            <div><span>Деньги</span><strong>{entry.financialAction === 'extra_payment' ? `Доплата ${formatMoney(entry.financialAmount)}` : entry.financialAction === 'refund' ? `Возврат ${formatMoney(entry.financialAmount)}` : 'Без доплаты / возврата'}</strong></div>
                            {entry.financialAction !== 'none' ? <div><span>Способ</span><strong>{entry.paymentMethod || '—'}</strong></div> : null}
                            <div><span>Заказ от</span><strong>{entry.orderDate || '—'}</strong></div>
                          </div>
                          {entry.comment ? <div className="history-note"><span>Комментарий обмена</span><strong>{entry.comment}</strong></div> : null}
                          {entry.cancellationComment ? <div className="history-note is-danger"><span>Причина отмены</span><strong>{entry.cancellationComment}</strong></div> : null}
                          {financialCorrection?.exchangeId === entry.id ? (
                            <div className="mini-panel" style={{ marginTop: 12 }}>
                              <div className="mini-panel-head">
                                <div>
                                  <h4>Исправить денежную часть</h4>
                                  <p className="mini-panel-note">Меняются только дата, сумма, способ и комментарий. Товары, остатки и Цех не затрагиваются. Тип операции ({entry.financialAction === 'refund' ? 'возврат' : 'доплата'}) здесь не меняется.</p>
                                </div>
                              </div>
                              <div className="form-grid compact-form-grid">
                                <label><span>Дата</span><input type="date" value={financialCorrection.exchangeDate} onChange={(event) => setFinancialCorrection((current: any) => ({ ...current, exchangeDate: event.target.value }))} /></label>
                                <label><span>Сумма</span><FriendlyNumberInput type="number" min="1" value={financialCorrection.financialAmount} onChange={(event) => setFinancialCorrection((current: any) => ({ ...current, financialAmount: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                                <label><span>{entry.financialAction === 'refund' ? 'Способ возврата' : 'Способ оплаты'}</span><SmartPickerInput value={financialCorrection.paymentMethod} options={suggestionValues.paymentMethods} placeholder={entry.financialAction === 'refund' ? 'Например, НАЛИЧКА' : 'Например, KASPI'} onChange={(value: string) => setFinancialCorrection((current: any) => ({ ...current, paymentMethod: value }))} /></label>
                                <label className="wide"><span>Комментарий</span><input value={financialCorrection.comment} onChange={(event) => setFinancialCorrection((current: any) => ({ ...current, comment: event.target.value }))} /></label>
                              </div>
                              <div className="row-actions">
                                <button className="primary compact" type="button" disabled={exchangeBusy} onClick={async () => { if (await correctExchangeFinancialEntry(entry, financialCorrection)) setFinancialCorrection(null) }}>{exchangeBusy ? 'Сохраняю…' : 'Сохранить исправление'}</button>
                                <button className="secondary compact" type="button" disabled={exchangeBusy} onClick={() => setFinancialCorrection(null)}>Отмена</button>
                              </div>
                            </div>
                          ) : null}
                          <div className="history-card-actions">{entry.status !== 'cancelled' && entry.financialAction !== 'none' ? <button className="secondary compact" type="button" onClick={() => openFinancialCorrection(entry)} disabled={exchangeBusy}>Исправить деньги</button> : null}{entry.status !== 'cancelled' ? <button className="ghost danger compact" type="button" onClick={() => void cancelExchangeEntry(entry)} disabled={exchangeBusy}>Отменить обмен</button> : null}</div>
                        </div>
                      </details>
                    ))}
                    {exchangeHistoryHasMore ? <button className="secondary history-load-more" type="button" disabled={exchangeHistoryBusy} onClick={() => void loadExchangeHistory({ append: true })}>{exchangeHistoryBusy ? 'Загружаю…' : 'Показать ещё'}</button> : null}
                  </div>
                ) : (
                  <div className="history-load-state"><strong>Обменов по выбранным условиям нет.</strong><span>Это нормальный пустой результат, а не ошибка загрузки.</span></div>
                )}
              </section>
            </article>
  )
}
