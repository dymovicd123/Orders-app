// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
type SectionContext = Record<string, any>

export function OrderExchangeSection({ ctx }: { ctx: SectionContext }) {
  const {
    applyExchangeProductPick,
    cancelExchangeEntry,
    closeExchangeForm,
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
    isAdmin,
    loadExchangeHistory,
    ManagerBadge,
    managerColorFor,
    orderPanelStyle,
    saveExchange,
    sectorStyle,
    setExchangeDraft,
    setExchangeHistoryFilters,
    setOrderPanel,
    SmartPickerInput,
    sourceLabel,
    suggestionValues,
  } = ctx

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

  const oldReturnLabel = (source: string, lifecycleStatus?: string | null) => {
    if (source !== 'warehouse' && source !== 'boutique') return 'Не возвращён в остатки'
    const destination = source === 'warehouse' ? 'склад' : 'бутик'
    if (lifecycleStatus === 'pending') return `Ожидает приёма: ${destination}`
    if (lifecycleStatus === 'cancelled') return 'Приём старой вещи отменён'
    return `Возвращён: ${destination}`
  }

  const newIssueLabel = (source: string, lifecycleStatus?: string | null) => {
    if (source === 'workshop') return 'Новая вещь: Цех'
    const origin = source === 'boutique' ? 'бутик' : 'склад'
    if (lifecycleStatus === 'pending') return `Ожидает выдачи: ${origin}`
    if (lifecycleStatus === 'cancelled') return 'Физическая выдача отменена'
    if (lifecycleStatus === 'applied') return `Выдано: ${origin}`
    return `Источник: ${sourceLabel(source as OrderRecord['source_type'])}`
  }

  const exchangeableOldItems = (exchangeSelectedOrder?.items || [])
    .filter((item: any) => Number(item.id || 0) > 0 && Number(item.quantity || 0) > 0)
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

  return (
    <article className="card wide sector-orders" id="order-exchange" style={{ ...sectorStyle('orders'), ...orderPanelStyle('exchange') }}>
              <div className="card-label">Обмен товара</div>
              <div className="card-meta">Обмен открывается из главной таблицы заказов или из активного цеха. По умолчанию старая вещь не возвращается на склад — менеджер выбирает это вручную.</div>
    
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
                                  oldReturnSource: selectedItem?.sourceType === 'workshop' && current.oldReturnSource === 'boutique' ? 'none' : current.oldReturnSource,
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
                                  {item.productName} · {[item.gender, item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'без характеристик'} × {item.quantity}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Кол-во</span>
                            <FriendlyNumberInput
                              type="number"
                              min="1"
                              value={exchangeDraft.oldQuantity}
                              onChange={(event) => setExchangeDraft((current) => ({ ...current, oldQuantity: Math.max(1, Number(event.target.value || 1)) }))}
                            />
                          </label>
                          <label>
                            <span>Куда вернуть старую вещь</span>
                            <select
                              value={exchangeDraft.oldReturnSource}
                              onChange={(event) => setExchangeDraft((current) => ({ ...current, oldReturnSource: event.target.value as ExchangeDraft['oldReturnSource'] }))}
                            >
                              <option value="warehouse">Склад</option>
                              {!effectiveOldItemIsWorkshop ? <option value="boutique">Бутик</option> : null}
                              <option value="none">Не возвращать в остатки</option>
                            </select>
                            {effectiveOldItemIsWorkshop ? <small className="field-hint">Вещь из Цеха не попадает в остатки автоматически. Выберите Склад только если возвращённую клиентом вещь действительно решили оставить на Складе.</small> : null}
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
                          <label><span>Пол</span><input value={exchangeDraft.newItem.gender || ''} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { gender: event.target.value }) }))} /></label>
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
                      <button className="primary" type="button" onClick={() => void saveExchange()} disabled={exchangeBusy}>
                        {exchangeBusy ? 'Сохраняю...' : 'Оформить обмен'}
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
                <div className="history-summary-line"><span><strong>{exchangeHistorySummary.count}</strong> операций</span><span>Проведено: <strong>{exchangeHistorySummary.activeCount}</strong></span>{exchangeHistorySummary.cancelledCount ? <span>Отменено: <strong>{exchangeHistorySummary.cancelledCount}</strong></span> : null}</div>

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
                            <div className="history-product-card"><span>Вернули</span><strong>{entry.oldProductName} × {entry.oldQuantity}</strong><em>{formatHistoryCharacteristics(entry, 'old')}</em><b>{oldReturnLabel(entry.oldReturnSource, entry.oldLifecycleStatus)}</b></div>
                            <div className="history-exchange-arrow">→</div>
                            <div className="history-product-card"><span>Выдали</span><strong>{entry.newProductName} × {entry.newQuantity}</strong><em>{formatHistoryCharacteristics(entry, 'new')}</em><b>{newIssueLabel(entry.newSourceType, entry.newLifecycleStatus)}</b></div>
                          </div>
                          <div className="history-detail-grid">
                            <div><span>Менеджер</span><ManagerBadge name={entry.manager || '—'} colorKey={entry.managerColor || managerColorFor(entry.manager)} compact /></div>
                            <div><span>Деньги</span><strong>{entry.financialAction === 'extra_payment' ? `Доплата ${formatMoney(entry.financialAmount)}` : entry.financialAction === 'refund' ? `Возврат ${formatMoney(entry.financialAmount)}` : 'Без доплаты / возврата'}</strong></div>
                            <div><span>Заказ от</span><strong>{entry.orderDate || '—'}</strong></div>
                          </div>
                          {entry.comment ? <div className="history-note"><span>Комментарий обмена</span><strong>{entry.comment}</strong></div> : null}
                          {entry.cancellationComment ? <div className="history-note is-danger"><span>Причина отмены</span><strong>{entry.cancellationComment}</strong></div> : null}
                          <div className="history-card-actions">{entry.status !== 'cancelled' && isAdmin ? <button className="ghost danger compact" type="button" onClick={() => void cancelExchangeEntry(entry)} disabled={exchangeBusy}>Отменить обмен</button> : null}</div>
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
