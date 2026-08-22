// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
type SectionContext = Record<string, any>

export function OrderReturnsSection({ ctx }: { ctx: SectionContext }) {
  const {
    cancelReturnEntry,
    closeReturnForm,
    createReturnDraft,
    formatMoney,
    FriendlyNumberInput,
    isAdmin,
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
                </div>
              </div>
    
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
                          </label>
                          <label>
                            <span>Способ возврата денег</span>
                            <SmartPickerInput
                              value={returnDraft.paymentMethod}
                              options={suggestionValues.paymentMethods}
                              onChange={(value) => setReturnDraft((current) => ({ ...current, paymentMethod: value }))}
                              placeholder="Например, НАЛИЧКА"
                            />
                          </label>
                          <label>
                            <span>Куда вернуть товар</span>
                            <select
                              value={returnDraft.restockSource}
                              onChange={(event) => setReturnDraft((current) => ({ ...current, restockSource: event.target.value as ReturnDraft['restockSource'] }))}
                            >
                              <option value="none">Не возвращать в остатки</option>
                              <option value="warehouse">Склад</option>
                              <option value="boutique">Бутик</option>
                            </select>
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
                          <span className="muted-small">Выберите количество. Куда возвращать товар, задаётся общим списком выше: не возвращать / склад / бутик. Цеховая или нераспознанная вещь при выборе Склад/Бутик не меняет остаток сразу — она появится у администратора в «Ожидают движения».</span>
                        </div>
                        <div className="table-shell">
                          <table className="data-table return-items-table">
                            <thead>
                              <tr>
                                <th>Позиция</th>
                                <th>Кол-во в заказе</th>
                                <th>Вернуть</th>
                              </tr>
                            </thead>
                            <tbody>
                              {returnDraft.items.length ? returnDraft.items.map((item, index) => (
                                <tr key={`return-item-${item.orderItemId}`}>
                                  <td>{item.productName}</td>
                                  <td>{item.maxQuantity}</td>
                                  <td>
                                    <FriendlyNumberInput
                                      type="number"
                                      min="0"
                                      max={item.maxQuantity}
                                      value={item.quantity}
                                      onChange={(event) => setReturnDraft((current) => {
                                        const nextItems = current.items.map((entry, itemIndex) => itemIndex === index
                                          ? { ...entry, quantity: Math.min(entry.maxQuantity, Math.max(0, Number(event.target.value || 0))) }
                                          : entry)
                                        return { ...current, items: nextItems }
                                      })}
                                    />
                                  </td>
                                </tr>
                              )) : (
                                <tr><td colSpan={3} className="empty-state">У заказа нет позиций для возврата.</td></tr>
                              )}
                            </tbody>
                          </table>
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
                                {entry.operationType === 'order_return' ? <em>{item.lifecycleStatus === 'pending' ? `Ожидает приёма: ${inventorySourceLabel(item.inventorySource)}` : item.lifecycleStatus === 'cancelled' ? 'Приём в остаток отменён' : item.restocked ? `Возвращён: ${inventorySourceLabel(item.inventorySource)}` : 'Не возвращён в остатки'}</em> : null}
                              </div>
                            ))}
                            {!entry.items?.length ? <div className="history-product-card"><span>Товары в этой старой записи не указаны.</span></div> : null}
                          </div>
                          {entry.comment ? <div className="history-note"><span>Комментарий возврата</span><strong>{entry.comment}</strong></div> : null}
                          {entry.cancellationComment ? <div className="history-note is-danger"><span>Причина отмены</span><strong>{entry.cancellationComment}</strong></div> : null}
                          <div className="history-card-actions">
                            {entry.status === 'cancelled' ? null : entry.operationType === 'exchange_refund' ? <button className="secondary compact" type="button" onClick={() => setOrderPanel('exchange')}>Открыть обмены</button> : isAdmin ? <button className="ghost danger compact" type="button" onClick={() => void cancelReturnEntry(entry)} disabled={returnBusy}>Отменить возврат</button> : null}
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
