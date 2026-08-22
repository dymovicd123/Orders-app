import type { InventoryRenderContext } from './types'

type PanelContext = Pick<InventoryRenderContext,
  | 'formatHistoryMoment'
  | 'historyBusy'
  | 'historyCheckLabel'
  | 'historyCheckRows'
  | 'historyDisplayRows'
  | 'historyError'
  | 'historyHasMore'
  | 'historyMode'
  | 'historyQuery'
  | 'historyRows'
  | 'historyStocktakeDetail'
  | 'historyStocktakeDetailBusy'
  | 'historyVariantFilter'
  | 'inventoryMovementHumanLabel'
  | 'inventoryPanelStyle'
  | 'isAdmin'
  | 'loadHistoryChecks'
  | 'loadHistoryMovements'
  | 'openHistoryStocktake'
  | 'openInventoryPanel'
  | 'reverseInventoryMovement'
  | 'reversingInventoryMovementId'
  | 'setHistoryMode'
  | 'setHistoryQuery'
  | 'setHistoryVariantFilter'
  | 'sourceLabel'
>


export function renderInventoryHistoryPanel(ctx: PanelContext) {
  const {
    formatHistoryMoment,
    historyBusy,
    historyCheckLabel,
    historyCheckRows,
    historyDisplayRows,
    historyError,
    historyHasMore,
    historyMode,
    historyQuery,
    historyRows,
    historyStocktakeDetail,
    historyStocktakeDetailBusy,
    historyVariantFilter,
    inventoryMovementHumanLabel,
    inventoryPanelStyle,
    isAdmin,
    loadHistoryChecks,
    loadHistoryMovements,
    openHistoryStocktake,
    openInventoryPanel,
    reverseInventoryMovement,
    reversingInventoryMovementId,
    setHistoryMode,
    setHistoryQuery,
    setHistoryVariantFilter,
    sourceLabel
  } = ctx

  return (
    <div className="inventory-history-panel inventory-history-human history-cards-panel" style={inventoryPanelStyle('history')}>
                    <div className="inventory-panel-headline">
                      <div>
                        <h3>История склада</h3>
                        <p>Движения товара и физические проверки разделены. Для конкретной позиции показывается вся сохранённая история, а не только последние операции.</p>
                      </div>
                      <div className="inventory-history-actions">
                        {historyVariantFilter ? <button className="human-history-filter" type="button" onClick={() => setHistoryVariantFilter(null)}>Одна позиция · Сбросить ×</button> : null}
                        <button className="secondary compact" type="button" onClick={() => historyMode === 'movements' ? void loadHistoryMovements(true) : void loadHistoryChecks()} disabled={historyBusy}>Обновить</button>
                        {isAdmin ? <button className="link-button inventory-service-link" type="button" onClick={() => openInventoryPanel('settings')}>Сервис и диагностика</button> : null}
                      </div>
                    </div>
    
                    <div className="history-mode-switch" role="tablist" aria-label="Вид истории склада">
                      <button type="button" className={`secondary compact ${historyMode === 'movements' ? 'is-active' : ''}`} onClick={() => setHistoryMode('movements')}>Движения</button>
                      <button type="button" className={`secondary compact ${historyMode === 'checks' ? 'is-active' : ''}`} onClick={() => setHistoryMode('checks')}>Ревизии и сверки</button>
                    </div>
    
                    {historyMode === 'movements' ? (
                      <>
                        <div className="history-filter-bar inventory-history-filter-bar">
                          <label className="history-search-field"><span>Поиск</span><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Товар, характеристика, комментарий, TR-…" /></label>
                          <button className="primary compact history-filter-submit" type="button" disabled={historyBusy} onClick={() => void loadHistoryMovements(true)}>Найти</button>
                        </div>
                        {historyError ? <div className="history-load-state is-error"><strong>Не удалось загрузить историю склада.</strong><span>{historyError}</span><button className="secondary compact" type="button" onClick={() => void loadHistoryMovements(true)}>Повторить</button></div>
                        : historyBusy && !historyRows.length ? <div className="history-load-state"><strong>Загружаю движения…</strong></div>
                        : historyDisplayRows.length ? <div className="history-card-list inventory-history-card-list">
                          {historyDisplayRows.map((entry: any) => entry.kind === 'transfer' ? (
                            <details className={`history-card inventory-transfer-history-card ${entry.row.transferStatus === 'reversed' ? 'is-cancelled' : ''}`} key={`transfer-${entry.row.referenceId}`}>
                              <summary>
                                <div className="history-card-date"><strong>{formatHistoryMoment(entry.row.createdAt)}</strong><span>Перемещение</span></div>
                                <div className="history-card-main"><strong>{entry.row.referenceId || 'Перемещение'}</strong><span>{sourceLabel(entry.row.transferFromSource)} → {sourceLabel(entry.row.transferToSource)}</span></div>
                                <div className="history-card-amount"><strong>{entry.row.transferTotalQuantity || entry.totalQuantity} шт.</strong><span>{entry.row.transferItemCount || entry.variantCount} позиций</span></div>
                                <span className={`status-pill ${entry.row.transferStatus === 'reversed' ? 'status-offline' : 'status-online'}`}>{entry.row.transferStatus === 'reversed' ? 'Отменено' : 'Проведено'}</span>
                                <span className="history-card-open">Подробнее</span>
                              </summary>
                              <div className="history-card-body">
                                {entry.row.transferComment || entry.row.comment ? <div className="history-note"><span>Комментарий</span><strong>{entry.row.transferComment || entry.row.comment}</strong></div> : null}
                                <div className="history-product-stack">{entry.rows.filter((row: any) => row.referenceType === 'transfer_out').map((row: any) => <div className="history-product-card" key={`tr-line-${row.id}`}><strong>{row.productName} · {Math.abs(Number(row.quantityDelta || 0))} шт.</strong><span>{[row.color, row.size, row.material, row.length, row.gender].filter(Boolean).join(' · ') || 'Без характеристик'}</span></div>)}</div>
                              </div>
                            </details>
                          ) : (
                            <details className={`history-card inventory-movement-card ${entry.row.reversedAt ? 'is-cancelled' : ''}`} key={`movement-${entry.row.id}`}>
                              <summary>
                                <div className="history-card-date"><strong>{formatHistoryMoment(entry.row.createdAt)}</strong><span>{sourceLabel(entry.row.inventorySource)}</span></div>
                                <div className="history-card-main"><strong>{inventoryMovementHumanLabel(entry.row)}</strong><span>{entry.row.productName}</span></div>
                                <div className="history-card-amount"><strong className={entry.row.quantityDelta < 0 ? 'text-danger' : 'text-success'}>{entry.row.quantityDelta >= 0 ? '+' : ''}{entry.row.quantityDelta}</strong><span>После: {entry.row.quantityAfter}</span></div>
                                {entry.row.reversedAt ? <span className="status-pill status-offline">Отменено</span> : <span className="status-pill status-online">Проведено</span>}
                                <span className="history-card-open">Подробнее</span>
                              </summary>
                              <div className="history-card-body">
                                <div className="history-product-card"><strong>{entry.row.productName}</strong><span>{[entry.row.color, entry.row.size, entry.row.material, entry.row.length, entry.row.gender].filter(Boolean).join(' · ') || 'Без характеристик'}</span></div>
                                {entry.row.comment ? <div className="history-note"><span>Комментарий</span><strong>{entry.row.comment}</strong></div> : null}
                                <div className="history-card-actions">{entry.row.canReverse && isAdmin ? <button className="secondary compact danger-outline" type="button" disabled={reversingInventoryMovementId !== null} onClick={() => void reverseInventoryMovement(entry.row)}>{reversingInventoryMovementId === entry.row.id ? 'Отменяю…' : 'Отменить операцию'}</button> : null}</div>
                              </div>
                            </details>
                          ))}
                          {historyHasMore ? <button className="secondary history-load-more" type="button" disabled={historyBusy} onClick={() => void loadHistoryMovements(false)}>{historyBusy ? 'Загружаю…' : 'Показать ещё'}</button> : null}
                        </div> : <div className="history-load-state"><strong>Движений по выбранным условиям нет.</strong><span>Это нормальный пустой результат, а не потерянная история.</span></div>}
                      </>
                    ) : (
                      historyError ? <div className="history-load-state is-error"><strong>Не удалось загрузить ревизии и сверки.</strong><span>{historyError}</span><button className="secondary compact" type="button" onClick={() => void loadHistoryChecks()}>Повторить</button></div>
                      : historyBusy && !historyCheckRows.length ? <div className="history-load-state"><strong>Загружаю ревизии и сверки…</strong></div>
                      : historyCheckRows.length ? <div className="history-card-list inventory-check-history-list">{historyCheckRows.map((row: any) => (
                        <article className="history-card inventory-check-history-card" key={`check-${row.kind}-${row.id}`}>
                          <div className="history-check-main">
                            <div className="history-card-date"><strong>{formatHistoryMoment(row.checkedAt)}</strong><span>{sourceLabel(row.source)}</span></div>
                            <div className="history-card-main"><strong>{historyCheckLabel(row)}</strong><span>{row.expectedQuantity !== undefined ? `По системе ${row.expectedQuantity} → фактически ${row.countedQuantity}` : `${row.itemCount} позиций · расхождений ${row.differenceCount}`}</span></div>
                            <div className="history-card-amount"><strong>{row.netDelta > 0 ? '+' : ''}{row.netDelta}</strong><span>{row.expectedQuantity !== undefined ? 'разница' : 'изменение количества'}</span></div>
                            {row.checkedBy ? <span className="soft-badge">{row.checkedBy}</span> : null}
                          </div>
                          {row.kind === 'stocktake' ? <button className="secondary compact" type="button" disabled={historyStocktakeDetailBusy} onClick={() => void openHistoryStocktake(row.referenceId)}>{historyStocktakeDetail?.id === row.referenceId ? 'Детали открыты' : 'Расхождения'}</button> : null}
                          {historyStocktakeDetail?.id === row.referenceId ? <div className="history-stocktake-detail"><div className="history-summary-line"><span>Проверено: <strong>{historyStocktakeDetail.totalItems}</strong></span><span>Расхождений: <strong>{historyStocktakeDetail.items.filter((item: any) => item.countedQuantity !== null && Number(item.countedQuantity) !== Number(item.baselineQuantity)).length}</strong></span></div><div className="history-product-stack">{historyStocktakeDetail.items.filter((item: any) => item.countedQuantity !== null && Number(item.countedQuantity) !== Number(item.baselineQuantity)).slice(0, 80).map((item: any) => <div className="history-product-card" key={`stocktake-detail-${item.id}`}><strong>{item.productName}</strong><span>{[item.color, item.size, item.material, item.length, item.gender].filter(Boolean).join(' · ')}</span><em>{item.baselineQuantity} → {item.countedQuantity}</em></div>)}</div>{!historyStocktakeDetail.items.some((item: any) => item.countedQuantity !== null && Number(item.countedQuantity) !== Number(item.baselineQuantity)) ? <div className="empty-state compact-empty">Все позиции совпали с учётом.</div> : null}</div> : null}
                        </article>
                      ))}</div> : <div className="history-load-state"><strong>Завершённых ревизий и сверок пока нет.</strong></div>
                    )}
                  </div>
  )
}
