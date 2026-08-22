import type { InventoryRenderContext } from './types'

type PanelContext = Pick<InventoryRenderContext,
  | 'SmartPickerInput'
  | 'applyQuickStocktake'
  | 'formatMoney'
  | 'inventoryPanelStyle'
  | 'inventoryPickerOptions'
  | 'inventoryQuery'
  | 'isAdmin'
  | 'openOrderFromFinance'
  | 'openSimpleStockHistory'
  | 'openSimpleStockRowsDetail'
  | 'productCategoryLabel'
  | 'quickStocktakeBusy'
  | 'quickStocktakeNotice'
  | 'quickStocktakeOpen'
  | 'quickStocktakeValues'
  | 'refreshInventoryModule'
  | 'setInventoryQuery'
  | 'setQuickStocktakeNotice'
  | 'setQuickStocktakeOpen'
  | 'setQuickStocktakeValues'
  | 'setSimpleStockAvailabilityFilter'
  | 'setSimpleStockCategory'
  | 'setSimpleStockDetail'
  | 'setSimpleStockOpenProductKey'
  | 'setSimpleStockSource'
  | 'simpleStockAvailabilityFilter'
  | 'simpleStockCategory'
  | 'simpleStockDetail'
  | 'simpleStockGroups'
  | 'simpleStockOpenProductKey'
  | 'simpleStockPhysical'
  | 'simpleStockQuantity'
  | 'simpleStockReservations'
  | 'simpleStockReservationsBusy'
  | 'simpleStockReserved'
  | 'simpleStockSource'
  | 'simpleStockStats'
  | 'sourceLabel'
>


