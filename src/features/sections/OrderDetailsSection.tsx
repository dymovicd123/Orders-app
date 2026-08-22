// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrderDetailsSection({ ctx }: { ctx: SectionContext }) {
  const {
    formatDateShort,
    formatMoney,
    formatOrderItemTitle,
    handleEditOrder,
    isAdmin,
    isArchivedOrderRecord,
    orderPanelStyle,
    restoreArchivedOrder,
    savingOrder,
    sectorStyle,
    selectedOrder,
    setSelectedWorkshopStatus,
    sourceLabel,
  } = ctx

  return (
    <article
              className="card wide sector-orders"
              id="details"
              style={{
                ...sectorStyle('orders'),
                ...orderPanelStyle('list'),
                display: 'none',
              }}
            >
              <div className="card-label">Детали заказа</div>
              {selectedOrder ? (
                <div className="details">
                  <div className="details-head">
                    <div>
                      <h2>{selectedOrder.external_id}</h2>
                      <p>{selectedOrder.order_date} · {selectedOrder.manager_name || '—'} · {sourceLabel(selectedOrder.source_type)}</p>
                    </div>
                    <div className="details-stats">
                      <span>Получено: {formatMoney(selectedOrder.received_amount)}</span>
                      <span>Долг: {formatMoney(selectedOrder.debt_amount)}</span>
                      <span>Возврат: {formatMoney(selectedOrder.return_amount)}</span>
                      <div className="details-actions">
                        {isAdmin && !isArchivedOrderRecord(selectedOrder) ? (
                          <button
                            className="secondary compact"
                            type="button"
                            onClick={() => handleEditOrder(selectedOrder)}
                          >
                            Редактировать заказ
                          </button>
                        ) : null}
                        <button
                          className="primary compact"
                          type="button"
                          onClick={() => void setSelectedWorkshopStatus('ready', selectedOrder)}
                          disabled={savingOrder || selectedOrder.workshop_status === 'ready' || isArchivedOrderRecord(selectedOrder)}
                        >
                          Готово
                        </button>
                      </div>
                    </div>
                  </div>
    
                  {isArchivedOrderRecord(selectedOrder) ? (
                    <div className="archive-readonly-note">
                      <strong>Архивный заказ · только просмотр.</strong>
                      <span>{selectedOrder.archive_reason || 'Заказ убран из активной работы, но участвует в истории и отчётах.'}</span>
                      {selectedOrder.archived_at ? <small>Архивирован: {formatDateShort(selectedOrder.archived_at)} · {selectedOrder.archived_by || 'admin'}</small> : null}
                      {isAdmin ? (
                        <button className="secondary compact" type="button" onClick={() => void restoreArchivedOrder(selectedOrder)} disabled={savingOrder}>
                          Вернуть из архива
                        </button>
                      ) : null}
                    </div>
                  ) : null}
    
                  <div className="details-grid">
                    <section>
                      <h3>Товары</h3>
                    {selectedOrder.items.length ? selectedOrder.items.map((item, index) => (
                      <div className="detail-row" key={`${selectedOrder.id}-item-${index}`}>
                        <strong>{formatOrderItemTitle(item) || item.productName}</strong>
                        <span>
                          {[item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'Без варианта'}
                        </span>
                        <small>{item.quantity} шт.</small>
                      </div>
                    )) : <p className="muted">Нет позиций.</p>}
                    </section>
    
                    <section>
                      <h3>Оплаты</h3>
                      {selectedOrder.payments.length ? selectedOrder.payments.map((payment, index) => (
                        <div className="detail-row" key={`${selectedOrder.id}-payment-${index}`}>
                          <strong>{payment.paymentDate}</strong>
                          <span>{payment.method}</span>
                          <small>
                            {payment.paymentKind === 'primary'
                              ? 'Первичная оплата'
                              : payment.paymentKind === 'debt_close'
                                ? 'Закрытие долга'
                                : 'Доплата'} · {formatMoney(payment.amount)}
                          </small>
                        </div>
                      )) : <p className="muted">Нет оплат.</p>}
                    </section>
    
                    <section>
                      <h3>Комментарий</h3>
                      <p className="comment-box">{selectedOrder.comment || '—'}</p>
                    </section>
                  </div>
                </div>
              ) : (
                <div className="empty-state">Выберите заказ в таблице выше, чтобы увидеть детали.</div>
              )}
            </article>
  )
}
