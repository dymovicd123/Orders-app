// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrderDebtSection({ ctx }: { ctx: SectionContext }) {
  const {
    addDebtPayment,
    closeDebtForm,
    createDebtClosePayment,
    debtBusy,
    debtCloseHistory,
    debtFilters,
    debtFormRef,
    debtLoadBusy,
    debtOrders,
    debtOverview,
    loadAllOpenDebtOrders,
    debtOverpayAmount,
    debtPayments,
    debtPaymentTotal,
    debtRemainingAmount,
    debtSelectedOrder,
    formatLocalDateInput,
    formatMoney,
    FriendlyNumberInput,
    handleSelectDebtOrder,
    ManagerBadge,
    managerColorFor,
    orderPanelStyle,
    removeDebtPayment,
    saveDebtClose,
    sectorStyle,
    setDebtFilters,
    setDebtPayments,
    SmartPickerInput,
    suggestionValues,
    summarizeOrderItemLines,
    updateDebtPayment,
  } = ctx

  return (
    <article className="card wide sector-orders" id="order-debt" style={{ ...sectorStyle('orders'), ...orderPanelStyle('debt') }}>
              <div className="card-label">Закрытие долга</div>
              <div className="card-meta">Найдите заказ с долгом, добавьте одну или несколько оплат и сохраните. Остаток долга пересчитывается автоматически.</div>
    
              <div className="editor-summary debt-summary-panel">
                <div className="editor-summary-grid">
                  <div>
                    <span>Заказов с долгом</span>
                    <strong>{debtFilters.q || debtFilters.manager || debtFilters.orderDate ? debtOrders.length : debtOverview.count}</strong>
                  </div>
                  <div>
                    <span>Общий долг</span>
                    <strong>{formatMoney(debtFilters.q || debtFilters.manager || debtFilters.orderDate ? debtOrders.reduce((sum, order) => sum + Number(order.debt_amount || 0), 0) : debtOverview.totalDebt)}</strong>
                  </div>
                  <div>
                    <span>Закрытий в истории</span>
                    <strong>{debtOverview.historyCount}</strong>
                  </div>
                  <div>
                    <span>Сумма закрытий</span>
                    <strong>{formatMoney(debtOverview.historyAmount)}</strong>
                  </div>
                </div>
              </div>
    
              <div className="orders-filter-panel debt-filter-panel">
                <div className="orders-filter-grid debt-filter-grid">
                  <label>
                    <span>Поиск</span>
                    <input
                      value={debtFilters.q}
                      onChange={(event) => setDebtFilters((current) => ({ ...current, q: event.target.value }))}
                      placeholder="Клиент, телефон, город, менеджер, комментарий"
                    />
                  </label>
                  <label>
                    <span>Менеджер</span>
                    <SmartPickerInput
                      value={debtFilters.manager}
                      onChange={(value) => setDebtFilters((current) => ({ ...current, manager: value }))}
                      placeholder="Все менеджеры"
                      options={suggestionValues.managers}
                    />
                  </label>
                  <label>
                    <span>Дата заказа</span>
                    <input
                      type="date"
                      value={debtFilters.orderDate}
                      onChange={(event) => setDebtFilters((current) => ({ ...current, orderDate: event.target.value }))}
                    />
                  </label>
                  <div className="actions debt-filter-actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setDebtFilters({ q: '', manager: '', orderDate: '' })}
                    >
                      Сбросить фильтр
                    </button>
                  </div>
                </div>
              </div>
    
              <section className="mini-panel debt-table-panel">
                <div className="mini-panel-head">
                  <div>
                    <h3>Таблица долгов</h3>
                    <p className="mini-panel-note">Показываются открытые долги без ограничения текущим месяцем. Найдите заказ и выберите строку — ниже откроется форма оплаты.{debtOverview.hasMore ? ` Загружено ${debtOverview.loadedCount} из ${debtOverview.count}; общая сумма и количество рассчитаны по всей базе.` : ''}</p>
                  </div>
                  <div className="debt-filter-summary">
                    <span>{debtLoadBusy ? 'Загрузка' : 'Найдено'}</span>
                    <strong>{debtLoadBusy ? '...' : debtOrders.length}</strong>
                  </div>
                </div>
    
                <div className="table-shell">
                  <table className="data-table debt-order-table">
                    <thead>
                      <tr>
                        <th>Дата / заказ</th>
                        <th>Менеджер</th>
                        <th>Клиент</th>
                        <th>Город</th>
                        <th>Товары</th>
                        <th>Сумма</th>
                        <th>Получено</th>
                        <th>Долг</th>
                        <th>Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debtOrders.length ? debtOrders.map((order) => (
                        <tr
                          key={`debt-order-${order.id}`}
                          className={debtSelectedOrder?.id === order.id ? 'debt-order-row is-selected' : 'debt-order-row'}
                        >
                          <td>
                            <strong>{order.order_date}</strong>
                            <div className="table-subtext">{order.external_id}</div>
                          </td>
                          <td><ManagerBadge name={order.manager_name} colorKey={order.manager_color} compact /></td>
                          <td>{order.customer_name || order.customer_phone || '—'}</td>
                          <td>{order.city || '—'}</td>
                          <td>{summarizeOrderItemLines(order.items, 2).lines.map((line) => line.title).join('; ') || '—'}</td>
                          <td>{formatMoney(order.total_amount)}</td>
                          <td>{formatMoney(order.received_amount)}</td>
                          <td>
                            <span className="status-pill status-warning">{formatMoney(order.debt_amount)}</span>
                          </td>
                          <td>
                            <button className="secondary compact" type="button" onClick={() => handleSelectDebtOrder(order.id)}>
                              {debtSelectedOrder?.id === order.id ? 'Выбран' : 'Выбрать'}
                            </button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={9} className="empty-state">По текущему фильтру заказов с долгом не найдено.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {debtOverview.hasMore ? (
                  <div className="clients-stream-footer">
                    <span>Загружено {debtOverview.loadedCount} из {debtOverview.count}</span>
                    <button className="secondary compact" type="button" disabled={debtLoadBusy} onClick={() => void loadAllOpenDebtOrders(true)}>{debtLoadBusy ? 'Загрузка...' : 'Показать ещё'}</button>
                  </div>
                ) : null}
              </section>
    
              <section className="mini-panel debt-form-panel" ref={debtFormRef}>
                <div className="mini-panel-head">
                  <h3>Оплаты по долгу</h3>
                  <div className="mini-panel-actions">
                    {debtSelectedOrder ? (
                      <button className="secondary compact back-action" type="button" onClick={() => closeDebtForm(true)} disabled={debtBusy}>
                        Назад
                      </button>
                    ) : null}
                    <button className="secondary compact" type="button" onClick={addDebtPayment} disabled={!debtSelectedOrder}>
                      + Оплата
                    </button>
                  </div>
                </div>
    
                {debtSelectedOrder ? (
                  <>
                    <div className="editor-summary debt-target-summary">
                      <div className="editor-summary-head">
                        <div>
                          <strong>{debtSelectedOrder.external_id}</strong>
                          <span>{debtSelectedOrder.order_date} · {debtSelectedOrder.manager_name || '—'} · {debtSelectedOrder.customer_name || debtSelectedOrder.customer_phone || '—'}</span>
                        </div>
                        <span className="status-pill status-warning">Остаток {formatMoney(debtSelectedOrder.debt_amount)}</span>
                      </div>
                      <div className="editor-summary-grid">
                        <div>
                          <span>Сумма заказа</span>
                          <strong>{formatMoney(debtSelectedOrder.total_amount)}</strong>
                        </div>
                        <div>
                          <span>Уже получено</span>
                          <strong>{formatMoney(debtSelectedOrder.received_amount)}</strong>
                        </div>
                        <div>
                          <span>Закрываем сейчас</span>
                          <strong>{formatMoney(debtPaymentTotal)}</strong>
                        </div>
                        <div>
                          <span>Остаток после оплаты</span>
                          <strong>{formatMoney(debtRemainingAmount)}</strong>
                        </div>
                      </div>
                    </div>
    
                    <div className="stack">
                      {debtPayments.map((payment, index) => (
                        <div className="mini-item order-payment-card" key={`debt-payment-${index}`}>
                          <div className="mini-item-head">
                            <strong>Оплата {index + 1}</strong>
                            <button className="ghost danger compact" type="button" onClick={() => removeDebtPayment(index)}>
                              Удалить
                            </button>
                          </div>
                          <div className="subgrid order-payment-grid">
                            <label>
                              <span>Дата</span>
                              <input
                                type="date"
                                value={payment.paymentDate}
                                onChange={(event) => updateDebtPayment(index, 'paymentDate', event.target.value)}
                              />
                            </label>
                            <label>
                              <span>Способ оплаты</span>
                              <SmartPickerInput
                                value={payment.method}
                                onChange={(value) => updateDebtPayment(index, 'method', value)}
                                placeholder="Выберите способ"
                                options={suggestionValues.paymentMethods}
                              />
                            </label>
                            <label>
                              <span>Сумма</span>
                              <FriendlyNumberInput
                                type="number"
                                min="0"
                                value={payment.amount ?? 0}
                                onChange={(event) => updateDebtPayment(index, 'amount', Number(event.target.value))}
                              />
                            </label>
                            <label className="wide-field">
                              <span>Комментарий</span>
                              <input
                                value={payment.comment || ''}
                                onChange={(event) => updateDebtPayment(index, 'comment', event.target.value)}
                                placeholder="Например: частично закрыл долг"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
    
                    {debtOverpayAmount > 0 ? (
                      <div className="error debt-inline-error">
                        Сумма оплаты превышает долг на {formatMoney(debtOverpayAmount)}. Уменьшите платежи перед сохранением.
                      </div>
                    ) : null}
    
                    <div className="actions order-create-actions form-bottom-actions">
                      <button className="primary" type="button" onClick={() => void saveDebtClose()} disabled={debtBusy || debtOverpayAmount > 0}>
                        {debtBusy ? 'Сохраняю...' : 'Закрыть долг'}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setDebtPayments([createDebtClosePayment(formatLocalDateInput(), Number(debtSelectedOrder.debt_amount || 0))])}
                      >
                        Сбросить оплаты
                      </button>
                      <button className="secondary back-action" type="button" onClick={() => closeDebtForm(true)} disabled={debtBusy}>
                        Назад к таблице
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state debt-empty-state">
                    Сначала найдите нужный долг в таблице выше и нажмите `Выбрать`. После этого здесь откроется форма оплаты.
                  </div>
                )}
              </section>
    
              <section className="mini-panel debt-history-panel">
                <div className="mini-panel-head">
                  <h3>История закрытий</h3>
                </div>
                <p className="mini-panel-note">{debtOverview.historyCount > debtCloseHistory.length ? `Показаны последние ${debtCloseHistory.length} из ${debtOverview.historyCount} платежей, добавленных через закрытие долга. Итоговые счётчики выше рассчитаны по всей истории.` : 'Здесь видны все платежи, которые были добавлены именно через закрытие долга.'}</p>
                <div className="table-shell">
                  <table className="data-table debt-history-table">
                    <thead>
                      <tr>
                        <th>Дата закрытия</th>
                        <th>Дата заказа</th>
                        <th>Заказ</th>
                        <th>Менеджер</th>
                        <th>Клиент</th>
                        <th>Способ</th>
                        <th>Сумма</th>
                        <th>Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debtCloseHistory.length ? debtCloseHistory.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.paymentDate || '—'}</td>
                          <td>{entry.orderDate || '—'}</td>
                          <td>{entry.orderId}</td>
                          <td><ManagerBadge name={entry.manager} colorKey={managerColorFor(entry.manager)} compact /></td>
                          <td>{entry.customer}</td>
                          <td>{entry.method}</td>
                          <td>{formatMoney(entry.amount)}</td>
                          <td>{entry.comment}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={8} className="empty-state">Пока нет ни одного зафиксированного закрытия долга.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </article>
  )
}
