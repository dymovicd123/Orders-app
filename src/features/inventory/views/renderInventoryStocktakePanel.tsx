import type { InventoryRenderContext } from './types'

type PanelContext = Pick<InventoryRenderContext,
  | 'addStocktakeNewCombination'
  | 'applyStocktake'
  | 'catalogActiveProducts'
  | 'currentStocktakeGroup'
  | 'currentStocktakePositions'
  | 'cycleCountBusy'
  | 'cycleCountData'
  | 'cycleCountFilledCount'
  | 'cycleCountLoading'
  | 'cycleCountNotice'
  | 'cycleCountOpen'
  | 'cycleCountValues'
  | 'discardStocktake'
  | 'filteredStocktakeProductGroups'
  | 'filteredStocktakeSelectableProducts'
  | 'focusNextStocktakeCountInput'
  | 'formatStocktakeMoment'
  | 'goToNextUnfilledStocktakeProduct'
  | 'inventoryPanelStyle'
  | 'markCurrentStocktakeProductRemainingZero'
  | 'normalizeSuggestion'
  | 'openStocktakeFoundForPosition'
  | 'openStocktakeInlineColor'
  | 'openStocktakeInlineSize'
  | 'openStocktakeOrders'
  | 'openStocktakeReview'
  | 'persistStocktakeFact'
  | 'printInventoryStocktakePdf'
  | 'refreshCycleCountSuggestions'
  | 'resumeStocktake'
  | 'selectedStocktakePositionCount'
  | 'setCycleCountData'
  | 'setCycleCountNotice'
  | 'setCycleCountOpen'
  | 'setCycleCountValues'
  | 'setStocktakeFact'
  | 'setStocktakeFoundCustom'
  | 'setStocktakeFoundDraft'
  | 'setStocktakeFoundNewFields'
  | 'setStocktakeFoundOpen'
  | 'setStocktakeFoundOtherProduct'
  | 'setStocktakeFoundProductId'
  | 'setStocktakeFoundSizes'
  | 'setStocktakeInlineAdd'
  | 'setStocktakeNotice'
  | 'setStocktakeProductIndex'
  | 'setStocktakeProductSearch'
  | 'setStocktakeReviewMode'
  | 'setStocktakeSelectedProductIds'
  | 'setStocktakeSource'
  | 'setStocktakeStartMode'
  | 'setStocktakeStartSearch'
  | 'startStocktake'
  | 'stocktakeActiveForSelectedSource'
  | 'stocktakeActiveSessions'
  | 'stocktakeAddingVariantId'
  | 'stocktakeBusy'
  | 'stocktakeFacts'
  | 'stocktakeFoundCustom'
  | 'stocktakeFoundDraft'
  | 'stocktakeFoundNewFields'
  | 'stocktakeFoundOpen'
  | 'stocktakeFoundOtherProduct'
  | 'stocktakeFoundProductId'
  | 'stocktakeFoundSizes'
  | 'stocktakeGroups'
  | 'stocktakeInlineAdd'
  | 'stocktakeInlineAddBusy'
  | 'stocktakeInlineColorOptions'
  | 'stocktakeInlineSizeOptions'
  | 'stocktakeNotice'
  | 'stocktakePositionKey'
  | 'stocktakePositionLabel'
  | 'stocktakeProductIndex'
  | 'stocktakeProductSearch'
  | 'stocktakeProgress'
  | 'stocktakeReadyForReview'
  | 'stocktakeReferenceReady'
  | 'stocktakeReviewMode'
  | 'stocktakeReviewRows'
  | 'stocktakeSavingIds'
  | 'stocktakeSelectedProductIds'
  | 'stocktakeSession'
  | 'stocktakeSource'
  | 'stocktakeSourceStats'
  | 'stocktakeSourceTitle'
  | 'stocktakeStartMode'
  | 'stocktakeStartSearch'
  | 'stocktakeUnsavedCount'
  | 'submitCycleCount'
  | 'submitStocktakeInlineAdd'
  | 'suggestionValues'
  | 'toggleStocktakeInlineSize'
>


