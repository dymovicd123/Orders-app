// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
import '../../styles/194-return-smart-ux.css'
type SectionContext = Record<string, any>

export function OrderReturnsSection({ ctx }: { ctx: SectionContext }) {
  const {
    cancelReturnEntry,
    closeReturnForm,
    createReturnDraft,
    formatMoney,
    FriendlyNumberInput,
    handleEditOrder,
    ManagerBadge,
    managerColorFor,
    orderPanelStyle,
    returnBusy,
    returnDraft,
    returnFormRef,
    returnHistory,
    returnHistoryBusy,
    returnHistoryError,
    returnHistoryFilters,
    returnHistoryHasMore,
    returnHistorySummary,
    loadReturnHistory,
    returnSelectedOrder,
    receiveReturnedItemAction,
    reconcileKnownInventoryLifecycle,
    saveReturn,
    sectorStyle,
    setOrderPanel,
    setReturnDraft,
    setReturnHistoryFilters,
    SmartPickerInput,
    suggestionValues,
  } = ctx

  const formatReturnItemCharacteristics = (item: any) => {
    const fields = [
      ['Пол', item.gender],
      ['Цвет', item.color],
      ['Материал', item.material],
      ['Длина', item.length],
      ['Размер/возраст', item.size],
    ]
      .filter(([, value]) => String(value || '').trim())
      .map(([label, value]) => `${label}: ${String(value).trim()}`)

    return fields.length ? fields.join(' · ') : 'Характеристики не указаны'
  }

  const inventorySourceLabel = (source: string) => source === 'warehouse'
    ? 'Склад'
    : source === 'boutique'
      ? 'Бутик'
      : 'Без возврата в остатки'

  const [receiptDestinations, setReceiptDestinations] = useState<Record<string, 'warehouse' | 'boutique' | 'no_stock'>>({})
  const returnReceiptNeedsRecovery = (item: any) => Boolean(
    item.physicalTracking
    && item.physicalReceivedAt
    && (item.inventorySource === 'warehouse' || item.inventorySource === 'boutique')
    && !item.lifecycleStatus
  )
  const returnKnownIntakePending = (item: any) => Boolean(
    item.physicalTracking
    && item.physicalReceivedAt
    && item.lifecycleId
    && (item.lifecycleVariantId || item.currentVariantId)
    && item.lifecycleStatus === 'pending'
    && (item.inventorySource === 'warehouse' || item.inventorySource === 'boutique')
  )
  const finishKnownReturnIntake = async (item: any) => {
    const result = await reconcileKnownInventoryLifecycle(Number(item.lifecycleId || 0))
    if (result?.ok) await loadReturnHistory()
  }
  const returnPhysicalStatus = (item: any) => {
    if (!item.physicalTracking) return 'Старая запись — физическое получение не отслеживалось'
    if (!item.physicalReceivedAt) return 'Ожидает приёмки'
    if (!item.inventorySource) return 'Получен, в остаток не добавляли'
    const destination = inventorySourceLabel(item.inventorySource)
    if (!item.lifecycleStatus) return `Получен → ${destination}; складской учёт не завершён`
    if (item.lifecycleStatus === 'pending') return `Получен → ${destination}; остаток требует уточнения`
    if (item.lifecycleStatus === 'cancelled') return `Получен; проведение в ${destination} отменено`
    if (item.lifecycleStatus === 'applied') return `Получен → ${destination}`
    return `Получен → ${destination}; статус учёта: ${item.lifecycleStatus}`
  }
  const pendingReturnIntake = returnHistory.flatMap((entry: any) => (
    entry.operationType === 'order_return' && entry.status !== 'cancelled'
      ? (entry.items || [])
          .filter((item: any) => item.physicalTracking && !item.physicalReceivedAt)
          .map((item: any) => ({ entry, item }))
      : []
  ))
  const loadedPendingReturnQuantity = pendingReturnIntake.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.item.quantity || 0)), 0)

  const returnSourceLabel = (item: any) => item.sourceType === 'workshop'
    ? 'Цех'
    : item.sourceType === 'boutique'
      ? 'Бутик'
      : 'Склад'
  const selectedReturnLines = (returnDraft.items || []).filter((item: any) => item.issuedToClient !== false && Number(item.quantity || 0) > 0)
  const selectedReturnQuantity = selectedReturnLines.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.quantity || 0)), 0)
  const patchReturnItem = (orderItemId: number, patch: Record<string, unknown>) => setReturnDraft((current: any) => ({
    ...current,
    items: current.items.map((entry: any) => Number(entry.orderItemId || 0) === Number(orderItemId || 0)
      ? { ...entry, ...patch }
      : entry),
  }))
  const toggleReturnItem = (item: any) => {
    if (item.issuedToClient === false) return
    const selected = Number(item.quantity || 0) > 0
    patchReturnItem(item.orderItemId, { quantity: selected ? 0 : 1 })
  }
  const markReturnArrived = (item: any) => {
    const physicalState = item.sourceType === 'workshop' ? 'no_stock' : 'warehouse'
    patchReturnItem(item.orderItemId, {
      physicalState,
      restock: physicalState === 'warehouse' || physicalState === 'boutique',
    })
  }

  return (
    <article className="card wide sector-orders" id="order-returns" style={{ ...sectorStyle('orders'), ...orderPanelStyle('returns') }}>
              <div className="card-label">Возврат</div>
              <div className="card-meta">Возврат открывается из главной таблицы заказов кнопкой `Возврат`. Здесь остаётся только форма выбранного заказа и история возвратов.</div>
    
              <div className="editor-summary debt-summary-panel">
                <div className="editor-summary-grid">
                  <div>
                    <span>Открытая форма</span>
                    <strong>{returnSelectedOrder ? 1 : 0}</strong>
                  </div>
                  <div>
                    <span>Проведённых возвратов</span>
                    <strong>{returnHistorySummary.activeCount}</strong>
                  </div>
                  <div>
                    <span>На сумму</span>
                    <strong>{formatMoney(returnHistorySummary.activeAmount)}</strong>
                  </div>
                  <div>
                    <span>Отменённых</span>
                    <strong>{returnHistorySummary.cancelledCount}</strong>
                  </div>
                  <div>
                    <span>Ожидают приёмки</span>
                    <strong>{returnHistorySummary.pendingPhysicalQuantity} шт.</strong>
                  </div>
                </div>
              </div>
              {Number(returnHistorySummary.pendingPhysicalQuantity || 0) > 0 ? (
                <section className="intake-queue" aria-label="Товары, ожидающие приёмки по возвратам">
                  <div className="intake-queue-head">
                    <div>
                      <span className="intake-queue-kicker">Нужно принять</span>
                      <h3>Товары едут обратно</h3>
                      <p>Когда вещь приехала, отметьте это здесь. Искать нужный возврат в истории не нужно.</p>
                    </div>
                    <strong className="intake-queue-count">{returnHistorySummary.pendingPhysicalQuantity} шт.</strong>
                  </div>
                  {pendingReturnIntake.length ? (
                    <div className="intake-queue-list">
                      {pendingReturnIntake.map(({ entry, item }: any) => {
                        const receiptKey = `return:${entry.id}:${item.id}`
                        return (
                          <div className="intake-queue-row" key={receiptKey}>
                            <div className="intake-queue-item">
                              <div className="intake-queue-product-head">
                                <strong>{item.productName} × {item.quantity}</strong>
                                <span className="intake-queue-operation">Возврат #{entry.id}</span>
                              </div>
                              <div className="intake-queue-context">
                                <div><span>Заказ</span><strong>{entry.externalId}</strong></div>
                                <div><span>Клиент</span><strong>{entry.customer || 'Не указан'}</strong></div>
                                <div><span>Менеджер</span><strong>{entry.manager || 'Не указан'}</strong></div>
                                <div><span>Дата возврата</span><strong>{entry.returnDate || 'Не указана'}</strong></div>
                                {entry.city ? <div><span>Город</span><strong>{entry.city}</strong></div> : null}
                              </div>
                              <small className="intake-queue-characteristics">{formatReturnItemCharacteristics(item)}</small>
                            </div>
                            <label className="intake-queue-destination">
                              <span>Куда принять</span>
                              <select
                                value={receiptDestinations[receiptKey] || (item.isWorkshop ? 'no_stock' : 'warehouse')}
                                onChange={(event) => setReceiptDestinations((current) => ({ ...current, [receiptKey]: event.target.value as 'warehouse' | 'boutique' | 'no_stock' }))}
                                disabled={returnBusy}
                              >
                                <option value="warehouse">Склад</option>
                                <option value="boutique">Бутик</option>
                                <option value="no_stock">Не добавлять в остаток</option>
                              </select>
                            </label>
                            <button
                              className="primary intake-queue-action"
                              type="button"
                              disabled={returnBusy}
                              onClick={() => void receiveReturnedItemAction({
                                operationType: 'return',
                                operationId: entry.id,
                                operationItemId: item.id,
                                destination: receiptDestinations[receiptKey] || (item.isWorkshop ? 'no_stock' : 'warehouse'),
                                productName: item.productName,
                                externalId: entry.externalId,
                              })}
                            >
                              Принять товар
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="intake-queue-missing">
                      <span>Счётчик показывает ожидающие вещи, но они не попали в загруженные последние операции.</span>
                      <button className="secondary compact" type="button" disabled={returnHistoryBusy} onClick={() => void loadReturnHistory({ append: true })}>Загрузить ещё</button>
                    </div>
                  )}
                  {returnHistoryHasMore && loadedPendingReturnQuantity < Number(returnHistorySummary.pendingPhysicalQuantity || 0) ? (
                    <button className="secondary compact intake-queue-more" type="button" disabled={returnHistoryBusy} onClick={() => void loadReturnHistory({ append: true })}>Показать ещё ожидающие</button>
                  ) : null}
                </section>
              ) : null}
    
              {!returnSelectedOrder ? (
                <section className="mini-panel debt-table-panel">
                  <div className="mini-panel-head">
                    <div>
                      <h3>Откройте возврат из таблицы заказов</h3>
                      <p className="mini-panel-note">Чтобы оформить возврат, вернитесь в главную таблицу и нажмите кнопку `Возврат` у нужного заказа.</p>
                    </div>
                    <button className="secondary compact back-action" type="button" onClick={() => setOrderPanel('list')}>
                      К заказам
                    </button>
                  </div>
                </section>
              ) : null}
    
              <section className="mini-panel debt-form-panel" ref={returnFormRef}>
                <div className="mini-panel-head">
                  <h3>Форма возврата</h3>
                  <div className="mini-panel-actions">
                    {returnSelectedOrder ? (
                      <button className="secondary compact back-action" type="button" onClick={() => closeReturnForm(true)} disabled={returnBusy}>
                        Назад
                      </button>
                    ) : null}
                    <button
                      className="secondary compact"
                      type="button"
                      onClick={() => setReturnDraft(createReturnDraft(returnSelectedOrder))}
                      disabled={!returnSelectedOrder || returnBusy}
                    >
                      Сбросить
                    </button>
                  </div>
                </div>
    
                {returnSelectedOrder ? (
                  <>
                    <div className="editor-summary debt-target-summary">
                      <div className="editor-summary-head">
                        <div>
                          <strong>{returnSelectedOrder.external_id}</strong>
                          <span>{returnSelectedOrder.order_date} · {returnSelectedOrder.manager_name || '—'} · {returnSelectedOrder.customer_name || returnSelectedOrder.customer_phone || '—'}</span>
                        </div>
                        <span className="status-pill status-warning">
                          Доступно {formatMoney(Math.max(0, Number(returnSelectedOrder.received_amount || 0) - Number(returnSelectedOrder.return_amount || 0)))}
                        </span>
                      </div>
                      <div className="editor-summary-grid">
                        <div>
                          <span>Сумма заказа</span>
                          <strong>{formatMoney(returnSelectedOrder.total_amount)}</strong>
                        </div>
                        <div>
                          <span>Получено</span>
                          <strong>{formatMoney(returnSelectedOrder.received_amount)}</strong>
                        </div>
                        <div>
                          <span>Уже возвращено</span>
                          <strong>{formatMoney(returnSelectedOrder.return_amount)}</strong>
                        </div>
                        <div>
                          <span>Новый возврат</span>
                          <strong>{formatMoney(returnDraft.amount)}</strong>
                        </div>
                      </div>
                    </div>
    
                    <div className="stack">
                      <div className="mini-item order-payment-card">
                        <div className="mini-item-head">
                          <strong>Параметры возврата</strong>
                        </div>
                        <div className="subgrid order-payment-grid">
                          <label>
                            <span>Дата возврата</span>
                            <input
                              type="date"
                              value={returnDraft.returnDate}
                              onChange={(event) => setReturnDraft((current) => ({ ...current, returnDate: event.target.value }))}
                            />
                          </label>
                          <label>
                            <span>Сумма возврата</span>
                            <FriendlyNumberInput
                              type="number"
                              min="0"
                              value={returnDraft.amount}
                              onChange={(event) => setReturnDraft((current) => ({ ...current, amount: Number(event.target.value) }))}
                            />
                            <small className="field-hint">Введите фактическую сумму возврата вручную. Система не подставляет цену товара или текущую цену Каталога автоматически.</small>
                            {returnDraft.items.some((item: any) => item.issuedToClient === false) ? <small className="field-hint">Если это отмена невыданного товара, денежный возврат сам по себе не убирает товар из заказа — сначала используйте «Изменить заказ» ниже.</small> : null}
                          </label>
                          <label>
                            <span>Способ возврата денег {Number(returnDraft.amount || 0) > 0 ? '' : '(не нужен при 0 ₸)'}</span>
                            <SmartPickerInput
                              value={returnDraft.paymentMethod}
                              options={suggestionValues.paymentMethods}
                              onChange={(value) => setReturnDraft((current) => ({ ...current, paymentMethod: value }))}
                              placeholder="Например, НАЛИЧКА"
                            />
                          </label>
                          <label className="wide-field">
                            <span>Причина / комментарий</span>
                            <SmartPickerInput
                              value={returnDraft.comment}
                              options={suggestionValues.returnReasons}
                              onChange={(value) => setReturnDraft((current) => ({ ...current, comment: value }))}
                              placeholder="Выберите причину или напишите свою"
                            />
                          </label>
                        </div>
                      </div>
    
                      <div className="mini-item order-payment-card">
                        <div className="mini-item-head">
                          <strong>Какие товары возвращаются</strong>
                          <span className="muted-small">Выбор товара фиксирует физический возврат, но не рассчитывает деньги автоматически. Выбирайте товар только если клиент действительно получал его; сумма возврата денег указывается отдельно.</span>
                        </div>
                        {returnDraft.items.some((item: any) => item.issuedToClient === false) ? (
                          <div className="history-note">
                            <span>Есть товары, которые клиенту не выдавали</span>
                            <strong>Их нельзя «вернуть на склад»: они и так физически остались у вас. Если позицию отменили до выдачи, сначала измените состав заказа. Если нужно вернуть только деньги, оставьте количество товара 0 и укажите сумму выше.</strong>
                            <div className="mini-panel-actions">
                              <button className="secondary compact" type="button" disabled={returnBusy} onClick={() => void handleEditOrder(returnSelectedOrder)}>Изменить заказ</button>
                            </div>
                          </div>
                        ) : null}
                        <div className="return-smart-grid">
                          {returnDraft.items.length ? returnDraft.items.map((item: any) => {
                            const selected = Number(item.quantity || 0) > 0
                            const arrived = item.physicalState !== 'pending'
                            const maxQuantity = Math.max(0, Number(item.maxQuantity || 0))
                            return (
                              <div
                                className={`return-smart-card ${selected ? 'is-selected' : ''} ${item.issuedToClient === false ? 'is-unissued' : ''}`}
                                key={`return-item-${item.orderItemId}`}
                              >
                                <button
                                  type="button"
                                  className="return-smart-pick"
                                  disabled={item.issuedToClient === false || returnBusy}
                                  onClick={() => toggleReturnItem(item)}
                                >
                                  <span className="return-smart-check">{selected ? '✓' : ''}</span>
                                  <span className="return-smart-main">
                                    <strong>{item.productName}</strong>
                                    <small>{returnSourceLabel(item)} · доступно {maxQuantity} шт.</small>
                                  </span>
                                  <b>{item.issuedToClient === false ? 'Не выдавали' : selected ? 'Возвращаем' : 'Выбрать'}</b>
                                </button>

                                {item.issuedToClient === false ? (
                                  <div className="return-smart-unissued">
                                    <strong>Товар остаётся у вас</strong>
                                    <span>Физического возврата нет. Если позицию отменили до выдачи, измените состав заказа.</span>
                                  </div>
                                ) : selected ? (
                                  <div className="return-smart-controls">
                                    {maxQuantity > 1 ? (
                                      <div className="return-smart-quantity">
                                        <span>Сколько возвращается</span>
                                        <div>
                                          <button
                                            type="button"
                                            aria-label="Уменьшить количество"
                                            disabled={returnBusy || Number(item.quantity || 0) <= 1}
                                            onClick={() => patchReturnItem(item.orderItemId, { quantity: Math.max(1, Number(item.quantity || 0) - 1) })}
                                          >−</button>
                                          <FriendlyNumberInput
                                            type="number"
                                            min="1"
                                            max={maxQuantity}
                                            value={item.quantity}
                                            onChange={(event) => patchReturnItem(item.orderItemId, {
                                              quantity: Math.min(maxQuantity, Math.max(1, Number(event.target.value || 1))),
                                            })}
                                          />
                                          <button
                                            type="button"
                                            aria-label="Увеличить количество"
                                            disabled={returnBusy || Number(item.quantity || 0) >= maxQuantity}
                                            onClick={() => patchReturnItem(item.orderItemId, {
                                              quantity: Math.min(maxQuantity, Number(item.quantity || 0) + 1),
                                            })}
                                          >+</button>
                                          <button
                                            type="button"
                                            className="return-smart-all"
                                            disabled={returnBusy || Number(item.quantity || 0) === maxQuantity}
                                            onClick={() => patchReturnItem(item.orderItemId, { quantity: maxQuantity })}
                                          >Все {maxQuantity}</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="return-smart-one-unit">Возвращается 1 шт.</div>
                                    )}

                                    <div className="return-smart-physical">
                                      <span>Где товар сейчас?</span>
                                      <div className="return-smart-choice-row">
                                        <button
                                          type="button"
                                          className={!arrived ? 'is-active' : ''}
                                          disabled={returnBusy}
                                          onClick={() => patchReturnItem(item.orderItemId, { physicalState: 'pending', restock: false })}
                                        >
                                          Ещё едет обратно
                                        </button>
                                        <button
                                          type="button"
                                          className={arrived ? 'is-active' : ''}
                                          disabled={returnBusy}
                                          onClick={() => markReturnArrived(item)}
                                        >
                                          Уже вернули
                                        </button>
                                      </div>
                                      {!arrived ? (
                                        <small>После оформления позиция появится сверху в очереди «Нужно принять».</small>
                                      ) : (
                                        <label>
                                          <span>Куда принять</span>
                                          <select
                                            value={item.physicalState}
                                            disabled={returnBusy}
                                            onChange={(event) => {
                                              const physicalState = event.target.value as 'warehouse' | 'boutique' | 'no_stock'
                                              patchReturnItem(item.orderItemId, {
                                                physicalState,
                                                restock: physicalState === 'warehouse' || physicalState === 'boutique',
                                              })
                                            }}
                                          >
                                            <option value="warehouse">Склад</option>
                                            <option value="boutique">Бутик</option>
                                            <option value="no_stock">Не добавлять в остаток</option>
                                          </select>
                                          {item.sourceType === 'workshop'
                                            ? <small>Для вещи из Цеха по умолчанию остаток не создаётся. Если товар физически принимают в остатки, явно выберите «Склад» или «Бутик».</small>
                                            : null}
                                        </label>
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            )
                          }) : (
                            <div className="return-smart-empty">У заказа нет позиций, доступных для возврата.</div>
                          )}
                        </div>

                        <div className="return-smart-summary">
                          <div>
                            <span>Выбрано товаров</span>
                            <strong>{selectedReturnLines.length} поз. · {selectedReturnQuantity} шт.</strong>
                          </div>
                          <p>Товары и деньги учитываются отдельно: сумма возврата выше должна совпадать с фактической договорённостью с клиентом.</p>
                        </div>
                      </div>
                    </div>
    
                    <div className="actions order-create-actions form-bottom-actions">
                      <button className="primary" type="button" onClick={() => void saveReturn()} disabled={returnBusy}>
                        {returnBusy ? 'Сохраняю...' : 'Оформить возврат'}
                      </button>
                      <button className="secondary back-action" type="button" onClick={() => closeReturnForm()} disabled={returnBusy}>
                        Назад к таблице
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state debt-empty-state">
                    Нажмите кнопку `Возврат` у нужного заказа в главной таблице. После сохранения форма автоматически закроется.
                  </div>
                )}
              </section>
    
              <section className="mini-panel debt-history-panel history-cards-panel">
                <div className="mini-panel-head history-section-head">
                  <div>
                    <h3>История возвратов</h3>
                    <p className="mini-panel-note">Последние возвраты загружаются сами. Поиск работает по всей истории, а подробности открываются только у нужной операции.</p>
                  </div>
                  <button className="secondary compact" type="button" onClick={() => void loadReturnHistory()} disabled={returnHistoryBusy}>Обновить</button>
                </div>

                <div className="history-filter-bar">
                  <label className="history-search-field"><span>Поиск</span><input value={returnHistoryFilters.q} onChange={(event) => setReturnHistoryFilters((current: any) => ({ ...current, q: event.target.value }))} placeholder="Заказ, клиент, товар, комментарий" /></label>
                  <label><span>С</span><input type="date" value={returnHistoryFilters.dateFrom} onChange={(event) => setReturnHistoryFilters((current: any) => ({ ...current, dateFrom: event.target.value }))} /></label>
                  <label><span>По</span><input type="date" value={returnHistoryFilters.dateTo} onChange={(event) => setReturnHistoryFilters((current: any) => ({ ...current, dateTo: event.target.value }))} /></label>
                  <label><span>Статус</span><select value={returnHistoryFilters.status} onChange={(event) => setReturnHistoryFilters((current: any) => ({ ...current, status: event.target.value }))}><option value="all">Все</option><option value="completed">Проведённые</option><option value="cancelled">Отменённые</option></select></label>
                  <button className="primary compact history-filter-submit" type="button" disabled={returnHistoryBusy} onClick={() => void loadReturnHistory({ filters: returnHistoryFilters })}>Показать</button>
                </div>

                <div className="history-summary-line">
                  <span><strong>{returnHistorySummary.count}</strong> операций</span>
                  <span>Проведено: <strong>{returnHistorySummary.activeCount}</strong></span>
                  <span>Сумма проведённых: <strong>{formatMoney(returnHistorySummary.activeAmount)}</strong></span>
                  <span>Ещё не пришло: <strong>{returnHistorySummary.pendingPhysicalQuantity} шт.</strong></span>
                  {returnHistorySummary.cancelledCount ? <span>Отменено: <strong>{returnHistorySummary.cancelledCount}</strong></span> : null}
                </div>

                {returnHistoryError ? (
                  <div className="history-load-state is-error"><strong>Не удалось загрузить историю возвратов.</strong><span>{returnHistoryError}</span><button className="secondary compact" type="button" onClick={() => void loadReturnHistory()}>Повторить</button></div>
                ) : returnHistoryBusy && !returnHistory.length ? (
                  <div className="history-load-state"><strong>Загружаю историю возвратов…</strong></div>
                ) : returnHistory.length ? (
                  <div className="history-card-list">
                    {returnHistory.map((entry) => (
                      <details className={`history-card ${entry.status === 'cancelled' ? 'is-cancelled' : ''}`} key={`return-history-${entry.id}-${entry.orderId}`}>
                        <summary>
                          <div className="history-card-date"><strong>{entry.returnDate || '—'}</strong><span>Возврат</span></div>
                          <div className="history-card-main"><strong>{entry.externalId}</strong><span>{entry.customer}{entry.city ? ` · ${entry.city}` : ''} · Менеджер: {entry.manager || '—'}</span></div>
                          <div className="history-card-amount"><strong>{formatMoney(entry.amount)}</strong><span>{entry.items?.length ? `${entry.items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)} шт.` : 'Без списка товаров'}</span></div>
                          <span className={`status-pill ${entry.status === 'cancelled' ? 'status-offline' : 'status-online'}`}>{entry.status === 'cancelled' ? 'Отменён' : 'Проведён'}</span>
                          <span className="history-card-open">Подробнее</span>
                        </summary>
                        <div className="history-card-body">
                          <div className="history-detail-grid">
                            <div><span>Заказ от</span><strong>{entry.orderDate || '—'}</strong></div>
                            <div><span>Менеджер</span><ManagerBadge name={entry.manager} colorKey={entry.managerColor || managerColorFor(entry.manager)} compact /></div>
                            <div><span>Деньги</span><strong>{entry.paymentMethod || 'Не указан'}</strong></div>
                            <div><span>Вид операции</span><strong>{entry.operationType === 'exchange_refund' ? `Возврат по обмену${entry.exchangeId ? ` №${entry.exchangeId}` : ''}` : 'Обычный возврат'}</strong></div>
                          </div>
                          <div className="history-product-stack">
                            {(entry.items || []).map((item) => (
                              <div className="history-product-card" key={`return-history-item-${entry.id}-${item.id}`}>
                                <strong>{item.productName} × {item.quantity}</strong>
                                <span>{formatReturnItemCharacteristics(item)}</span>
                                {entry.operationType === 'order_return' ? <em>{returnPhysicalStatus(item)}</em> : null}
                                {entry.operationType === 'order_return' && entry.status !== 'cancelled' && item.physicalTracking && !item.physicalReceivedAt ? (
                                  <div className="mini-panel-actions">
                                    <select
                                      value={receiptDestinations[`return:${entry.id}:${item.id}`] || (item.isWorkshop ? 'no_stock' : 'warehouse')}
                                      onChange={(event) => setReceiptDestinations((current) => ({ ...current, [`return:${entry.id}:${item.id}`]: event.target.value as 'warehouse' | 'boutique' | 'no_stock' }))}
                                      disabled={returnBusy}
                                    >
                                      <option value="warehouse">Склад</option>
                                      <option value="boutique">Бутик</option>
                                      <option value="no_stock">Без добавления в остаток</option>
                                    </select>
                                    <button
                                      className="primary compact"
                                      type="button"
                                      disabled={returnBusy}
                                      onClick={() => void receiveReturnedItemAction({
                                        operationType: 'return',
                                        operationId: entry.id,
                                        operationItemId: item.id,
                                        destination: receiptDestinations[`return:${entry.id}:${item.id}`] || (item.isWorkshop ? 'no_stock' : 'warehouse'),
                                        productName: item.productName,
                                        externalId: entry.externalId,
                                      })}
                                    >
                                      Товар пришёл
                                    </button>
                                  </div>
                                ) : null}
                                {entry.operationType === 'order_return' && entry.status !== 'cancelled' && returnKnownIntakePending(item) ? (
                                  <div className="mini-panel-actions">
                                    <button
                                      className="primary compact"
                                      type="button"
                                      disabled={returnBusy || returnHistoryBusy}
                                      onClick={() => void finishKnownReturnIntake(item)}
                                    >
                                      Завершить приёмку
                                    </button>
                                  </div>
                                ) : null}
                                {entry.operationType === 'order_return' && entry.status !== 'cancelled' && returnReceiptNeedsRecovery(item) ? (
                                  <div className="mini-panel-actions">
                                    <button
                                      className="primary compact"
                                      type="button"
                                      disabled={returnBusy}
                                      onClick={() => void receiveReturnedItemAction({
                                        operationType: 'return',
                                        operationId: entry.id,
                                        operationItemId: item.id,
                                        destination: item.inventorySource as 'warehouse' | 'boutique',
                                        productName: item.productName,
                                        externalId: entry.externalId,
                                      })}
                                    >
                                      Завершить учёт
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                            {!entry.items?.length ? <div className="history-product-card"><span>Товары в этой старой записи не указаны.</span></div> : null}
                          </div>
                          {entry.comment ? <div className="history-note"><span>Комментарий возврата</span><strong>{entry.comment}</strong></div> : null}
                          {entry.cancellationComment ? <div className="history-note is-danger"><span>Причина отмены</span><strong>{entry.cancellationComment}</strong></div> : null}
                          <div className="history-card-actions">
                            {entry.status === 'cancelled' ? null : entry.operationType === 'exchange_refund' ? <button className="secondary compact" type="button" onClick={() => setOrderPanel('exchange')}>Открыть обмены</button> : <button className="ghost danger compact" type="button" onClick={() => void cancelReturnEntry(entry)} disabled={returnBusy}>Отменить возврат</button>}
                          </div>
                        </div>
                      </details>
                    ))}
                    {returnHistoryHasMore ? <button className="secondary history-load-more" type="button" disabled={returnHistoryBusy} onClick={() => void loadReturnHistory({ append: true })}>{returnHistoryBusy ? 'Загружаю…' : 'Показать ещё'}</button> : null}
                  </div>
                ) : (
                  <div className="history-load-state"><strong>Возвратов по выбранным условиям нет.</strong><span>Это нормальный пустой результат, а не ошибка загрузки.</span></div>
                )}
              </section>
            </article>
  )
}
