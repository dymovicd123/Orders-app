import type { InventoryRenderContext } from './types'
import '../../../styles/w8-1-stock-overview.css'
import '../../../styles/w8-2-stock-workspace.css'
import '../../../styles/w13-stock-catalog-browse.css'
import '../../../styles/w14-simple-stock-controls.css'
import { StockBrowseDetail } from './StockBrowseDetail'
import { stockRowHasBalance } from '../stockBrowseLayout'

type PanelContext = Pick<InventoryRenderContext,
  | 'SmartPickerInput'
  | 'inventoryPickerOptions'
  | 'inventoryQuery'
  | 'setInventoryQuery'
  | 'productCategoryLabel'
  | 'applyQuickStocktake'
  | 'cycleCountBusy'
  | 'cycleCountData'
  | 'cycleCountLoading'
  | 'cycleCountNotice'
  | 'cycleCountValues'
  | 'formatMoney'
  | 'inventoryPanelStyle'
  | 'isAdmin'
  | 'openInventoryPanel'
  | 'openOrderFromFinance'
  | 'openSimpleStockHistory'
  | 'openSimpleStockRowsDetail'
  | 'refreshInventoryModule'
  | 'quickStocktakeBusy'
  | 'quickStocktakeNotice'
  | 'quickStocktakeOpen'
  | 'quickStocktakeValues'
  | 'refreshCycleCountSuggestions'
  | 'setQuickStocktakeNotice'
  | 'setQuickStocktakeOpen'
  | 'setQuickStocktakeValues'
  | 'setCycleCountValues'
  | 'setSimpleStockAvailabilityFilter'
  | 'setSimpleStockDetail'
  | 'setSimpleStockOpenProductKey'
  | 'setSimpleStockSource'
  | 'simpleStockAvailabilityFilter'
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
  | 'submitRoutineCycleCount'
> & {
  simpleStockSearch: string
  setSimpleStockSearch: (value: string) => void
  ensureSimpleStockCatalog: () => void
  simpleStockCatalogLoading?: boolean
  simpleStockCatalogError?: string
}