export function renderInventoryOverviewPanel(ctx: PanelContext) {
  const {
    SmartPickerInput,
    applyQuickStocktake,
    formatMoney,
    inventoryPanelStyle,
    inventoryPickerOptions,
    inventoryQuery,
    isAdmin,
    openOrderFromFinance,
    openSimpleStockHistory,
    openSimpleStockRowsDetail,
    productCategoryLabel,
    quickStocktakeBusy,
    quickStocktakeNotice,
    quickStocktakeOpen,
    quickStocktakeValues,
    refreshInventoryModule,
    setInventoryQuery,
    setQuickStocktakeNotice,
    setQuickStocktakeOpen,
    setQuickStocktakeValues,
    setSimpleStockAvailabilityFilter,
    setSimpleStockCategory,
    setSimpleStockDetail,
    setSimpleStockOpenProductKey,
    setSimpleStockSource,
    simpleStockAvailabilityFilter,
    simpleStockCategory,
    simpleStockDetail,
    simpleStockGroups,
    simpleStockOpenProductKey,
    simpleStockPhysical,
    simpleStockQuantity,
    simpleStockReservations,
    simpleStockReservationsBusy,
    simpleStockReserved,
    simpleStockSource,
    simpleStockStats,
    sourceLabel
  } = ctx

  return (
    <div className="inventory-overview-panel inventory-calm-stock" style={inventoryPanelStyle('overview')}>
                    <div className="inventory-calm-head">
                      <div>
                        <h3>Остатки</h3>
                        <p>Смотрите прежде всего на «Свободно» — это количество, которое можно использовать для нового заказа.</p>
                      </div>
                      <button className="secondary compact" type="button" onClick={() => void refreshInventoryModule(true)}>Обновить</button>
                    </div>
    
                    <div className="inventory-calm-toolbar">
                      <div className="inventory-calm-search">
                        <SmartPickerInput
                          value={inventoryQuery}
                          options={inventoryPickerOptions.products}
                          placeholder="Найти товар"
                          onChange={setInventoryQuery}
                          ariaLabel="Поиск товара"
                        />
                        {inventoryQuery ? <button className="secondary compact" type="button" onClick={() => setInventoryQuery('')}>Очистить</button> : null}
                      </div>
                      <div className="inventory-calm-source" aria-label="Точка остатков">
                        {[
                          { value: 'warehouse' as const, label: 'Склад' },
                          { value: 'boutique' as const, label: 'Бутик' },
                        ].map((entry) => (
                          <button key={entry.value} type="button" className={simpleStockSource === entry.value ? 'is-active' : ''} onClick={() => setSimpleStockSource(entry.value)}>{entry.label}</button>
                        ))}
                      </div>
                    </div>
    
                    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">
                      <div className="is-primary"><span>Свободно</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehouse : simpleStockStats.boutique)}</strong><small>можно использовать сейчас</small></div>
                      <div><span>На месте</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehousePhysical : simpleStockStats.boutiquePhysical)}</strong><small>должно находиться в точке</small></div>
                      <div><span>В заказах</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehouseReserved : simpleStockStats.boutiqueReserved)}</strong><small>уже отложено клиентам</small></div>
                      <details>
                        <summary>Что означают эти числа?</summary>
                        <p><b>На месте</b> включает и свободные вещи, и ещё не отправленные заказы. <b>В заказах</b> — уже обещанное клиентам. <b>Свободно</b> = на месте минус в заказах.</p>
                      </details>
                    </div>
    
                    <div className="inventory-calm-filters">
                      {[
                        { value: 'free', label: `Есть свободные (${simpleStockStats.freeVariants})` },
                        { value: 'reserved', label: `В заказах (${simpleStockStats.reservedVariants})` },
                        { value: 'attention', label: `Требуют внимания (${simpleStockStats.attentionVariants})` },
                        { value: 'all', label: 'Все с остатком' },
                      ].map((entry) => (
                        <button key={entry.value} type="button" className={simpleStockAvailabilityFilter === entry.value ? 'is-active' : ''} onClick={() => setSimpleStockAvailabilityFilter(entry.value as any)}>{entry.label}</button>
                      ))}
                      <details className="inventory-calm-extra-filter">
                        <summary>Тип товара</summary>
                        <div>
                          {[
                            { value: 'all' as const, label: 'Все' },
                            { value: 'adult' as const, label: 'Взрослые' },
                            { value: 'child' as const, label: 'Детские' },
                          ].map((entry) => (
                            <button key={entry.value} type="button" className={simpleStockCategory === entry.value ? 'is-active' : ''} onClick={() => setSimpleStockCategory(entry.value)}>{entry.label}</button>
                          ))}
                        </div>
                      </details>
                    </div>
    
                    {simpleStockAvailabilityFilter === 'all' && !inventoryQuery.trim() ? <p className="inventory-calm-note">Пустые позиции каталога здесь не выводятся. Чтобы проверить товар с нулевым остатком, найдите его через поиск.</p> : null}
    
                    <div className="inventory-calm-list">
                      {simpleStockGroups.length ? simpleStockGroups.map((group: any) => {
                        const rows = group.rows || []
                        const isOpen = simpleStockOpenProductKey === group.key
                        const free = rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                        const physical = rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                        const reserved = rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                        const single = rows.length === 1
                        const singleRow = single ? rows[0] : null
                        const needsAttention = free < 0 || physical < 0
                        const singlePrimary = singleRow ? [singleRow.color, singleRow.size].filter(Boolean).join(' · ') || 'Стандартный вариант' : ''
                        const singleSecondary = singleRow ? [productCategoryLabel(singleRow.category), singleRow.gender, singleRow.material && singleRow.material !== 'СТАНДАРТ' ? singleRow.material : '', singleRow.length && singleRow.length !== 'СТАНДАРТ' ? singleRow.length : ''].filter(Boolean).join(' · ') : ''
                        return (
                          <article className={`inventory-calm-product ${needsAttention ? 'needs-attention' : ''}`} key={`calm-stock-${group.key}`}>
                            <div className="inventory-calm-product-main">
                              <div className="inventory-calm-product-name">
                                <strong>{group.productName}</strong>
                                {single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{rows.length} вариантов в текущей выборке</span>}
                              </div>
                              <div className="inventory-calm-product-free">
                                {physical < 0 ? <><strong>Нужна сверка</strong><span>учёт ниже нуля</span></> : free < 0 ? <><strong>Не хватает {formatMoney(Math.abs(free))}</strong><span>для принятых заказов</span></> : <><strong>{formatMoney(free)}</strong><span>свободно</span></>}
                              </div>
                              <div className="inventory-calm-product-secondary">
                                <span>На месте <b>{formatMoney(physical)}</b></span>
                                {reserved > 0 ? (
                                  <button type="button" className="inventory-reservation-link" onClick={() => void openSimpleStockRowsDetail(rows, { aggregate: !single, label: singlePrimary })}>{formatMoney(reserved)} в заказах →</button>
                                ) : <span>В заказах <b>0</b></span>}
                              </div>
                              {single ? (
                                <button className="secondary compact inventory-calm-detail-button" type="button" onClick={() => void openSimpleStockRowsDetail(rows, { label: singlePrimary })}>Подробнее</button>
                              ) : (
                                <button className="secondary compact inventory-calm-detail-button" type="button" aria-expanded={isOpen} onClick={() => setSimpleStockOpenProductKey((current) => current === group.key ? '' : group.key)}>{isOpen ? 'Скрыть варианты' : `Показать варианты (${rows.length})`}</button>
                              )}
                            </div>
    
                            {!single && isOpen ? (
                              <div className="inventory-calm-variants">
                                {rows.map((row: any) => {
                                  const rowFree = simpleStockQuantity(row)
                                  const rowPhysical = simpleStockPhysical(row)
                                  const rowReserved = simpleStockReserved(row)
                                  const primary = [row.color, row.size].filter(Boolean).join(' · ') || 'Стандартный вариант'
                                  const secondary = [productCategoryLabel(row.category), row.gender, row.material && row.material !== 'СТАНДАРТ' ? row.material : '', row.length && row.length !== 'СТАНДАРТ' ? row.length : ''].filter(Boolean).join(' · ')
                                  return (
                                    <div className={`inventory-calm-variant ${rowFree < 0 || rowPhysical < 0 ? 'needs-attention' : ''}`} key={`calm-variant-${row.key}`}>
                                      <div className="inventory-calm-variant-name"><strong>{primary}</strong><span>{secondary || 'Стандартный вариант'}</span></div>
                                      <div className="inventory-calm-variant-free">{rowPhysical < 0 ? <><strong>Нужна сверка</strong><span>учёт ниже нуля</span></> : rowFree < 0 ? <><strong>−{formatMoney(Math.abs(rowFree))}</strong><span>не хватает</span></> : <><strong>{formatMoney(rowFree)}</strong><span>свободно</span></>}</div>
                                      <span className="inventory-calm-variant-physical">На месте <b>{formatMoney(rowPhysical)}</b></span>
                                      {rowReserved > 0 ? <button type="button" className="inventory-reservation-link" onClick={() => void openSimpleStockRowsDetail([row], { label: primary })}>{formatMoney(rowReserved)} в заказах →</button> : <span className="inventory-calm-no-reserve">Нет резервов</span>}
                                      <button className="ghost compact" type="button" onClick={() => void openSimpleStockRowsDetail([row], { label: primary })}>Подробнее</button>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : null}
                          </article>
                        )
                      }) : (
                        <div className="empty-state inventory-calm-empty">По выбранному фильтру ничего нет. Измените фильтр или найдите товар по названию.</div>
                      )}
                    </div>
    
                    {simpleStockDetail ? (
                      <div className="inventory-calm-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSimpleStockDetail(null) }}>
                        <aside className="inventory-calm-detail" role="dialog" aria-modal="true" aria-label="Остаток товара">
                          <div className="inventory-calm-detail-head">
                            <div><span>{sourceLabel(simpleStockDetail.source)}</span><h3>{simpleStockDetail.productName}</h3><p>{simpleStockDetail.aggregate ? 'Все варианты товара' : [simpleStockDetail.label, productCategoryLabel(simpleStockDetail.category), simpleStockDetail.gender, simpleStockDetail.material && simpleStockDetail.material !== 'СТАНДАРТ' ? simpleStockDetail.material : '', simpleStockDetail.length && simpleStockDetail.length !== 'СТАНДАРТ' ? simpleStockDetail.length : ''].filter(Boolean).join(' · ')}</p></div>
                            <button className="ghost compact" type="button" onClick={() => setSimpleStockDetail(null)}>Закрыть</button>
                          </div>
                          <div className="inventory-calm-detail-numbers">
                            <div className="is-primary"><span>Свободно</span><strong>{simpleStockDetail.free < 0 ? `−${Math.abs(simpleStockDetail.free)}` : simpleStockDetail.free}</strong></div>
                            <div><span>На месте</span><strong>{simpleStockDetail.physical}</strong></div>
                            <div><span>В заказах</span><strong>{simpleStockDetail.reserved}</strong></div>
                          </div>
                          {simpleStockDetail.physical < 0 ? <div className="inventory-calm-warning"><strong>Учёт ниже нуля — нужна сверка</strong><span>Отрицательное число не доказывает, что забыли приход. Проверьте фактическое количество и источник товара; система исправит учёт по реальному факту.</span></div> : simpleStockDetail.free < 0 ? <div className="inventory-calm-warning"><strong>Товара не хватает для текущих заказов</strong><span>Нужно ещё {Math.abs(simpleStockDetail.free)} шт. либо требуется сверка фактического количества.</span></div> : null}
                          <section className="inventory-calm-reservations">
                            <div className="inventory-calm-reservations-head"><strong>{simpleStockDetail.reserved > 0 ? 'Товар отложен для этих заказов' : 'Товар сейчас не зарезервирован'}</strong>{simpleStockDetail.reserved > 0 ? <span>Всего: {simpleStockDetail.reserved} шт.</span> : null}</div>
                            {simpleStockReservationsBusy ? <div className="empty-state compact-empty">Загружаю заказы…</div> : simpleStockDetail.reserved > 0 && !simpleStockReservations.length ? <div className="empty-state compact-empty">Не удалось получить список заказов. Обновите остатки и попробуйте ещё раз.</div> : simpleStockReservations.map((reservation: any) => (
                              <div className="inventory-calm-reservation" key={`reservation-${reservation.id}`}>
                                <div className="inventory-calm-reservation-main">
                                  <strong>Заказ {reservation.externalOrderId || reservation.orderId}</strong>
                                  {simpleStockDetail.aggregate ? <span>{[reservation.color, reservation.size, reservation.material && reservation.material !== 'СТАНДАРТ' ? reservation.material : '', reservation.length && reservation.length !== 'СТАНДАРТ' ? reservation.length : ''].filter(Boolean).join(' · ')}</span> : null}
                                  <small>{[reservation.customerName || reservation.customerPhone, reservation.managerName, reservation.orderDate].filter(Boolean).join(' · ')}</small>
                                </div>
                                <b>{reservation.quantity} шт.</b>
                                <button className="secondary compact" type="button" onClick={() => { setSimpleStockDetail(null); void openOrderFromFinance({ orderId: reservation.orderId, externalId: reservation.externalOrderId, orderDate: reservation.orderDate }) }}>Открыть заказ</button>
                              </div>
                            ))}
                          </section>
                          {!simpleStockDetail.aggregate ? (
                            <section className="inventory-exact-count">
                              <div>
                                <strong>Сверить количество</strong>
                                <div className="inventory-exact-count-note">Введите, сколько таких вещей физически находится здесь сейчас. Считайте и свободные, и уже отложенные под заказы.</div>
                              </div>
                              {quickStocktakeOpen ? (
                                <div className="inventory-exact-count-row">
                                  <label>
                                    <span>На месте сейчас</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      inputMode="numeric"
                                      value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''}
                                      onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })}
                                      placeholder={String(simpleStockDetail.physical)}
                                    />
                                  </label>
                                  <button className="primary" type="button" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button>
                                  <button className="ghost" type="button" disabled={quickStocktakeBusy} onClick={() => { setQuickStocktakeOpen(false); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Отмена</button>
                                </div>
                              ) : <button className="secondary" type="button" onClick={() => { setQuickStocktakeOpen(true); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Сверить количество</button>}
                              {quickStocktakeNotice ? <p className="inventory-quick-stocktake-notice">{quickStocktakeNotice}</p> : null}
                            </section>
                          ) : null}
                          {isAdmin ? <div className="inventory-calm-detail-actions">{simpleStockDetail.aggregate ? <span className="inventory-quick-stocktake-hint">Для сверки откройте конкретный вариант товара.</span> : null}{!simpleStockDetail.aggregate ? <button className="secondary" type="button" onClick={() => openSimpleStockHistory(simpleStockDetail)}>История позиции</button> : null}</div> : null}
                        </aside>
                      </div>
                    ) : null}
                  </div>
  )
}
