// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function ClientsSection({ ctx }: { ctx: SectionContext }) {
  const {
    clientBusy,
    clientDetails,
    clientDetailsBusy,
    clientMode,
    clientQuery,
    clientsData,
    clientsShown,
    clientsTotal,
    clientSummary,
    formatDateShort,
    formatMoney,
    isArchivedOrderRecord,
    loadClientDetails,
    loadClients,
    ManagerBadge,
    openClientOrder,
    orderLifecycleLabel,
    sectorStyle,
    selectedClientId,
    selectedClientSummary,
    setClientDetails,
    setClientMode,
    setClientQuery,
    setSelectedClientId,
  } = ctx

  return (
    <section className="card wide sector-clients clients-home clients-home-clean" id="clients" style={sectorStyle('clients')}>
              <div className="clients-clean-head">
                <div>
                  <div className="card-label">Клиенты</div>
                  <h2>История клиентов</h2>
                  <p>Найдите клиента, посмотрите его заказы и долг. Клиенты создаются из заказов — отдельной CRM здесь нет.</p>
                </div>
                <button className="secondary compact" type="button" onClick={() => void loadClients(false, 0)} disabled={clientBusy}>
                  {clientBusy ? 'Обновляю...' : 'Обновить'}
                </button>
              </div>
    
              <div className="summary-grid clients-summary-grid clients-summary-clean">
                <div className="summary-card"><span>Всего клиентов</span><strong>{clientSummary.totalClients}</strong></div>
                <div className="summary-card"><span>Повторные</span><strong>{clientSummary.repeatClients}</strong></div>
                <div className="summary-card danger-card"><span>С долгом</span><strong>{clientSummary.debtClients}</strong></div>
                <div className="summary-card danger-card"><span>Общий долг</span><strong>{formatMoney(clientSummary.totalDebt)}</strong></div>
              </div>
    
              <div className="clients-toolbar clients-toolbar-clean">
                <div className="client-mode-tabs" role="tablist" aria-label="Фильтр клиентов">
                  <button type="button" className={`secondary compact ${clientMode === 'all' ? 'is-active' : ''}`} onClick={() => setClientMode('all')}>Все</button>
                  <button type="button" className={`secondary compact ${clientMode === 'repeat' ? 'is-active' : ''}`} onClick={() => setClientMode('repeat')}>Повторные</button>
                  <button type="button" className={`secondary compact ${clientMode === 'debt' ? 'is-active' : ''}`} onClick={() => setClientMode('debt')}>С долгом</button>
                </div>
                <label className="client-search-field client-search-field-wide">
                  <span>Поиск</span>
                  <input
                    value={clientQuery}
                    onChange={(event) => setClientQuery(event.target.value)}
                    placeholder="Имя, телефон или город"
                  />
                </label>
                {clientQuery ? (
                  <button className="secondary compact" type="button" onClick={() => setClientQuery('')}>Очистить</button>
                ) : null}
              </div>
    
              <section className="mini-panel clients-stream-panel clients-stream-full">
                <div className="mini-panel-head">
                  <div>
                    <h3>Список клиентов</h3>
                    <p className="mini-panel-note">Показано {clientsShown} из {clientsTotal}. Нажмите на строку, чтобы открыть историю.</p>
                  </div>
                  <span className="soft-badge">{clientMode === 'repeat' ? 'повторные' : clientMode === 'debt' ? 'с долгом' : 'все'}</span>
                </div>
    
                <div className="clients-scroll-table clients-scroll-table-wide">
                  <table className="data-table clients-table clients-table-clean">
                    <thead>
                      <tr>
                        <th>Клиент</th>
                        <th>Город</th>
                        <th className="num">Заказов</th>
                        <th className="num">Сумма</th>
                        <th className="num">Долг</th>
                        <th>Последний заказ</th>
                        <th>Менеджеры</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientsData?.clients?.length ? clientsData.clients.map((client) => {
                        const primaryLabel = client.name || client.phone || 'Клиент без данных'
                        const secondaryLabel = client.name && client.phone ? client.phone : ''
                        return (
                          <tr
                            key={client.id}
                            className={`client-row ${selectedClientId === client.id ? 'is-selected' : ''} ${client.debtAmount > 0 ? 'has-debt' : ''}`}
                            onClick={() => void loadClientDetails(client.id)}
                          >
                            <td>
                              <button className="client-main-button client-main-button-clean" type="button" onClick={(event) => { event.stopPropagation(); void loadClientDetails(client.id) }}>
                                <strong>{primaryLabel}</strong>
                                {secondaryLabel ? <span>{secondaryLabel}</span> : null}
                              </button>
                            </td>
                            <td>{client.city || client.cities?.[0] || '—'}</td>
                            <td className="num">{client.orderCount}</td>
                            <td className="num">{formatMoney(client.totalAmount)}</td>
                            <td className={`num ${client.debtAmount > 0 ? 'debt-cell' : ''}`}>{formatMoney(client.debtAmount)}</td>
                            <td>{formatDateShort(client.lastOrderAt)}</td>
                            <td>
                              <div className="client-manager-badges">
                                {(client.managerProfiles || []).slice(0, 3).map((manager) => (
                                  <ManagerBadge key={`${client.id}-${manager.id}`} name={manager.name} colorKey={manager.colorKey} compact />
                                ))}
                                {!(client.managerProfiles || []).length
                                  ? (client.managers || []).slice(0, 2).map((manager) => <span className="soft-badge" key={`${client.id}-${manager}`}>{manager}</span>)
                                  : null}
                                {(client.managerProfiles || []).length > 3 ? <span className="soft-badge">+{(client.managerProfiles || []).length - 3}</span> : null}
                              </div>
                            </td>
                          </tr>
                        )
                      }) : (
                        <tr><td colSpan={7} className="empty-state">Клиенты не найдены. Измените поиск или фильтр.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
    
                <div className="clients-stream-footer">
                  <span>{clientBusy ? 'Загрузка...' : clientsTotal > clientsShown ? `Осталось ${clientsTotal - clientsShown}` : 'Список загружен'}</span>
                  {clientsTotal > clientsShown ? (
                    <button className="secondary compact" type="button" onClick={() => void loadClients(true)} disabled={clientBusy}>Показать ещё</button>
                  ) : null}
                </div>
              </section>
    
              {(selectedClientSummary || clientDetailsBusy) ? (
                <div className="client-drawer-backdrop" role="presentation" onClick={() => { setSelectedClientId(null); setClientDetails(null) }}>
                  <aside className="client-drawer" role="dialog" aria-modal="true" aria-label="Карточка клиента" onClick={(event) => event.stopPropagation()}>
                    <div className="client-drawer-head">
                      <div>
                        <span className="card-label">Карточка клиента</span>
                        <h3>{selectedClientSummary?.name || selectedClientSummary?.phone || 'Клиент'}</h3>
                        <p>{selectedClientSummary?.name && selectedClientSummary?.phone ? selectedClientSummary.phone : ''}{selectedClientSummary?.city ? `${selectedClientSummary?.name && selectedClientSummary?.phone ? ' · ' : ''}${selectedClientSummary.city}` : ''}</p>
                      </div>
                      <button className="ghost compact" type="button" onClick={() => { setSelectedClientId(null); setClientDetails(null) }}>Закрыть</button>
                    </div>
    
                    {clientDetailsBusy && !clientDetails ? (
                      <div className="empty-state">Открываю историю клиента...</div>
                    ) : selectedClientSummary ? (
                      <>
                        <div className="client-drawer-stats">
                          <div><span>Заказов</span><strong>{selectedClientSummary.orderCount}</strong></div>
                          <div><span>Сумма</span><strong>{formatMoney(selectedClientSummary.totalAmount)}</strong></div>
                          <div><span>Долг</span><strong className={selectedClientSummary.debtAmount > 0 ? 'text-danger' : ''}>{formatMoney(selectedClientSummary.debtAmount)}</strong></div>
                          <div><span>Последний</span><strong>{formatDateShort(selectedClientSummary.lastOrderAt)}</strong></div>
                        </div>
    
                        <div className="client-drawer-meta">
                          <span>Первый заказ: <strong>{formatDateShort(selectedClientSummary.firstOrderAt)}</strong></span>
                          <span>Города: <strong>{(selectedClientSummary.cities || []).join(', ') || selectedClientSummary.city || '—'}</strong></span>
                        </div>
    
                        <div className="client-drawer-managers">
                          <span>Менеджеры</span>
                          <div>
                            {(selectedClientSummary.managerProfiles || []).map((manager) => <ManagerBadge key={`drawer-manager-${manager.id}`} name={manager.name} colorKey={manager.colorKey} compact />)}
                            {!(selectedClientSummary.managerProfiles || []).length ? (selectedClientSummary.managers || []).map((manager) => <span className="soft-badge" key={`drawer-manager-${manager}`}>{manager}</span>) : null}
                          </div>
                        </div>
    
                        <div className="client-orders-head">
                          <h4>История заказов</h4>
                          <span>{clientDetails ? `${clientDetails.orders.length} из ${clientDetails.totalOrderCount ?? selectedClientSummary.orderCount}` : '0'}</span>
                        </div>
                        <div className="client-orders-list client-orders-list-drawer">
                          {(clientDetails?.orders || []).map((order) => (
                            <button key={`client-order-${order.id}`} className={`client-order-card ${isArchivedOrderRecord(order) ? 'is-archived' : ''}`} type="button" onClick={() => void openClientOrder(order)}>
                              <span className="client-order-card-top">
                                <strong>{order.external_id}</strong>
                                <em>{formatDateShort(order.order_date)}</em>
                              </span>
                              {order.retained_only ? <span className="soft-badge">Краткая история</span> : null}
                              <span className="client-order-card-main">{order.itemsText || order.items?.map((item) => item.productName).filter(Boolean).join('; ') || 'Товары не указаны'}</span>
                              <span className="client-order-card-bottom">
                                <small>{order.manager_name || '—'} · {order.city || '—'} · {orderLifecycleLabel(order)}</small>
                                <b>{formatMoney(order.total_amount)} / долг {formatMoney(order.debt_amount)}</b>
                              </span>
                            </button>
                          ))}
                          {clientDetails && !(clientDetails.orders || []).length ? <div className="empty-state">История заказов пуста.</div> : null}
                        </div>
                        {clientDetails?.hasMore ? (
                          <div className="clients-stream-footer">
                            <span>Загружено {clientDetails.orders.length} из {clientDetails.totalOrderCount ?? selectedClientSummary.orderCount}</span>
                            <button className="secondary compact" type="button" disabled={clientDetailsBusy} onClick={() => void loadClientDetails(selectedClientSummary.id, true)}>{clientDetailsBusy ? 'Загрузка...' : 'Показать ещё'}</button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </aside>
                </div>
              ) : null}
            </section>
  )
}
