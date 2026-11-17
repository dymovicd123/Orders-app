// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useEffect, useState } from 'react'
import { OrderReturnV2Flow } from './OrderReturnV2Flow'
import '../../styles/194-return-smart-ux.css'
import '../inventory/views/warehouseReceiving.css'
type SectionContext = Record<string, any>

export function OrderReturnsSection({ ctx }: { ctx: SectionContext }) {
  const {
    cancelReturnEntry, closeReturnForm, formatMoney, ManagerBadge, managerColorFor,
    orderPanelStyle, returnBusy, returnFormRef, returnHistory, returnHistoryBusy,
    returnHistoryError, returnHistoryFilters, returnHistoryHasMore,
    returnHistorySummary, loadReturnPendingInbox, loadReturnHistory,
    returnSelectedOrder, refreshOrdersAfterReturn, receiveReturnedItemAction,
    reconcileKnownInventoryLifecycle, sectorStyle, setOrderPanel,
    canManageWarehouse, openWarehouseReceiving, setReturnHistoryFilters,
    SmartPickerInput, suggestionValues,
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

  const selectedId=Number(returnSelectedOrder?.id||0)
  const [activeView,setActiveView]=useState<'form'|'history'>('form')
  const [savedReturn,setSavedReturn]=useState<{returnId:number;cashRefund:number;remainingSale:number;intakePending:boolean}|null>(null)
  useEffect(()=>{
    if(!selectedId)return
    setSavedReturn(null)
    setActiveView('form')
    let secondFrame=0
    const firstFrame=requestAnimationFrame(()=>{
      secondFrame=requestAnimationFrame(()=>{
        const target=returnFormRef.current as HTMLElement|null
        if(!target||!target.getClientRects().length)return
        target.scrollIntoView({behavior:'smooth',block:'start'})
        const heading=target.querySelector<HTMLElement>('[data-return-form-title]')
        if(heading)heading.focus({preventScroll:true})
        else target.focus({preventScroll:true})
      })
    })
    return ()=>{cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame)}
  },[selectedId,returnFormRef])
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
    if (item.contractOnly) return item.contractAction === 'cancel_workshop_obligation'
      ? 'Клиент отказался · задание и расчёт с цехом сохранены'
      : item.contractAction === 'cancel_unshipped_reservation'
        ? 'Не отправляли · резерв освобождён · без прихода на склад'
        : item.contractAction === 'cancel_unresolved_reservation'
          ? 'Не отправляли · неразрешённый резерв закрыт · без прихода'
          : 'Исключено из покупки · без физической приёмки'
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

  return (
    <article className="card wide sector-orders" id="order-returns" style={{ ...sectorStyle('orders'), ...orderPanelStyle('returns') }}>
              
              <div className="card-label">Возвраты</div>
              <div className="card-meta">Оформление возврата и история операций остаются здесь. Физическая приёмка — в разделе «Склад → Приёмка товаров».</div>
              <div className="return-workspace-tabs" role="tablist" aria-label="Разделы возвратов">
                <button type="button" role="tab" aria-selected={activeView==='form'}
                  aria-controls="return-workspace-form" className={activeView==='form'?'is-active':''}
                  onClick={()=>{setActiveView('form');setSavedReturn(null)}}>
                  Оформление {selectedId?<>· заказ №{returnSelectedOrder?.external_id||selectedId}</>:null}
                </button>
                <button type="button" role="tab" aria-selected={activeView==='history'}
                  aria-controls="return-workspace-history" className={activeView==='history'?'is-active':''}
                  onClick={()=>setActiveView('history')}>История возвратов</button>
              </div>
              {savedReturn?<div className="return-workspace-success" role="status">
                <strong>Возврат №{savedReturn.returnId} проведён. Форма закрыта.</strong>
                <span>Клиенту выплачено {formatMoney(savedReturn.cashRefund)} ₸. В покупке осталось {formatMoney(savedReturn.remainingSale)} ₸.</span>
                {savedReturn.intakePending?<span>Ожидающие получения товары находятся в разделе «Склад → Приёмка товаров → Возвраты».</span>:null}
              </div>:null}
              <div className="warehouse-receiving-hint">
                <p>Физическое получение возвращённых товаров выполняет завсклад. Очередь и подтверждение приёмки перенесены в раздел «Склад».</p>
                {canManageWarehouse ? <button type="button" className="secondary compact"
                  onClick={() => openWarehouseReceiving('return')}>Перейти к приёмке возвратов</button> : null}
              </div>

              {activeView==='form'&&!returnSelectedOrder ? (
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
    
              <div id="return-workspace-form" role="tabpanel" ref={returnFormRef} className="return-form-v2-bridge"
                 tabIndex={-1} style={activeView==='form'?undefined:{display:'none'}}>
                <OrderReturnV2Flow
                  key={selectedId}
                  order={returnSelectedOrder}
                  formatMoney={formatMoney}
                  SmartPickerInput={SmartPickerInput}
                  paymentMethods={suggestionValues.paymentMethods}
                  onSaved={(posted)=>{
                    setSavedReturn({returnId:posted.returnId,cashRefund:posted.cashRefund,remainingSale:posted.remainingSale,intakePending:Boolean(posted.receipt?.receiptPending)})
                    closeReturnForm(false)
                    setActiveView('history')
                    void loadReturnHistory()
                    void loadReturnPendingInbox()
                    void refreshOrdersAfterReturn()
                  }}
                  onCancelled={()=>{void loadReturnHistory();void loadReturnPendingInbox();void refreshOrdersAfterReturn()}}
                  onBack={()=>closeReturnForm(true)}
                />
              </div>

              {activeView==='history'?<section id="return-workspace-history" role="tabpanel" className="mini-panel debt-history-panel history-cards-panel">
                <div className="mini-panel-head history-section-head">
                  <div>
                    <h3>История возвратов</h3>
                    <p className="mini-panel-note">Все проведённые и отменённые операции. Для приёмки товаров откройте отдельную вкладку.</p>
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
                          <div className="history-card-amount"><strong>{formatMoney(entry.amount)}</strong><span>{entry.items?.length
                                  ? `${entry.amount > 0 ? 'Товары и деньги' : 'Только товары'} · ${entry.items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)} шт.`
                                  : entry.amount > 0 ? 'Только деньги · товары не указаны' : 'Товары не указаны'}</span></div>
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
                                  <div className="return-history-intake-hint">
                                    <strong>Товар ещё не принят</strong>
                                    {canManageWarehouse ? <button type="button" className="secondary compact" onClick={() => openWarehouseReceiving('return')}>К приёмке на складе</button> : <span>Принимает завсклад · Склад → Приёмка товаров</span>}
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
                                      Завершить учёт
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
                            {!entry.items?.length ? <div className="history-product-card"><span>Товары в операции не указаны. Физический возврат не зафиксирован — это может быть возврат только денег. Не добавляйте товар в остаток без подтверждения.</span></div> : null}
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
                  <div className="history-load-state"><strong>Возвратов по выбранным условиям нет.</strong><span>Измените фильтры или проверьте другой период.</span></div>
                )}
              </section>:null}
            </article>
  )
}
