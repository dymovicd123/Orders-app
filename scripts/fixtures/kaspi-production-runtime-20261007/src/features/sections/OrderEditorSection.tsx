// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { projectOrderOperationalState } from '../../app/orderOperationalProjection'
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
    suggestionValues,
    updateEditorDraft,
    updateEditorItem,
    updateEditorPayment,
  } = ctx

  const projection = selectedOrder ? projectOrderOperationalState(selectedOrder, { isAdmin }) : null
  const itemizedMode = selectedOrder?.pricing_mode === 'itemized_v1'
  const editedItemizedTotal = itemizedMode && editorDraft
    ? editorDraft.items.reduce((sum, item) => {
        const price = Number(item.unitPrice)
        const quantity = Number(item.quantity)
        return sum + (Number.isSafeInteger(price) && price >= 0 && Number.isSafeInteger(quantity) && quantity > 0 ? price * quantity : 0)
      }, 0)
    : Number(selectedOrder?.total_amount || 0)
  const editedReceivedTotal = itemizedMode && editorDraft
    ? editorDraft.payments
        .filter((payment) => Boolean(payment.id) && Number(payment.amount || 0) > 0)
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    : Number(projection?.receivedAmount || 0)
  const editedDebtTotal = itemizedMode ? Math.max(0, editedItemizedTotal - editedReceivedTotal) : Number(projection?.debtAmount || 0)

  return (
    <article
              className="card wide sector-orders"
              id="editor"
              ref={editorFormRef}
              style={{ ...sectorStyle('orders'), ...orderPanelStyle('edit'), display: selectedOrder && projection?.canEdit && editorDraft && editorOpen ? undefined : 'none' }}
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
                    {itemizedMode
                      ? 'Редактируйте заказ прямо в форме: реквизиты, состав, количество, источник, цену продажи и проведённые оплаты. Отдельные подтверждения не нужны; сервер при сохранении сам проверит актуальность данных, остатки и деньги.'
                      : 'Можно быстро исправить данные выбранного заказа. Оплаты и товары подставляются из базы и сохраняются безопасно; отправка, удаление и статусы Цеха меняются отдельными штатными действиями.'}
                  </div>
    
                  <div className="editor-summary">
                    <div className="editor-summary-head">
                      <div>
                        <strong>{selectedOrder.external_id}</strong>
                        <span>{selectedOrder.order_date} · {selectedOrder.manager_name || '—'} · {sourceLabel(selectedOrder.source_type)}</span>
                      </div>
                      <div className="order-status-stack">
                        <span className="status-pill status-neutral">{projection?.lifecycleLabel || 'Активен'}</span>
                        {projection?.workshopLabel ? <small>{projection.workshopLabel}</small> : null}
                      </div>
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
                        <strong>{formatMoney(editedReceivedTotal)}</strong>
                      </div>
                      <div>
                        <span>Возвращено</span>
                        <strong>{formatMoney(projection?.refundAmount || 0)}</strong>
                      </div>
                      <div>
                        <span>Осталось денег</span>
                        <strong>{formatMoney(projection?.netRetainedAmount || 0)}</strong>
                      </div>
                      <div>
                        <span>Долг</span>
                        <strong>{formatMoney(editedDebtTotal)}</strong>
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
                    {itemizedMode ? (
                      <div className="field-block">
                        <span>Итого заказа</span>
                        <strong>{formatMoney(editedItemizedTotal)}</strong>
                        <small>Пересчитывается автоматически из количества и цены продажи по позициям.</small>
                      </div>
                    ) : (
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
                    )}
                    {projection?.hasWorkshopItems ? (
                      <div className="field-block">
                        <span>Цех</span>
                        <strong>{projection.workshopLabel || 'Цех: нет активной работы'}</strong>
                        <small>Состояние меняется по конкретным позициям в разделе «Цех».</small>
                      </div>
                    ) : null}
                    {itemizedMode ? (
                      <div className="field-block">
                        <span>Статус</span>
                        <strong>{projection?.lifecycleLabel || 'Активен'}</strong>
                        <small>Жизненный цикл меняется только отдельными штатными действиями.</small>
                      </div>
                    ) : (
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
                    )}
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
                        <button className="secondary compact" type="button" onClick={addEditorItem} disabled={savingOrder}>
                          + Товар
                        </button>
                      </div>
                      {itemizedMode ? (
                        <p className="mini-panel-note">
                          Изменения применятся одной кнопкой «Сохранить изменения». Для будущего состава доступность считается с учётом освобождения старого резерва; сервер всё перепроверит перед записью.
                        </p>
                      ) : null}
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
                              <button className="ghost danger compact" type="button" onClick={() => removeEditorItem(index)} disabled={Boolean(itemizedMode && editorDraft.items.length <= 1) || savingOrder}>
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
                              {itemizedMode ? (
                                <>
                                  <label>
                                    <span>Цена продажи</span>
                                    <FriendlyNumberInput
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={item.unitPrice ?? ''}
                                      onChange={(event) => updateEditorItem(index, 'unitPrice', event.target.value === '' ? null : Number(event.target.value))}
                                      placeholder="Цена продажи"
                                    />
                                    <small className="field-hint">Скидка задаётся итоговой ценой продажи, а не процентом.</small>
                                  </label>
                                  <div className="field-block">
                                    <span>Цена по каталогу</span>
                                    <strong>{item.catalogPriceSnapshot !== null && item.catalogPriceSnapshot !== undefined ? formatMoney(item.catalogPriceSnapshot) : 'Нет цены в каталоге'}</strong>
                                    <small>{item.priceOrigin === 'manual' ? 'Ручная цена.' : item.priceOrigin === 'catalog' ? 'Текущая рекомендация Каталога.' : 'Введите цену вручную.'}</small>
                                  </div>
                                  <div className="field-block">
                                    <span>Сумма позиции</span>
                                    <strong>{item.unitPrice === undefined || item.unitPrice === null ? '—' : formatMoney(Math.max(0, Number(item.quantity || 0)) * Math.max(0, Number(item.unitPrice || 0)))}</strong>
                                  </div>
                                </>
                              ) : null}
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
                                    <>
                                      <label>
                                        <span>Нужно до</span>
                                        <input
                                          type="date"
                                          value={item.workshopDueDate || ''}
                                          onChange={(event) => updateEditorItem(index, 'workshopDueDate', event.target.value)}
                                        />
                                      </label>
                                      <label>
                                        <span>Время</span>
                                        <input
                                          type="time"
                                          value={item.workshopDueTime || ''}
                                          onChange={(event) => updateEditorItem(index, 'workshopDueTime', event.target.value)}
                                        />
                                      </label>
                                    </>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                            {!itemizedMode
                              ? renderOrderSourceAvailability(item, `edit-item-${index}`, index, 'edit')
                              : renderOrderSourceAvailability(item, `edit-item-${index}`, index, 'itemized_edit')}
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
                        Проведённые оплаты редактируются прямо в полях ниже: дата, сумма, способ, смысл и комментарий сохраняются вместе с заказом, ID оплаты не меняется. Если первичную оплату забыли внести, при создании она относится к дате заказа. Доплата, связанная с обменом, исправляется через операцию обмена; здесь для неё доступен только способ оплаты.
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
                                  disabled={savingOrder || (!payment.id && payment.paymentKind === 'primary') || Boolean(payment.id && payment.paymentKind === 'extra')}
                                  onChange={(event) => updateEditorPayment(index, 'paymentDate', event.target.value)}
                                />
                              </label>
                              <label>
                                <span>Смысл оплаты</span>
                                <select
                                  value={payment.paymentKind || 'primary'}
                                  disabled={savingOrder || Boolean(payment.id && payment.paymentKind === 'extra')}
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
                                  disabled={savingOrder || Boolean(payment.id && payment.paymentKind === 'extra')}
                                  onChange={(event) => updateEditorPayment(index, 'amount', Number(event.target.value))}
                                />
                              </label>
                              <label className="wide-field">
                                <span>Комментарий</span>
                                <input
                                  value={payment.comment || ''}
                                  disabled={savingOrder || Boolean(payment.id && payment.paymentKind === 'extra')}
                                  onChange={(event) => updateEditorPayment(index, 'comment', event.target.value)}
                                />
                              </label>
                            </div>
                            {payment.id ? (
                              <p className="mini-panel-note">
                                {payment.paymentKind === 'extra'
                                  ? 'Эта доплата связана с обменом. Здесь можно исправить только способ оплаты; сумму, дату и смысл меняйте через операцию обмена.'
                                  : 'Оплата уже проведена. Дату, сумму, способ, смысл и комментарий можно исправить; ID оплаты сохранится, а изменение будет отражено в денежной истории.'}
                              </p>
                            ) : (
                              <div className="actions">
                                <button className="primary compact" type="button" onClick={() => void saveEditorPayment(index)} disabled={savingOrder}>
                                  {savingOrder ? 'Провожу оплату…' : 'Провести оплату'}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                        {!editorDraft.payments.length ? (
                          <div className="empty-state">Оплат пока нет. Добавьте нужный вид операции одной из кнопок выше.</div>
                        ) : null}
                      </div>
                    </section>
                  </div>
    
                  <div className="actions form-bottom-actions">
                    <button className="primary" type="button" onClick={saveSelectedOrder} disabled={savingOrder}>
                      {savingOrder ? 'Сохраняю...' : 'Сохранить изменения'}
                    </button>
                    <button className="secondary" type="button" onClick={() => selectedOrder && setEditorDraft(createEditorDraft(selectedOrder))} disabled={savingOrder}>
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