const w8Plural = (value: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(value)
  const lastTwo = absolute % 100
  const last = absolute % 10
  if (lastTwo >= 11 && lastTwo <= 19) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

export function renderInventoryOverviewPanel(ctx: PanelContext) {
  const {
    applyQuickStocktake,
    formatMoney,
    productCategoryLabel,
    inventoryPanelStyle,
    openOrderFromFinance,
    openSimpleStockHistory,
    openSimpleStockRowsDetail,
    quickStocktakeBusy,
    quickStocktakeNotice,
    quickStocktakeValues,
    setQuickStocktakeNotice,
    setQuickStocktakeOpen,
    setQuickStocktakeValues,
    simpleStockSearch,
    setSimpleStockSearch,
    ensureSimpleStockCatalog,
    setSimpleStockAvailabilityFilter,
    setSimpleStockDetail,
    setSimpleStockOpenProductKey,
    setSimpleStockSource,
    simpleStockCatalogLoading,
    simpleStockCatalogError,
    simpleStockAvailabilityFilter,
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

  const openConcreteStockDetail = (row: any, label: string) => {
    void openSimpleStockRowsDetail([row], { source: simpleStockSource, label })
  }

  const microCheckDetailRow = (detail: any) => ({
    productId: detail.productId, variantId: detail.variantId, productName: detail.productName, category: detail.category, gender: detail.gender, material: detail.material, length: detail.length, size: detail.size, color: detail.color,
    warehouseQuantity: detail.source === 'warehouse' ? detail.physical : 0, warehouseReserved: detail.source === 'warehouse' ? detail.reserved : 0, warehouseAvailable: detail.source === 'warehouse' ? detail.free : 0,
    boutiqueQuantity: detail.source === 'boutique' ? detail.physical : 0, boutiqueReserved: detail.source === 'boutique' ? detail.reserved : 0, boutiqueAvailable: detail.source === 'boutique' ? detail.free : 0,
  })

  const selectedGroup = simpleStockGroups.find((group: any) => group.key === simpleStockOpenProductKey) || simpleStockGroups[0] || null
  const stockSourceName = sourceLabel(simpleStockSource)
  const resultScopeLabel = simpleStockSearch.trim() ? 'Результаты поиска по названиям' :
    simpleStockAvailabilityFilter === 'withStock' ? 'С учтённым наличием или резервом' : 'Активные модели каталога'

  return (
    <div className="inventory-overview-panel inventory-calm-stock stock-v13-page stock-v14-page" style={inventoryPanelStyle('overview')}>
                    <div className="inventory-calm-head warehouse-clean-stock-head stock-v14-heading">
                      <div>
                        <h3>Остатки</h3>
                        <p>Выберите модель, цвет и размер. Количество показано по одной точке.</p>
                      </div>
                      <div className="stock-v14-location-tools">
                        <div className="inventory-calm-source" aria-label="Точка остатков">
                          {[
                            { value: 'warehouse' as const, label: 'Склад' },
                            { value: 'boutique' as const, label: 'Бутик' },
                          ].map((entry) => (
                            <button key={entry.value} type="button" className={simpleStockSource === entry.value ? 'is-active' : ''} onClick={() => setSimpleStockSource(entry.value)}>{entry.label}</button>
                          ))}
                        </div>
                        <button className="secondary compact stock-v14-refresh" type="button"
                          onClick={() => setSimpleStockSource(simpleStockSource)}
                          title={`Обновить остатки точки ${sourceLabel(simpleStockSource)}`}
                          aria-label={`Обновить остатки точки ${sourceLabel(simpleStockSource)}`}>↻ Обновить</button>
                      </div>
                    </div>

                    <div className="stock-v14-summary-label"><strong>{sourceLabel(simpleStockSource)}</strong><span>Вся точка · поиск и список моделей не меняют эти числа</span></div>
                    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">
                      <div className="is-primary"><span>Свободно</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehouse : simpleStockStats.boutique)}</strong><small>можно использовать сейчас</small></div>
                      <div><span>На месте</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehousePhysical : simpleStockStats.boutiquePhysical)}</strong><small>должно находиться в точке</small></div>
                      <div><span>В заказах</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehouseReserved : simpleStockStats.boutiqueReserved)}</strong><small>уже отложено клиентам</small></div>
                      <details>
                        <summary>Что означают эти числа?</summary>
                        <p><b>На месте</b> включает и свободные вещи, и ещё не отправленные заказы. <b>В заказах</b> — уже обещанное клиентам. <b>Свободно</b> = на месте минус в заказах.</p>
                      </details>
                    </div>

                    <div className="stock-v13-browse catalog-master-detail" data-stock-browser="catalog-master-detail">
                      <aside className="stock-v13-master" aria-label="Каталог моделей с остатками">
                        <div className="stock-v13-master-head">
                          <strong>{simpleStockGroups.length} {w8Plural(simpleStockGroups.length, 'модель', 'модели', 'моделей')}</strong>
                          <small>{resultScopeLabel}</small>
                        </div>
                        <div className="stock-v14-master-controls">
                          <div className="stock-v14-model-search">
                            <input type="search" value={simpleStockSearch} placeholder="Найти модель…"
                              aria-label="Поиск модели по названию"
                              onChange={(event) => setSimpleStockSearch(event.target.value)} />
                            {simpleStockSearch ? <button type="button" onClick={() => setSimpleStockSearch('')} aria-label="Очистить поиск">×</button> : null}
                          </div>
                          <div className="stock-v14-simple-filters" role="group" aria-label="Какие модели показывать">
                            <button type="button" className={simpleStockAvailabilityFilter === 'withStock' ? 'is-active' : ''}
                              aria-pressed={simpleStockAvailabilityFilter === 'withStock'}
                              onClick={() => setSimpleStockAvailabilityFilter('withStock')}>С остатком</button>
                            <button type="button" className={simpleStockAvailabilityFilter === 'all' ? 'is-active' : ''}
                              aria-pressed={simpleStockAvailabilityFilter === 'all'}
                              onClick={() => { ensureSimpleStockCatalog(); setSimpleStockAvailabilityFilter('all') }}>Все модели</button>
                          </div>
                          {simpleStockCatalogLoading ? <small role="status">Загружаем полный каталог…</small> : null}
                          {simpleStockAvailabilityFilter === 'all' && simpleStockCatalogError ? <small role="alert">{simpleStockCatalogError}</small> : null}
                        </div>
                        <div className="stock-v13-master-list" role="list">
                          {simpleStockGroups.length ? simpleStockGroups.map((group: any) => {
                            const allRows = group.allRows || group.rows || []
                            const physical = allRows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                            const reserved = allRows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                            const free = allRows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                            const active = allRows.filter((row: any) => stockRowHasBalance(simpleStockPhysical(row), simpleStockReserved(row), simpleStockQuantity(row))).length
                            const selected = selectedGroup?.key === group.key
                            return <button type="button" role="listitem" key={group.key}
                              className={`stock-v13-master-item ${selected ? 'is-selected' : ''} ${free < 0 ? 'has-shortage' : ''}`}
                              aria-current={selected ? 'true' : undefined}
                              onClick={() => setSimpleStockOpenProductKey(group.key)}>
                              <span className="stock-v13-master-identity">
                                <strong>{group.productName}</strong>
                                <small>{active} из {allRows.length} поз. с остатком или резервом</small>
                              </span>
                              <span className="stock-v13-master-quantity">
                                <b>{formatMoney(free)}</b>
                                <small>свободно</small>
                              </span>
                              <span className="stock-v13-master-subtotals">На месте {formatMoney(physical)} · Резерв {formatMoney(reserved)}</span>
                            </button>
                          }) : <div className="stock-v13-empty">Ничего не найдено. Попробуйте изменить поиск или фильтр.</div>}
                        </div>
                      </aside>
                      <div className="stock-v13-detail-pane">
                        {selectedGroup ? <>
                          {simpleStockCatalogLoading ? <p className="stock-v13-load-note" role="status">Загружаем варианты модели…</p> : null}
                          {simpleStockCatalogError ? <p className="stock-v13-load-note is-error" role="alert">{simpleStockCatalogError}</p> : null}
                          <StockBrowseDetail
                            key={`${simpleStockSource}-${selectedGroup.key}`}
                            group={selectedGroup}
                            sourceLabel={stockSourceName}
                            physical={simpleStockPhysical}
                            reserved={simpleStockReserved}
                            free={simpleStockQuantity}
                            onOpenVariant={(row) => openConcreteStockDetail(row, [row.color, row.size].filter(Boolean).join(' · ') || 'Вариант')}
                            onOpenHistory={(row) => openSimpleStockHistory({
                              source: simpleStockSource,
                              variantId: Number(row.variantId),
                              productId: Number(row.productId || 0),
                              productName: selectedGroup.productName,
                              color: row.color,
                              material: row.material,
                              length: row.length,
                              gender: row.gender,
                              size: row.size,
                            })}
                          />
                        </> : <div className="stock-v13-empty">Выберите модель из списка слева.</div>}
                      </div>
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
                          {simpleStockDetail.microCheck ? (
                            <section className="inventory-exact-count warehouse-w3-micro-check" data-w3-micro-check="true">
                              <div><strong>Быстрая проверка</strong><div className="inventory-exact-count-note">Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет — сохранится только подтверждённый вами факт.</div></div>
                              {simpleStockDetail.physical >= 0 ? (
                                <div className="inventory-routine-cycle-actions">
                                  <button className="primary compact inventory-routine-cycle-confirm" type="button" disabled={quickStocktakeBusy} onClick={() => void applyQuickStocktake(Number(simpleStockDetail.physical || 0))}>{quickStocktakeBusy ? 'Сохраняю…' : `Да, на месте ${simpleStockDetail.physical}`}</button>
                                  <details className="inventory-routine-cycle-other"><summary className="inventory-routine-cycle-other-button">Нет, другое количество</summary><div className="inventory-routine-cycle-edit"><input aria-label={`Фактическое количество ${simpleStockDetail.productName}`} type="number" min="0" step="1" inputMode="numeric" value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''} onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })} /><button className="primary compact" type="button" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button></div></details>
                                </div>
                              ) : (
                                <div className="inventory-routine-cycle-edit is-independent"><input aria-label={`Фактическое количество ${simpleStockDetail.productName}`} type="number" min="0" step="1" inputMode="numeric" placeholder="Факт" value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''} onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })} /><button className="primary compact" type="button" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button></div>
                              )}
                              {simpleStockDetail.physical < 0 ? <div className="inventory-exact-count-note">Системное количество ниже нуля, поэтому подтвердить его одним нажатием нельзя — укажите реальный факт.</div> : null}
                              {quickStocktakeNotice ? <p className="inventory-quick-stocktake-notice">{quickStocktakeNotice}</p> : null}
                              <div className="inventory-calm-detail-actions"><button className="secondary" type="button" onClick={() => void openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)], { source: simpleStockDetail.source, label: simpleStockDetail.label })}>Подробнее о позиции</button></div>
                            </section>
                          ) : (<>
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
                              <section className="inventory-exact-count warehouse-w3-micro-check-entry">
                                <div>
                                  <strong>Сверить количество</strong>
                                  <div className="inventory-exact-count-note">Если хотите проверить учёт, сначала пересчитайте эту конкретную позицию физически. Само открытие карточки ничего не меняет.</div>
                                </div>
                                <button className="secondary warehouse-w3-micro-check-start" type="button" onClick={() => {
                                  setSimpleStockDetail((current: any) => current ? { ...current, microCheck: true } : current)
                                  setQuickStocktakeOpen(true)
                                  setQuickStocktakeValues({})
                                  setQuickStocktakeNotice('')
                                }}>Сверить количество</button>
                              </section>
                            ) : null}
                            <div className="inventory-calm-detail-actions">{simpleStockDetail.aggregate ? <span className="inventory-quick-stocktake-hint">Для сверки откройте конкретный вариант товара.</span> : null}{!simpleStockDetail.aggregate ? <button className="secondary" type="button" onClick={() => openSimpleStockHistory(simpleStockDetail)}>История позиции</button> : null}</div>
                          </>)}
                        </aside>
                      </div>
                    ) : null}
                  </div>
  )
}
