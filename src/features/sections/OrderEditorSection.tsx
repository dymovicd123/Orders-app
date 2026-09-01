// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrderEditorSection({ ctx }: { ctx: SectionContext }) {
  const {
    addEditorItem,
    addEditorPayment,
    applyEditorProductPick,
    ChoicePills,
    closeOrderEditor,
    createEditorDraft,
    editorDraft,
    editorFormRef,
    editorOpen,
    editorReturnSector,
    formatMoney,
    formatOrderItemTitle,
    FriendlyNumberInput,
    isAdmin,
    isArchivedOrderRecord,
    ManagerPicker,
    normalizeAudienceTypeValue,
    normalizeSuggestion,
    orderPanelStyle,
    references,
    removeEditorItem,
    removeEditorPayment,
    renderOrderSizeSelect,
    renderOrderSourceAvailability,
    saveEditorPayment,
    saveSelectedOrder,
    savingOrder,
    sectorStyle,
    selectedOrder,
    setEditorDraft,
    SmartPickerInput,
    sourceLabel,
    statusLabelByState,
    suggestionValues,
    updateEditorDraft,
    updateEditorItem,
    updateEditorPayment,
  } = ctx

  return (
    <article
              className="card wide sector-orders"
              id="editor"
              ref={editorFormRef}
              style={{ ...sectorStyle('orders'), ...orderPanelStyle('edit'), display: selectedOrder && !isArchivedOrderRecord(selectedOrder) && editorDraft && editorOpen && (isAdmin || (selectedOrder.order_status === 'active' && selectedOrder.shipping_status !== 'sent')) ? undefined : 'none' }}
            >
              <div className="card-label">Редактирование заказа</div>
              <div className="actions form-top-actions">
                <button
                  className="secondary compact back-action"
                  type="button"
                  onClick={closeOrderEditor}
                  disabled={savingOrder}
                >
                  {editorReturnSector === 'workshop' ? 'Назад в цех' : 'Назад к таблице'}
                </button>
              </div>
              {selectedOrder && editorDraft ? (
                <>
                  <div className="card-meta">
                    Можно быстро исправить данные выбранного заказа. Оплаты и товары подставляются из базы и сохраняются безопасно; отправка, удаление и статусы Цеха меняются отдельными штатными действиями.
                  </div>
    
                  <div className="editor-summary">
                    <div className="editor-summary-head">
                      <div>
                        <strong>{selectedOrder.external_id}</strong>
                        <span>{selectedOrder.order_date} · {selectedOrder.manager_name || '—'} · {sourceLabel(selectedOrder.source_type)}</span>
                      </div>
                      <span className={`status-pill status-${selectedOrder.order_status}-${selectedOrder.workshop_status}`}>
                        {statusLabelByState(
                          selectedOrder.order_status,
                          selectedOrder.workshop_status,
                          selectedOrder.debt_amount,
                          selectedOrder.received_amount,
                          selectedOrder.return_amount,
                        )}
                      </span>
                    </div>
                    <div className="editor-summary-grid">
                      <div>
                        <span>Товары</span>
                        <strong>{editorDraft.items.length}</strong>
                      </div>
                      <div>
                        <span>Оплаты</span>
                        <strong>{editorDraft.payments.filter((payment) => String(payment.method || '').trim() && Number(payment.amount || 0) > 0).length}</strong>
                      </div>
                      <div>
                        <span>Получено</span>
                        <strong>{formatMoney(selectedOrder.received_amount)}</strong>
                      </div>
                      <div>
                        <span>Долг</span>
                        <strong>{formatMoney(selectedOrder.debt_amount)}</strong>
                      </div>
                    </div>
                  </div>
    
                  <div className="form-grid edit-grid">
                    <label>
                      <span>Дата</span>
                      <input
                        type="date"
                        value={editorDraft.orderDate}
                        onChange={(event) => updateEditorDraft('orderDate', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Менеджер</span>
                      <ManagerPicker
                        valueId={editorDraft.managerId}
                        valueName={editorDraft.managerName}
                        options={references?.managerOptions || []}
                        onChange={(manager) => setEditorDraft((draft) => draft ? ({ ...draft, managerId: manager?.id || 0, managerName: manager?.name || '' }) : draft)}
                      />
                    </label>
                    <label>
                      <span>Город</span>
                      <SmartPickerInput
                        value={editorDraft.city}
                        onChange={(value) => updateEditorDraft('city', value)}
                        placeholder="Город"
                        options={suggestionValues.cities}
                      />
                    </label>
                    <label>
                      <span>Телефон</span>
                      <input
                        value={editorDraft.customerPhone}
                        onChange={(event) => updateEditorDraft('customerPhone', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Имя клиента</span>
                      <input
                        value={editorDraft.customerName}
                        onChange={(event) => updateEditorDraft('customerName', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Доставка</span>
                      <SmartPickerInput
                        value={editorDraft.deliveryType}
                        onChange={(value) => updateEditorDraft('deliveryType', value)}
                        placeholder="Выберите доставку"
                        options={suggestionValues.deliveryTypes}
                      />
                    </label>
                    <label>
                      <span>Цена заказа</span>
                      <FriendlyNumberInput
                        type="number"
                        min="0"
                        value={editorDraft.orderTotal}
                        onChange={(event) => updateEditorDraft('orderTotal', event.target.value)}
                        placeholder="Общая сумма заказа"
                      />
                    </label>
                    <label>
                      <span>Цех</span>
                      <select
                        value={editorDraft.workshopStatus}
                        disabled={!isAdmin || savingOrder}
                        onChange={(event) =>
                          updateEditorDraft(
                            'workshopStatus',
                            event.target.value as EditorDraft['workshopStatus'],
                          )
                        }
                      >
                        <option value="in_workshop">В работе</option>
                        <option value="ready">Готово</option>
                        <option value="shipped">Отгружен</option>
                        <option value="cancelled">Отменён</option>
                      </select>
                    </label>
                    <label>
                      <span>Статус</span>
                      <select
                        value={editorDraft.orderStatus}
                        disabled={!isAdmin || savingOrder}
                        onChange={(event) =>
                          updateEditorDraft('orderStatus', event.target.value as EditorDraft['orderStatus'])
                        }
                      >
                        <option value="active">Активен</option>
                        <option value="closed">Закрыт</option>
                        <option value="deleted">Удалён</option>
                      </select>
                    </label>
                    <label className="wide-field">
                      <span>Комментарий</span>
                      <input
                        value={editorDraft.comment}
                        onChange={(event) => updateEditorDraft('comment', event.target.value)}
                      />
                    </label>
                  </div>
    
                  <div className="editor-columns">
                    <section className="mini-panel">
                      <div className="mini-panel-head">
                        <h3>Товары</h3>
                        <button className="secondary compact" type="button" onClick={addEditorItem}>
                          + Товар
                        </button>
                      </div>
                      <div className="stack">
                        {editorDraft.items.map((item, index) => (
                          <div className="mini-item" key={`edit-item-${index}`}>
                            <div className="mini-item-head">
                              <div className="mini-item-head-main">
                                <strong>Позиция {index + 1}</strong>
                                <span className="mini-item-summary">
                                  {formatOrderItemTitle(item) || 'Проверьте состав позиции'}
                                </span>
                              </div>
                              <button className="ghost danger compact" type="button" onClick={() => removeEditorItem(index)}>
                                Удалить
                              </button>
                            </div>
                            <div className="subgrid">
                              <label>
                                <span>Товар</span>
                                <SmartPickerInput
                                  value={item.productName}
                                  onChange={(value) => updateEditorItem(index, 'productName', value)}
                                  onPick={(value) => applyEditorProductPick(index, value)}
                                  placeholder="Начните вводить товар"
                                  options={suggestionValues.products}
                                />
                              </label>
                              <div className="field-block">
                                <span>Тип</span>
                                <ChoicePills
                                  value={normalizeAudienceTypeValue(item.audienceType)}
                                  onChange={(value) => updateEditorItem(index, 'audienceType', value)}
                                  options={[
                                    { value: 'ВЗРОСЛЫЙ', label: 'Взрослый' },
                                    { value: 'ДЕТСКИЙ', label: 'Детский' },
                                  ]}
                                />
                              </div>
                              <div className="field-block">
                                <span>Пол</span>
                                <ChoicePills
                                  value={item.gender || ''}
                                  onChange={(value) => updateEditorItem(index, 'gender', value)}
                                  options={[
                                    { value: '', label: 'Не указан' },
                                    { value: 'ЖЕН', label: 'Жен' },
                                    { value: 'МУЖ', label: 'Муж' },
                                  ]}
                                />
                              </div>
                              <label>
                                <span>Цвет</span>
                                <SmartPickerInput
                                  value={item.color || ''}
                                  onChange={(value) => updateEditorItem(index, 'color', value)}
                                  placeholder="Цвет"
                                  options={suggestionValues.colors}
                                />
                              </label>
                              <label>
                                <span>Материал</span>
                                <SmartPickerInput
                                  value={item.material || ''}
                                  onChange={(value) => updateEditorItem(index, 'material', value)}
                                  placeholder="Материал"
                                  options={suggestionValues.materials}
                                />
                              </label>
                              <label>
                                <span>Длина</span>
                                <SmartPickerInput
                                  value={item.length || ''}
                                  onChange={(value) => updateEditorItem(index, 'length', value)}
                                  placeholder="Длина"
                                  options={suggestionValues.lengths}
                                />
                              </label>
                              <label>
                                <span>{normalizeAudienceTypeValue(item.audienceType) === 'ДЕТСКИЙ' ? 'Возраст' : 'Размер'}</span>
                                {renderOrderSizeSelect(item, index, updateEditorItem, 'edit')}
                              </label>
                              <label>
                                <span>Кол-во</span>
                                <FriendlyNumberInput
                                  type="number"
                                  min="1"
                                  value={item.quantity ?? 1}
                                  onChange={(event) => updateEditorItem(index, 'quantity', Number(event.target.value))}
                                />
                              </label>
                              <label>
                                <span>Источник</span>
                                <select
                                  value={item.sourceType || 'warehouse'}
                                  onChange={(event) => updateEditorItem(index, 'sourceType', event.target.value)}
                                >
                                  <option value="warehouse">Склад</option>
                                  <option value="boutique">Бутик</option>
                                  <option value="workshop">Цех</option>
                                </select>
                              </label>
                              {normalizeSuggestion(item.sourceType) === 'WORKSHOP' && Number(item.quantity || 0) > 0 ? (
                                <>
                                  <label className="wide-field">
                                    <span>Комментарий для цеха</span>
                                    <input
                                      value={item.workshopComment || ''}
                                      onChange={(event) => updateEditorItem(index, 'workshopComment', event.target.value)}
                                      placeholder="Что нужно передать в цех"
                                    />
                                    <small>Комментарий не делает позицию срочной. Срочность выбирается отдельно ниже.</small>
                                  </label>
                                  <label className="workshop-urgent-editor">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(item.workshopUrgent)}
                                      onChange={(event) => updateEditorItem(index, 'workshopUrgent', event.target.checked)}
                                    />
                                    <span>Срочно для цеха</span>
                                  </label>
                                  {item.workshopUrgent ? (
                                    <label>
                                      <span>Нужно до</span>
                                      <input
                                        type="date"
                                        value={item.workshopDueDate || ''}
                                        onChange={(event) => updateEditorItem(index, 'workshopDueDate', event.target.value)}
                                      />
                                    </label>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                            {renderOrderSourceAvailability(item, `edit-item-${index}`, index, 'edit')}
                          </div>
                        ))}
                      </div>
                    </section>
    
                    <section className="mini-panel">
                      <div className="mini-panel-head">
                        <h3>Оплаты</h3>
                        <div className="actions">
                          <button className="secondary compact" type="button" onClick={() => addEditorPayment('primary')} disabled={savingOrder}>
                            + Первичная оплата
                          </button>
                          <button className="secondary compact" type="button" onClick={() => addEditorPayment('debt_close')} disabled={savingOrder}>
                            + Закрытие долга
                          </button>
                        </div>
                      </div>
                      <p className="mini-panel-note">
                        Если первичную оплату забыли внести, добавьте её явно — она всегда относится к дате заказа. Любая обычная оплата позже создания заказа оформляется как «Закрытие долга» и проходит через тот же серверный механизм, что и отдельная кнопка закрытия долга. У уже проведённой оплаты можно исправить способ оплаты; сумма, дата и смысл операции останутся прежними, а исправление сохранится в денежной истории.
                      </p>
                      <div className="stack">
                        {editorDraft.payments.map((payment, index) => (
                          <div className="mini-item" key={`edit-payment-${payment.id || payment.draftKey || index}`}>
                            <div className="mini-item-head">
                              <strong>Оплата {index + 1}</strong>
                              {payment.id ? (
                                <span className="soft-badge">Проведена</span>
                              ) : (
                                <button className="ghost danger compact" type="button" onClick={() => removeEditorPayment(index)} disabled={savingOrder}>
                                  Удалить черновик
                                </button>
                              )}
                            </div>
                            <div className="subgrid">
                              <label>
                                <span>Дата</span>
                                <input
                                  type="date"
                                  value={payment.paymentDate}
                                  disabled={Boolean(payment.id) || savingOrder || payment.paymentKind === 'primary'}
                                  onChange={(event) => updateEditorPayment(index, 'paymentDate', event.target.value)}
                                />
                              </label>
                              <label>
                                <span>Смысл оплаты</span>
                                <select
                                  value={payment.paymentKind || 'primary'}
                                  disabled={Boolean(payment.id) || savingOrder}
                                  onChange={(event) => updateEditorPayment(index, 'paymentKind', event.target.value)}
                                >
                                  <option value="primary">Первичная оплата</option>
                                  <option value="debt_close">Закрытие долга</option>
                                </select>
                              </label>
                              <label>
                                <span>Способ</span>
                                <SmartPickerInput
                                  value={payment.method || ''}
                                  onChange={(value) => updateEditorPayment(index, 'method', value)}
                                  placeholder="Выберите способ"
                                  options={suggestionValues.paymentMethods}
                                  disabled={savingOrder}
                                />
                              </label>
                              <label>
                                <span>Сумма</span>
                                <FriendlyNumberInput
                                  type="number"
                                  min="0"
                                  value={payment.amount ?? 0}
                                  disabled={Boolean(payment.id) || savingOrder}
                                  onChange={(event) => updateEditorPayment(index, 'amount', Number(event.target.value))}
                                />
                              </label>
                              <label className="wide-field">
                                <span>Комментарий</span>
                                <input
                                  value={payment.comment || ''}
                                  disabled={Boolean(payment.id) || savingOrder}
                                  onChange={(event) => updateEditorPayment(index, 'comment', event.target.value)}
                                />
                              </label>
                            </div>
                            {payment.id ? (
                              <p className="mini-panel-note">Оплата уже проведена. Здесь можно исправить только способ оплаты; сумма, дата и тип операции не меняются.</p>
                            ) : (
                              <div className="actions">
                                <button className="primary compact" type="button" onClick={() => void saveEditorPayment(index)} disabled={savingOrder}>
                                  {savingOrder ? 'Провожу оплату…' : 'Провести оплату'}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                        {!editorDraft.payments.length ? <div className="empty-state">Оплат пока нет. Добавьте нужный вид операции одной из кнопок выше.</div> : null}
                      </div>
                    </section>
                  </div>
    
                  <div className="actions form-bottom-actions">
                    <button className="primary" type="button" onClick={saveSelectedOrder} disabled={savingOrder}>
                      {savingOrder ? 'Сохраняю...' : 'Сохранить изменения'}
                    </button>
                    <button className="secondary" type="button" onClick={() => selectedOrder && setEditorDraft(createEditorDraft(selectedOrder))}>
                      Сбросить форму
                    </button>
                    <button className="secondary back-action" type="button" onClick={closeOrderEditor} disabled={savingOrder}>
                      {editorReturnSector === 'workshop' ? 'Назад в цех' : 'Назад к таблице'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-state">Выберите заказ в таблице выше, чтобы открыть редактирование.</div>
              )}
            </article>
  )
}