export function renderInventoryStocktakePanel(ctx: PanelContext) {
  const {
    addStocktakeNewCombination,
    applyStocktake,
    catalogActiveProducts,
    currentStocktakeGroup,
    currentStocktakePositions,
    cycleCountBusy,
    cycleCountData,
    cycleCountFilledCount,
    cycleCountLoading,
    cycleCountNotice,
    cycleCountOpen,
    cycleCountValues,
    discardStocktake,
    filteredStocktakeProductGroups,
    filteredStocktakeSelectableProducts,
    focusNextStocktakeCountInput,
    formatStocktakeMoment,
    goToNextUnfilledStocktakeProduct,
    inventoryPanelStyle,
    markCurrentStocktakeProductRemainingZero,
    normalizeSuggestion,
    openStocktakeFoundForPosition,
    openStocktakeInlineColor,
    openStocktakeInlineSize,
    openStocktakeOrders,
    openStocktakeReview,
    persistStocktakeFact,
    printInventoryStocktakePdf,
    refreshCycleCountSuggestions,
    resumeStocktake,
    selectedStocktakePositionCount,
    setCycleCountData,
    setCycleCountNotice,
    setCycleCountOpen,
    setCycleCountValues,
    setStocktakeFact,
    setStocktakeFoundCustom,
    setStocktakeFoundDraft,
    setStocktakeFoundNewFields,
    setStocktakeFoundOpen,
    setStocktakeFoundOtherProduct,
    setStocktakeFoundProductId,
    setStocktakeFoundSizes,
    setStocktakeInlineAdd,
    setStocktakeNotice,
    setStocktakeProductIndex,
    setStocktakeProductSearch,
    setStocktakeReviewMode,
    setStocktakeSelectedProductIds,
    setStocktakeSource,
    setStocktakeStartMode,
    setStocktakeStartSearch,
    startStocktake,
    stocktakeActiveForSelectedSource,
    stocktakeActiveSessions,
    stocktakeAddingVariantId,
    stocktakeBusy,
    stocktakeFacts,
    stocktakeFoundCustom,
    stocktakeFoundDraft,
    stocktakeFoundNewFields,
    stocktakeFoundOpen,
    stocktakeFoundOtherProduct,
    stocktakeFoundProductId,
    stocktakeFoundSizes,
    stocktakeGroups,
    stocktakeInlineAdd,
    stocktakeInlineAddBusy,
    stocktakeInlineColorOptions,
    stocktakeInlineSizeOptions,
    stocktakeNotice,
    stocktakePositionKey,
    stocktakePositionLabel,
    stocktakeProductIndex,
    stocktakeProductSearch,
    stocktakeProgress,
    stocktakeReadyForReview,
    stocktakeReferenceReady,
    stocktakeReviewMode,
    stocktakeReviewRows,
    stocktakeSavingIds,
    stocktakeSelectedProductIds,
    stocktakeSession,
    stocktakeSource,
    stocktakeSourceStats,
    stocktakeSourceTitle,
    stocktakeStartMode,
    stocktakeStartSearch,
    stocktakeUnsavedCount,
    submitCycleCount,
    submitStocktakeInlineAdd,
    suggestionValues,
    toggleStocktakeInlineSize
  } = ctx

  return (
    <div className="inventory-stocktake-panel stocktake-human-panel stocktake-session-v188e" data-step188e-stocktake="server-session" style={inventoryPanelStyle('stocktake')}>
                    <div className="stocktake-e-head">
                      <div>
                        <h3>Проверка</h3>
                        <p>Пересчитайте то, что реально находится в выбранной точке. Начатую проверку можно закрыть и продолжить позже.</p>
                      </div>
                    </div>
    
                    {!stocktakeSession ? (
                      <>
                        <section className="stocktake-e-start stocktake-e-start-v5">
                          <div className="stocktake-start-intro">
                            <span className="stocktake-step-kicker">{stocktakeActiveForSelectedSource ? 'Проверка уже идёт' : 'Новая проверка'}</span>
                            <h4>{stocktakeActiveForSelectedSource ? `Продолжить пересчёт · ${stocktakeSourceTitle(stocktakeSource)}` : 'Что хотите проверить?'}</h4>
                            <p>{stocktakeActiveForSelectedSource ? 'Новая проверка этой точки недоступна, пока текущая не завершена или не отменена.' : 'Для обычной сверки выберите только нужные товары. Полную проверку запускайте, когда действительно пересчитываете всю точку.'}</p>
                          </div>
    
                          <div className="stocktake-source-switch stocktake-source-switch-v5" role="tablist" aria-label="Точка проверки">
                            <button type="button" role="tab" aria-selected={stocktakeSource === 'warehouse'} className={stocktakeSource === 'warehouse' ? 'is-active' : ''} onClick={() => { setStocktakeSource('warehouse'); setStocktakeSelectedProductIds([]); setCycleCountData(null); setCycleCountValues({}); setCycleCountOpen(false); setCycleCountNotice('') }}>Склад <small>{stocktakeSourceStats.warehouse}</small>{stocktakeActiveSessions.some((entry: any) => entry.source === 'warehouse') ? <i title="Есть незавершённая проверка">●</i> : null}</button>
                            <button type="button" role="tab" aria-selected={stocktakeSource === 'boutique'} className={stocktakeSource === 'boutique' ? 'is-active' : ''} onClick={() => { setStocktakeSource('boutique'); setStocktakeSelectedProductIds([]); setCycleCountData(null); setCycleCountValues({}); setCycleCountOpen(false); setCycleCountNotice('') }}>Бутик <small>{stocktakeSourceStats.boutique}</small>{stocktakeActiveSessions.some((entry: any) => entry.source === 'boutique') ? <i title="Есть незавершённая проверка">●</i> : null}</button>
                          </div>
    
                          {stocktakeActiveForSelectedSource ? (
                            <div className="stocktake-resume-focus">
                              <div className="stocktake-resume-progress">
                                <div><strong>{stocktakeActiveForSelectedSource.countedCount} из {stocktakeActiveForSelectedSource.totalItems} проверено</strong><span>Начата {formatStocktakeMoment(stocktakeActiveForSelectedSource.startedAt)}</span></div>
                                <div className="stocktake-resume-progress-bar"><i style={{ width: `${stocktakeActiveForSelectedSource.totalItems ? Math.round((Number(stocktakeActiveForSelectedSource.countedCount || 0) / Number(stocktakeActiveForSelectedSource.totalItems || 1)) * 100) : 0}%` }} /></div>
                                {stocktakeActiveForSelectedSource.recountCount ? <span className="stocktake-resume-attention">Нужно повторно пересчитать: {stocktakeActiveForSelectedSource.recountCount}</span> : null}
                              </div>
                              <button className="primary" type="button" disabled={stocktakeBusy} onClick={() => void resumeStocktake(stocktakeActiveForSelectedSource)}>{stocktakeBusy ? 'Открываю…' : 'Продолжить проверку'}</button>
                            </div>
                          ) : (
                            <>
                              <section className={`inventory-cycle-count-card ${Number(cycleCountData?.recommendedCount || 0) > 0 ? 'has-recommendations' : 'is-calm'}`}>
                                <div className="inventory-cycle-count-head">
                                  <div><span className="stocktake-step-kicker">Поддержание точности</span><strong>Короткая проверка</strong><small>Система предлагает только позиции, которым сейчас полезна физическая сверка. Это подсказка, а не блокировка работы.</small></div>
                                  <button className="ghost compact" type="button" disabled={cycleCountLoading || cycleCountBusy} onClick={() => void refreshCycleCountSuggestions(stocktakeSource)}>{cycleCountLoading ? 'Обновляю…' : 'Обновить'}</button>
                                </div>
                                {cycleCountLoading && !cycleCountData ? <div className="inventory-cycle-count-state">Подбираю позиции…</div> : null}
                                {!cycleCountLoading && cycleCountData && Number(cycleCountData.recommendedCount || 0) === 0 ? <div className="inventory-cycle-count-state is-good"><strong>Сейчас срочных сверок нет</strong><span>После большой ревизии этот список будет наполняться постепенно: по давности, движениям и реальным расхождениям.</span></div> : null}
                                {cycleCountData && Number(cycleCountData.recommendedCount || 0) > 0 ? <>
                                  <div className="inventory-cycle-count-summary"><span><strong>{cycleCountData.recommendedCount}</strong> {Number(cycleCountData.recommendedCount) === 1 ? 'позиция просит внимания' : 'позиций просят внимания'}</span><button className={cycleCountOpen ? 'secondary compact' : 'primary compact inventory-cycle-count-open-button'} type="button" disabled={cycleCountLoading || cycleCountBusy || cycleCountData?.source !== stocktakeSource} onClick={() => { setCycleCountOpen((current) => !current); setCycleCountValues({}); setCycleCountNotice('') }}>{cycleCountOpen ? 'Свернуть' : 'Проверить сейчас'}</button></div>
                                  {cycleCountOpen ? <div className="inventory-cycle-count-body">
                                    <div className="inventory-cycle-count-rule">Считайте только то, что реально проверили. Пустые строки не меняются. В «факт» входит весь товар на месте, в том числе отложенный под заказы.{Number(cycleCountData.recommendedCount || 0) > Number((cycleCountData.items || []).length) ? ` Сначала показаны ${cycleCountData.items.length} самых полезных позиций.` : ''}</div>
                                    <div className="inventory-cycle-count-list">
                                      {(cycleCountData.items || []).map((row: any) => {
                                        const value = cycleCountValues[String(row.variantId)] ?? ''
                                        const attrs = [row.material !== 'СТАНДАРТ' ? row.material : '', row.length !== 'СТАНДАРТ' ? row.length : '', row.gender, row.color, row.size].filter(Boolean).join(' · ')
                                        const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0
                                        return <div className={`inventory-cycle-count-row ${value !== '' ? 'is-filled' : ''} ${needsIndependentCount ? 'needs-attention' : ''}`} key={`cycle-count-${row.variantId}`}>
                                          <div className="inventory-cycle-count-name"><strong>{row.productName}</strong><span>{attrs || 'Стандартная комбинация'}</span><small>{(row.reasons || []).slice(0, 2).join(' · ')}</small></div>
                                          <div className={`inventory-cycle-count-system ${needsIndependentCount ? 'is-blind' : ''}`}>{needsIndependentCount ? <span><strong>Сначала посчитайте физически</strong></span> : <span>По системе: <strong>{row.physical}</strong> на месте</span>}{Number(row.reserved || 0) ? <span>В заказах <strong>{row.reserved}</strong></span> : null}</div>
                                          {!needsIndependentCount ? <button className={`secondary compact inventory-cycle-count-quick-confirm ${value === String(Math.max(0, Math.trunc(Number(row.physical || 0)))) ? 'is-confirmed' : ''}`} type="button" disabled={cycleCountBusy} onClick={() => setCycleCountValues((current) => ({ ...current, [String(row.variantId)]: String(Math.max(0, Math.trunc(Number(row.physical || 0)))) }))}>{value === String(Math.max(0, Math.trunc(Number(row.physical || 0)))) ? '✓ Подтверждено' : `Да, на месте ${Math.max(0, Math.trunc(Number(row.physical || 0)))}`}</button> : null}
                                          <label><span>{needsIndependentCount ? 'Введите факт' : 'Другое количество'}</span><input aria-label={`Фактическое количество ${row.productName}`} type="number" min="0" step="1" inputMode="numeric" value={value} placeholder={needsIndependentCount ? 'Посчитайте' : 'Если отличается'} onChange={(event) => { const raw = event.target.value; if (raw === '') { setCycleCountValues((current) => ({ ...current, [String(row.variantId)]: '' })); return } const parsed = Number(raw); if (!Number.isFinite(parsed)) return; setCycleCountValues((current) => ({ ...current, [String(row.variantId)]: String(Math.max(0, Math.trunc(parsed))) })) }} /></label>
                                        </div>
                                      })}
                                    </div>
                                    <div className="inventory-cycle-count-actions inventory-cycle-count-actions-w5"><button className="primary inventory-cycle-count-save-button" type="button" disabled={!cycleCountFilledCount || cycleCountBusy} onClick={() => void submitCycleCount()}>{cycleCountBusy ? 'Сохраняю…' : `Сохранить проверенные позиции${cycleCountFilledCount ? ` · ${cycleCountFilledCount}` : ''}`}</button><span>Сохранятся только строки, где вы подтвердили или ввели фактическое количество. Совпадения тоже запоминаются как свежая проверка.</span></div>
                                  </div> : null}
                                </> : null}
                                {cycleCountNotice ? <div className="inventory-cycle-count-notice">{cycleCountNotice}</div> : null}
                              </section>
    
                              <div className="stocktake-start-modes stocktake-start-modes-v5">
                                <button type="button" className={`stocktake-start-mode ${stocktakeStartMode === 'selective' ? 'is-active' : ''}`} onClick={() => setStocktakeStartMode('selective')}>
                                  <strong>Проверить несколько товаров</strong>
                                  <span>Выберите только то, что хотите пересчитать сейчас</span>
                                </button>
                                <button type="button" className={`stocktake-start-mode ${stocktakeStartMode === 'full' ? 'is-active' : ''}`} onClick={() => setStocktakeStartMode('full')}>
                                  <strong>Полная проверка точки</strong>
                                  <span>{stocktakeSourceStats[stocktakeSource]} позиций</span>
                                </button>
                              </div>
    
                              {stocktakeStartMode === 'selective' ? (
                                <div className="stocktake-selective-picker stocktake-selective-picker-v5">
                                  <div className="stocktake-selective-head">
                                    <label><span>Выберите товары</span><input value={stocktakeStartSearch} onChange={(event) => setStocktakeStartSearch(event.target.value)} placeholder="Найти товар…" /></label>
                                    <div><strong>{stocktakeSelectedProductIds.length ? `Выбрано товаров: ${stocktakeSelectedProductIds.length}` : 'Ничего не выбрано'}</strong><span>{stocktakeSelectedProductIds.length ? `${selectedStocktakePositionCount} позиций` : 'Отметьте нужные товары в списке'}</span></div>
                                  </div>
                                  <div className="stocktake-selective-list stocktake-selective-list-v5">
                                    {filteredStocktakeSelectableProducts.length ? filteredStocktakeSelectableProducts.map((product: any) => {
                                      const checked = stocktakeSelectedProductIds.includes(Number(product.productId))
                                      return <label className={`stocktake-selective-product ${checked ? 'is-selected' : ''}`} key={`stocktake-select-${product.productId}`}><input type="checkbox" checked={checked} onChange={() => setStocktakeSelectedProductIds((current) => checked ? current.filter((id) => id !== Number(product.productId)) : [...current, Number(product.productId)])} /><span><strong>{product.productName}</strong><small>{product.positionCount} поз.</small></span></label>
                                    }) : <div className="stocktake-product-list-empty">По фильтру товаров нет.</div>}
                                  </div>
                                </div>
                              ) : (
                                <div className="stocktake-full-warning stocktake-full-warning-v5"><strong>{stocktakeSourceTitle(stocktakeSource)} · {stocktakeSourceStats[stocktakeSource]} позиций</strong><span>Нулевые позиции каталога не добавляются автоматически. Найденную во время пересчёта позицию можно добавить прямо из текущего товара.</span></div>
                              )}
    
                              <div className="stocktake-start-submit">
                                <div>{stocktakeStartMode === 'selective' ? (stocktakeSelectedProductIds.length ? `${stocktakeSelectedProductIds.length} товаров · ${selectedStocktakePositionCount} позиций` : 'Выберите хотя бы один товар') : `Полная проверка · ${stocktakeSourceStats[stocktakeSource]} позиций`}</div>
                                <button className="primary stocktake-e-start-button" type="button" disabled={stocktakeBusy || (stocktakeStartMode === 'selective' && !stocktakeSelectedProductIds.length)} onClick={() => void startStocktake()}>{stocktakeBusy ? 'Подготавливаю…' : stocktakeStartMode === 'selective' ? 'Начать проверку выбранных товаров' : 'Начать полную проверку'}</button>
                              </div>
                            </>
                          )}
                        </section>
                        {stocktakeNotice ? <div className="stocktake-inline-notice">{stocktakeNotice}</div> : null}
                      </>
                    ) : (
                      <>
                        <section className="stocktake-e-active-head">
                          <div>
                            <span className="stocktake-step-kicker">Проверка в процессе</span>
                            <h4>{stocktakeSession.scope === 'selective' ? 'Выборочная проверка' : 'Полная проверка'} · {stocktakeSourceTitle(stocktakeSession.source)}</h4>
                            <p>Начата {formatStocktakeMoment(stocktakeSession.startedAt)} · {stocktakeSession.id}</p>
                          </div>
                          <div className="stocktake-e-save-state">
                            <strong>{stocktakeSavingIds.length ? 'Сохраняю…' : stocktakeUnsavedCount ? `Не сохранено: ${stocktakeUnsavedCount}` : 'Сохранено автоматически ✓'}</strong>
                            <span>{stocktakeSavingIds.length || stocktakeUnsavedCount ? 'Не закрывайте страницу, пока изменения не сохранятся.' : 'Можно перейти в другой раздел и продолжить эту проверку позже.'}</span>
                          </div>
                          <div className="stocktake-e-head-actions-wrap">
                            <div className="stocktake-e-head-actions">
                              <button className="secondary compact" type="button" onClick={printInventoryStocktakePdf}>Печатный лист</button>
                              <button className="secondary compact danger stocktake-cancel-button" type="button" disabled={stocktakeBusy} onClick={() => void discardStocktake()}>Отменить проверку</button>
                            </div>
                            <small>Чтобы продолжить позже, отменять не нужно — просто выйдите из раздела.</small>
                          </div>
                        </section>
    
                        {stocktakeNotice ? <div className="stocktake-inline-notice">{stocktakeNotice}</div> : null}
    
                        {!stocktakeReviewMode ? <div className={`stocktake-sticky-progress ${stocktakeReadyForReview ? 'is-ready' : ''}`}>
                          <div className="stocktake-sticky-progress-main"><strong>{stocktakeProgress.filled} из {stocktakeProgress.total} проверено</strong><span>{stocktakeProgress.recount ? `Нужно повторно пересчитать ${stocktakeProgress.recount}` : stocktakeProgress.unfilled ? `Завершение станет доступно после проверки ещё ${stocktakeProgress.unfilled}` : 'Все позиции заполнены — можно проверить результат.'}</span></div>
                          <div className="stocktake-sticky-progress-bar"><i style={{ width: `${stocktakeProgress.total ? Math.round((stocktakeProgress.filled / stocktakeProgress.total) * 100) : 0}%` }} /></div>
                          <button className="primary compact stocktake-review-button" type="button" disabled={!stocktakeReadyForReview || stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} title={!stocktakeReadyForReview ? 'Сначала заполните все позиции и повторно пересчитайте конфликтные строки.' : ''} onClick={() => void openStocktakeReview()}>Проверить результат</button>
                        </div> : null}
    
                        {!stocktakeReviewMode ? (
                          <>
                            <div className="stocktake-counting-rule">Считайте всё, что физически находится здесь, включая уже отложенные заказы. Пустое поле означает, что позиция ещё не посчитана.</div>
    
                            <div className="stocktake-counting-shell">
                              <aside className="stocktake-counting-sidebar">
                                <div className="stocktake-product-browser stocktake-product-browser-v5">
                                  <div className="stocktake-product-browser-title"><strong>Товары</strong><span>{stocktakeProductIndex + 1} / {stocktakeGroups.length}</span></div>
                                  <label className="stocktake-product-filter stocktake-product-filter-v5">
                                    <input value={stocktakeProductSearch} onChange={(event) => setStocktakeProductSearch(event.target.value)} placeholder="Найти товар…" />
                                  </label>
                                  <div className="stocktake-product-list stocktake-product-list-v5" role="listbox" aria-label="Товары текущей ревизии">
                                    {filteredStocktakeProductGroups.length ? filteredStocktakeProductGroups.map((group: any) => {
                                      const groupIndex = stocktakeGroups.findIndex((entry: any) => entry.key === group.key)
                                      const counted = (group.rows || []).filter((row: any) => (stocktakeFacts[String(row.id)] ?? '') !== '').length
                                      const total = (group.rows || []).length
                                      const remaining = Math.max(0, total - counted)
                                      const attention = (group.rows || []).some((row: any) => row.status === 'recount_required')
                                      const done = total > 0 && counted === total && !attention
                                      const status = attention ? 'пересчитать' : done ? '✓' : counted ? `${remaining} осталось` : `${total}`
                                      return <button key={`stocktake-product-list-${group.key}`} type="button" role="option" aria-selected={groupIndex === stocktakeProductIndex} className={`${groupIndex === stocktakeProductIndex ? 'is-active' : ''} ${attention ? 'needs-attention' : ''} ${done ? 'is-done' : ''}`} onClick={() => { setStocktakeProductIndex(groupIndex); setStocktakeReviewMode(false); setStocktakeNotice('') }}>
                                        <span>{group.productName}</span><small>{status}</small>
                                      </button>
                                    }) : <div className="stocktake-product-list-empty">Нет товаров по этому фильтру.</div>}
                                  </div>
                                </div>
                              </aside>
    
                              <div className="stocktake-counting-main">
                                <label className="stocktake-mobile-product-select">
                                  <span>Текущий товар</span>
                                  <select value={stocktakeProductIndex} onChange={(event) => setStocktakeProductIndex(Number(event.target.value || 0))}>
                                    {stocktakeGroups.map((group: any, index: number) => {
                                      const counted = (group.rows || []).filter((row: any) => (stocktakeFacts[String(row.id)] ?? '') !== '').length
                                      const total = (group.rows || []).length
                                      return <option value={index} key={`stocktake-mobile-product-${group.key}`}>{group.productName} · {counted}/{total}</option>
                                    })}
                                  </select>
                                </label>
                                {currentStocktakeGroup ? (
                                  <section className="stocktake-e-work-card stocktake-e-work-card-calm">
                                    <div className="stocktake-e-product-nav stocktake-e-product-nav-calm stocktake-e-product-nav-v5">
                                      <div><span>Товар {stocktakeProductIndex + 1} из {stocktakeGroups.length}</span><h4>{currentStocktakeGroup.productName}</h4></div>
                                      <div className="stocktake-product-step-actions">
                                        <button className="ghost compact" type="button" aria-label="Предыдущий товар" disabled={stocktakeProductIndex <= 0} onClick={() => setStocktakeProductIndex((current) => Math.max(0, current - 1))}>← <span>Пред.</span></button>
                                        <button className="ghost compact" type="button" aria-label="Следующий товар" disabled={stocktakeProductIndex >= stocktakeGroups.length - 1} onClick={() => setStocktakeProductIndex((current) => Math.min(stocktakeGroups.length - 1, current + 1))}><span>След.</span> →</button>
                                      </div>
                                    </div>
    
                                    <div className="stocktake-e-positions stocktake-e-positions-compact">
                                      {currentStocktakePositions.map((position: any) => {
                                        const colorGroups = new Map<string, any[]>()
                                        for (const row of position.rows || []) {
                                          const color = String(row.color || 'БЕЗ ЦВЕТА')
                                          const rows = colorGroups.get(color) || []
                                          rows.push(row)
                                          colorGroups.set(color, rows)
                                        }
                                        const plainPositionLabel = String(position.label || '')
                                        const showPositionTitle = currentStocktakePositions.length > 1 || !['Стандартное исполнение', 'ЖЕН', 'МУЖ', 'Взрослый · ЖЕН', 'Взрослый · МУЖ'].includes(plainPositionLabel)
                                        return (
                                          <section className={`stocktake-e-position stocktake-e-position-compact ${showPositionTitle ? '' : 'is-default-position'}`} key={`${currentStocktakeGroup.key}-${position.key}`}>
                                            {showPositionTitle ? <div className="stocktake-e-position-title"><strong>{position.label}</strong></div> : null}
                                            <div className="stocktake-color-groups">
                                              {Array.from(colorGroups.entries()).map(([color, rows]) => {
                                                const actualColor = String(rows?.[0]?.color || '')
                                                const inlineSizeOpen = stocktakeInlineAdd?.mode === 'size'
                                                  && stocktakeInlineAdd.positionKey === String(position.key)
                                                  && normalizeSuggestion(stocktakeInlineAdd.color) === normalizeSuggestion(actualColor)
                                                const availableSizes = inlineSizeOpen ? stocktakeInlineSizeOptions(position, actualColor) : []
                                                return (
                                                  <div className="stocktake-color-group" key={`${position.key}-${color}`}>
                                                    <div className="stocktake-color-group-head"><strong>{color}</strong></div>
                                                    <div className="stocktake-color-group-body">
                                                      <div className="stocktake-size-grid">
                                                        {rows.slice().sort((a: any, b: any) => String(a.size || '').localeCompare(String(b.size || ''), 'ru', { numeric: true })).map((row: any) => {
                                                          const raw = stocktakeFacts[String(row.id)] ?? ''
                                                          const saving = stocktakeSavingIds.includes(Number(row.id))
                                                          const recount = row.status === 'recount_required'
                                                          return (
                                                            <label className={`stocktake-size-cell ${raw !== '' ? 'is-filled' : ''} ${saving ? 'is-saving' : ''} ${recount ? 'needs-recount' : ''}`} key={`stocktake-item-${row.id}`}>
                                                              <span className="stocktake-size-label">{row.size || '—'}</span>
                                                              <input data-stocktake-count-input="1" data-stocktake-item-id={row.id} aria-label={`${currentStocktakeGroup.productName} ${color} ${row.size || ''}: фактическое количество`} type="number" min="0" step="1" inputMode="numeric" value={raw} onChange={(event) => setStocktakeFact(Number(row.id), event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void persistStocktakeFact(Number(row.id), raw); focusNextStocktakeCountInput(Number(row.id)) } }} onBlur={() => { if (raw !== '' || row.countedQuantity !== null && row.countedQuantity !== undefined) void persistStocktakeFact(Number(row.id), raw) }} placeholder="—" />
                                                              {raw !== '' ? <button className="stocktake-size-clear" type="button" aria-label="Очистить значение" title="Вернуть в состояние «не посчитано»" onClick={(event) => { event.preventDefault(); setStocktakeFact(Number(row.id), '') }}>×</button> : null}
                                                              {recount ? <span className="stocktake-size-recount">Пересчитать</span> : null}
                                                            </label>
                                                          )
                                                        })}
                                                        <button className={`stocktake-inline-add-trigger ${inlineSizeOpen ? 'is-active' : ''}`} type="button" disabled={stocktakeInlineAddBusy} onClick={() => inlineSizeOpen ? setStocktakeInlineAdd(null) : openStocktakeInlineSize(position, actualColor)}>+ {rows?.[0]?.category === 'child' ? 'возраст' : 'размер'}</button>
                                                      </div>
                                                      {inlineSizeOpen ? (
                                                        <div className="stocktake-inline-add-panel stocktake-inline-size-panel">
                                                          <div className="stocktake-inline-add-head"><div><strong>Добавить {rows?.[0]?.category === 'child' ? 'возраст' : 'размер'}</strong><span>{color} · {position.label}</span></div><button className="ghost compact" type="button" aria-label="Закрыть" onClick={() => setStocktakeInlineAdd(null)}>×</button></div>
                                                          {!stocktakeReferenceReady ? <div className="stocktake-inline-empty">Загружаю справочник…</div> : availableSizes.length ? <div className="stocktake-inline-options">{availableSizes.map((value: string) => { const selected = stocktakeInlineAdd.sizes.some((item) => normalizeSuggestion(item) === normalizeSuggestion(value)); return <button className={selected ? 'is-selected' : ''} key={`inline-size-${position.key}-${actualColor}-${value}`} type="button" onClick={() => toggleStocktakeInlineSize(value)}>{value}</button> })}</div> : <div className="stocktake-inline-empty">Все значения из справочника уже есть в этой строке.</div>}
                                                          <div className="stocktake-inline-add-actions"><button className="primary compact" type="button" disabled={stocktakeInlineAddBusy || !stocktakeInlineAdd.sizes.length} onClick={() => void submitStocktakeInlineAdd()}>{stocktakeInlineAddBusy ? 'Добавляю…' : stocktakeInlineAdd.sizes.length > 1 ? `Добавить ${stocktakeInlineAdd.sizes.length}` : 'Добавить'}</button><button className="ghost compact" type="button" onClick={() => openStocktakeFoundForPosition(position, actualColor)}>Нет нужного значения</button></div>
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                            <div className="stocktake-inline-position-footer">
                                              <button className={`ghost compact stocktake-inline-color-trigger ${stocktakeInlineAdd?.mode === 'color' && stocktakeInlineAdd.positionKey === String(position.key) ? 'is-active' : ''}`} type="button" disabled={stocktakeInlineAddBusy} onClick={() => stocktakeInlineAdd?.mode === 'color' && stocktakeInlineAdd.positionKey === String(position.key) ? setStocktakeInlineAdd(null) : openStocktakeInlineColor(position)}>+ цвет</button>
                                            </div>
                                            {stocktakeInlineAdd?.mode === 'color' && stocktakeInlineAdd.positionKey === String(position.key) ? (() => {
                                              const availableColors = stocktakeInlineColorOptions(position)
                                              const selectedColor = stocktakeInlineAdd.color
                                              const availableSizes = selectedColor ? stocktakeInlineSizeOptions(position, selectedColor) : []
                                              const sample = (position.rows || [])[0]
                                              return <div className="stocktake-inline-add-panel stocktake-inline-color-panel">
                                                <div className="stocktake-inline-add-head"><div><strong>Добавить цвет</strong><span>{position.label}</span></div><button className="ghost compact" type="button" aria-label="Закрыть" onClick={() => setStocktakeInlineAdd(null)}>×</button></div>
                                                {!stocktakeReferenceReady ? <div className="stocktake-inline-empty">Загружаю справочники…</div> : <>
                                                  <label className="stocktake-inline-color-select"><span>Цвет</span><select value={selectedColor} onChange={(event) => setStocktakeInlineAdd((current) => current ? { ...current, color: event.target.value, sizes: [] } : current)}><option value="">Выберите из справочника</option>{availableColors.map((value: string) => <option key={`inline-color-${position.key}-${value}`} value={value}>{value}</option>)}</select></label>
                                                  {selectedColor ? <div className="stocktake-inline-size-choice"><span>{sample?.category === 'child' ? 'Возраст' : 'Размер'}</span>{availableSizes.length ? <div className="stocktake-inline-options">{availableSizes.map((value: string) => { const selected = stocktakeInlineAdd.sizes.some((item) => normalizeSuggestion(item) === normalizeSuggestion(value)); return <button className={selected ? 'is-selected' : ''} key={`inline-color-size-${position.key}-${selectedColor}-${value}`} type="button" onClick={() => toggleStocktakeInlineSize(value)}>{value}</button> })}</div> : <div className="stocktake-inline-empty">Для этого цвета все значения из справочника уже есть.</div>}</div> : null}
                                                </>}
                                                <div className="stocktake-inline-add-actions"><button className="primary compact" type="button" disabled={stocktakeInlineAddBusy || !selectedColor || !stocktakeInlineAdd.sizes.length} onClick={() => void submitStocktakeInlineAdd()}>{stocktakeInlineAddBusy ? 'Добавляю…' : stocktakeInlineAdd.sizes.length > 1 ? `Добавить ${stocktakeInlineAdd.sizes.length}` : 'Добавить'}</button><button className="ghost compact" type="button" onClick={() => openStocktakeFoundForPosition(position)}>Нет нужного цвета</button></div>
                                              </div>
                                            })() : null}
                                          </section>
                                        )
                                      })}
                                    </div>
                                    <div className="stocktake-current-product-actions stocktake-current-product-actions-v5">
                                      <button className="secondary compact" type="button" title="Используйте только если весь текущий товар уже физически проверен" disabled={stocktakeBusy || !(currentStocktakeGroup.rows || []).some((row: any) => (stocktakeFacts[String(row.id)] ?? '') === '')} onClick={() => void markCurrentStocktakeProductRemainingZero()}>Остальные = 0</button>
                                      <button className="primary compact" type="button" onClick={() => setStocktakeFoundOpen(true)}>+ Найденная позиция</button>
                                    </div>
                                  </section>
                                ) : (
                                  <div className="empty-state">В этой ревизии пока нет позиций. Если товар физически есть, добавьте его ниже.</div>
                                )}
                              </div>
                            </div>
    
                            {stocktakeFoundOpen ? <div className="stocktake-found-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setStocktakeFoundOpen(false) }}>
                              <section className="stocktake-e-found stocktake-e-found-controlled stocktake-found-facts stocktake-found-modal" role="dialog" aria-modal="true" aria-label="Добавить найденную позицию">
                                <div className="stocktake-found-modal-head">
                                  <div><strong>+ Найденная позиция</strong><span>{currentStocktakeGroup?.productName || 'Текущий товар'}</span></div>
                                  <button className="ghost compact" type="button" aria-label="Закрыть" onClick={() => setStocktakeFoundOpen(false)}>×</button>
                                </div>
                                <div className="stocktake-found-modal-note">Выберите факты о найденной вещи. Это не приход: количество изменится только после пересчёта.</div>
    
                              <div className="stocktake-found-product-line">
                                {!stocktakeFoundOtherProduct ? (
                                  <div><span>Товар</span><strong>{currentStocktakeGroup?.productName || 'Товар не выбран'}</strong></div>
                                ) : (
                                  <label><span>Другой товар</span><select value={stocktakeFoundProductId || ''} onChange={(event) => setStocktakeFoundProductId(Number(event.target.value || 0))}>
                                    <option value="">Выберите товар</option>
                                    {catalogActiveProducts.map((product: any) => <option key={`stocktake-found-product-${product.id}`} value={product.id}>{product.name}</option>)}
                                  </select></label>
                                )}
                                <button className="ghost compact" type="button" onClick={() => {
                                  setStocktakeFoundOtherProduct((current) => {
                                    const next = !current
                                    if (!next) setStocktakeFoundProductId(Number(currentStocktakeGroup?.productId || 0))
                                    return next
                                  })
                                }}>{stocktakeFoundOtherProduct ? 'Вернуться к текущему товару' : 'Это другой товар'}</button>
                              </div>
    
                              {!stocktakeReferenceReady ? (
                                <div className="stocktake-reference-loading"><strong>Загружаю справочники характеристик…</strong><span>Цвета, материалы, длины и размеры берутся только из канонических справочников склада.</span></div>
                              ) : (
                                <div className="stocktake-found-facts-grid">
                                  {([
                                    ['material', 'Материал', ['СТАНДАРТ', ...(suggestionValues.materials || []).filter((v: string) => normalizeSuggestion(v) !== 'СТАНДАРТ')]],
                                    ['length', 'Длина', ['СТАНДАРТ', ...(suggestionValues.lengths || []).filter((v: string) => normalizeSuggestion(v) !== 'СТАНДАРТ')]],
                                  ] as any[]).map(([field, label, options]) => (
                                    <div className="stocktake-reference-choice" key={`stocktake-found-${field}`}>
                                      <label><span>{label}</span><select value={(stocktakeFoundDraft as any)[field]} disabled={Boolean(stocktakeFoundNewFields[field])} onChange={(event) => setStocktakeFoundDraft((current: any) => ({ ...current, [field]: event.target.value }))}><option value="">Выберите из справочника</option>{options.map((value: string) => <option key={`${field}-${value}`} value={value}>{value}</option>)}</select></label>
                                      <button className="ghost compact stocktake-new-reference-toggle" type="button" onClick={() => { setStocktakeFoundNewFields((current) => ({ ...current, [field]: !current[field] })); setStocktakeFoundCustom((current: any) => ({ ...current, [field]: '' })) }}>{stocktakeFoundNewFields[field] ? 'Выбрать из справочника' : 'Нет в списке'}</button>
                                      {stocktakeFoundNewFields[field] ? <label className="stocktake-new-reference-field"><span>Новое значение</span><input value={(stocktakeFoundCustom as any)[field]} onChange={(event) => setStocktakeFoundCustom((current: any) => ({ ...current, [field]: event.target.value }))} placeholder={`Новое: ${label.toLowerCase()}`} /></label> : null}
                                    </div>
                                  ))}
                                  <label><span>Тип</span><select value={stocktakeFoundDraft.category} onChange={(event) => { setStocktakeFoundDraft((current) => ({ ...current, category: event.target.value, size: '' })); setStocktakeFoundSizes([]); setStocktakeFoundNewFields((current) => ({ ...current, size: false })); setStocktakeFoundCustom((current) => ({ ...current, size: '' })) }}><option value="adult">Взрослый</option><option value="child">Детский</option></select></label>
                                  <label><span>Пол</span><select value={stocktakeFoundDraft.gender} onChange={(event) => setStocktakeFoundDraft((current) => ({ ...current, gender: event.target.value }))}><option value="">Выберите</option><option value="ЖЕН">ЖЕН</option><option value="МУЖ">МУЖ</option></select></label>
                                  <div className="stocktake-reference-choice">
                                    <label><span>Цвет</span><select value={stocktakeFoundDraft.color} disabled={Boolean(stocktakeFoundNewFields.color)} onChange={(event) => setStocktakeFoundDraft((current) => ({ ...current, color: event.target.value }))}><option value="">Выберите из справочника</option>{(suggestionValues.colors || []).map((value: string) => <option key={`stocktake-found-color-${value}`} value={value}>{value}</option>)}</select></label>
                                    <button className="ghost compact stocktake-new-reference-toggle" type="button" onClick={() => { setStocktakeFoundNewFields((current) => ({ ...current, color: !current.color })); setStocktakeFoundCustom((current) => ({ ...current, color: '' })) }}>{stocktakeFoundNewFields.color ? 'Выбрать из справочника' : 'Нет в списке'}</button>
                                    {stocktakeFoundNewFields.color ? <label className="stocktake-new-reference-field"><span>Новый цвет</span><input value={stocktakeFoundCustom.color} onChange={(event) => setStocktakeFoundCustom((current) => ({ ...current, color: event.target.value }))} placeholder="Например: РАДУГА" /></label> : null}
                                  </div>
                                  <div className="stocktake-reference-choice stocktake-size-multi-choice">
                                    <div className="stocktake-size-multi-head"><span>{stocktakeFoundDraft.category === 'child' ? 'Какие возраста нашли?' : 'Какие размеры нашли?'}</span><strong>{stocktakeFoundSizes.length ? `Выбрано: ${stocktakeFoundSizes.length}` : 'Выберите один или несколько'}</strong></div>
                                    <div className="stocktake-size-pills">{(stocktakeFoundDraft.category === 'child' ? suggestionValues.childAges : suggestionValues.sizes || []).map((value: string) => { const selected = stocktakeFoundSizes.includes(value); return <button key={`stocktake-found-size-${value}`} type="button" className={selected ? 'is-selected' : ''} onClick={() => setStocktakeFoundSizes((current) => selected ? current.filter((item) => item !== value) : [...current, value])}>{value}</button> })}</div>
                                    <button className="ghost compact stocktake-new-reference-toggle" type="button" onClick={() => { setStocktakeFoundNewFields((current) => ({ ...current, size: !current.size })); setStocktakeFoundCustom((current) => ({ ...current, size: '' })) }}>{stocktakeFoundNewFields.size ? 'Убрать новое значение' : stocktakeFoundDraft.category === 'child' ? 'Нет нужного возраста' : 'Нет нужного размера'}</button>
                                    {stocktakeFoundNewFields.size ? <label className="stocktake-new-reference-field"><span>{stocktakeFoundDraft.category === 'child' ? 'Новый возраст' : 'Новый размер'}</span><input value={stocktakeFoundCustom.size} onChange={(event) => setStocktakeFoundCustom((current) => ({ ...current, size: event.target.value }))} placeholder={stocktakeFoundDraft.category === 'child' ? 'Например: 9' : 'Например: 58'} /><small>Новое значение будет добавлено только после отдельного подтверждения.</small></label> : null}
                                  </div>
                                </div>
                              )}
    
                              <div className="stocktake-found-actions stocktake-found-actions-human">
                                <button className="primary" type="button" disabled={!stocktakeFoundProductId || !stocktakeReferenceReady || stocktakeAddingVariantId !== 0} onClick={() => void addStocktakeNewCombination()}>{stocktakeAddingVariantId === -1 ? 'Добавляю…' : `Добавить ${stocktakeFoundSizes.length + (stocktakeFoundNewFields.size && stocktakeFoundCustom.size.trim() ? 1 : 0) || ''} ${stocktakeFoundSizes.length + (stocktakeFoundNewFields.size && stocktakeFoundCustom.size.trim() ? 1 : 0) === 1 ? 'позицию' : 'позиций'} в ревизию`}</button>
                                <span>Это не «Приход» и не ручное изменение остатка. Позиция лишь появляется в текущем листе, после чего вы вводите фактическое количество.</span>
                              </div>
                              </section>
                            </div> : null}
    
                            <div className="stocktake-e-footer stocktake-e-footer-v4">
                              <div><strong>{stocktakeReadyForReview ? 'Все позиции заполнены' : stocktakeProgress.recount ? `Повторно проверить: ${stocktakeProgress.recount}` : `Осталось: ${stocktakeProgress.unfilled}`}</strong><span>Статус и кнопка завершения всегда видны в верхней панели.</span></div>
                              {!stocktakeReadyForReview ? <button className="secondary" type="button" onClick={goToNextUnfilledStocktakeProduct}>К следующей требующей внимания</button> : null}
                            </div>
                          </>
                        ) : (
                          <section className="stocktake-e-review">
                            <div className="stocktake-e-review-head">
                              <div><span className="stocktake-step-kicker">Проверка перед применением</span><h4>{stocktakeReviewRows.length ? `${stocktakeReviewRows.length} позиций требуют внимания` : 'Расхождений нет'}</h4><p>Система показывает учётное количество только после завершения слепого пересчёта.</p></div>
                              <button className="secondary compact stocktake-review-back" type="button" onClick={() => setStocktakeReviewMode(false)}>← Вернуться к подсчёту</button>
                            </div>
    
                            {stocktakeReviewRows.length ? (
                              <div className="stocktake-e-review-list">
                                {stocktakeReviewRows.map((row: any) => {
                                  const fact = Number(stocktakeFacts[String(row.id)] || 0)
                                  const baseline = Number(row.baselineQuantity || 0)
                                  const reserved = Number(row.reservedQuantity || 0)
                                  const difference = fact - baseline
                                  const freeAfter = fact - reserved
                                  return (
                                    <article className={`stocktake-e-review-row ${freeAfter < 0 ? 'has-shortage' : ''}`} key={`stocktake-review-${row.id}`}>
                                      <div className="stocktake-e-review-name"><strong>{row.productName}</strong><span>{[stocktakePositionLabel(row), row.color, row.size].filter(Boolean).join(' · ')}</span></div>
                                      <div className="stocktake-e-review-number"><span>По системе</span><strong>{baseline}</strong></div>
                                      <div className="stocktake-e-review-number"><span>Насчитали</span><strong>{fact}</strong></div>
                                      <div className={`stocktake-e-review-number ${difference ? 'changed' : ''}`}><span>Разница</span><strong>{difference > 0 ? `+${difference}` : difference}</strong></div>
                                      <div className="stocktake-e-review-orders"><span>В заказах {reserved}</span>{freeAfter < 0 ? <strong>Не хватает {Math.abs(freeAfter)}</strong> : <strong>Свободно {freeAfter}</strong>}{reserved > 0 ? <button type="button" className="inventory-reservation-link" onClick={() => void openStocktakeOrders(row)}>Посмотреть заказы →</button> : null}</div>
                                    </article>
                                  )
                                })}
                              </div>
                            ) : <div className="stocktake-review-empty">Фактическое количество совпало с учётом по всем позициям.</div>}
    
                            <div className="stocktake-e-review-actions">
                              <div><strong>{stocktakeSourceTitle(stocktakeSession.source)} · проверено {stocktakeProgress.total} позиций</strong><span>Перед применением система ещё раз проверит, не изменился ли физический остаток после вашего подсчёта. Ничего не будет применено частично.</span></div>
                              <button className="primary stocktake-finish-button" type="button" disabled={stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} onClick={() => void applyStocktake()}>{stocktakeBusy ? 'Проверяю и сохраняю…' : stocktakeProgress.differences ? `Применить ${stocktakeProgress.differences} изменений` : 'Завершить проверку'}</button>
                            </div>
                          </section>
                        )}
    
                        <div id="inventoryStocktakePrint" className="stocktake-paper-document" aria-hidden="true">
                          <div className="stocktake-paper-title"><div><h2>Ревизия: {stocktakeSourceTitle(stocktakeSession.source)}</h2><p>Сессия {stocktakeSession.id} · начата {formatStocktakeMoment(stocktakeSession.startedAt)}</p></div><div className="stocktake-paper-signature">Пересчитал(а): ____________________</div></div>
                          <div className="stocktake-paper-note">Печатный лист относится к этой же ревизии в системе. Посчитайте всё физически находящееся в точке, включая отложенные заказы. Учётные числа специально не печатаются.</div>
                          {stocktakeGroups.map((group: any) => (
                            <section className="stocktake-paper-product" key={`stocktake-paper-${group.key}`}>
                              <div className="stocktake-paper-product-title"><h2>{group.productName}</h2></div>
                              {(() => {
                                const positions = new Map<string, any>()
                                for (const row of group.rows || []) {
                                  const key = stocktakePositionKey(row)
                                  const current = positions.get(key) || { key, label: stocktakePositionLabel(row), rows: [] }
                                  current.rows.push(row)
                                  positions.set(key, current)
                                }
                                return Array.from(positions.values()).map((position: any) => (
                                  <div className="stocktake-paper-position" key={`${group.key}-${position.key}`}>
                                    <h3>{position.label}</h3>
                                    <table><thead><tr><th className="paper-no">№</th><th>Размер / возраст</th><th>Цвет</th><th className="paper-fact">Факт</th><th className="paper-comment">Примечание</th></tr></thead><tbody>{position.rows.map((row: any) => <tr key={`paper-${row.id}`}><td>{String(row.rowNumber).padStart(3, '0')}</td><td>{row.size || '—'}</td><td>{row.color || '—'}</td><td /><td /></tr>)}</tbody></table>
                                  </div>
                                ))
                              })()}
                            </section>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
  )
}
