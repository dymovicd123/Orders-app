// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import '../../styles/188f-stock-trust.css'
type SectionContext = Record<string, any>

export function CreateOrderSection({ ctx }: { ctx: SectionContext }) {
  const {
    addCreateItem,
    addCreatePayment,
    applyCreateProductPick,
    ChoicePills,
    createDraft,
    createOrderFromDraft,
    createPricing,
    createTotals,
    resetCreateOrderDraft,
    formatMoney,
    formatOrderItemDetails,
    formatOrderItemTitle,
    FriendlyNumberInput,
    ManagerPicker,
    normalizeAudienceTypeValue,
    normalizeSuggestion,
    orderBusy,
    orderPanelStyle,
    references,
    removeCreateItem,
    removeCreatePayment,
    renderOrderSizeSelect,
    renderOrderSourceAvailability,
    sectorStyle,
    setCreateDraft,
    setOrderPanel,
    SmartPickerInput,
    sourceLabel,
    suggestionValues,
    updateCreateDraft,
    updateCreateItem,
    updateCreatePayment,
    zammlerMode = false,
  } = ctx

  return (
    <article className="card wide sector-orders" id={zammlerMode ? 'zammler-create' : 'create'} style={{ ...sectorStyle('orders'), ...orderPanelStyle(zammlerMode ? 'zammler' : 'create') }}>
              <div className="create-hero">
                <div>
                  <div className="card-label">{zammlerMode ? 'Новый заказ ЗАММЛЕР' : 'Новый заказ'}</div>
                  {!zammlerMode ? (
                    <div className="card-meta">Заполняйте заказ сверху вниз: клиент → товары → оплата → проверка. Лишних переключателей наверху нет, источник выбирается только внутри товарных позиций.</div>
                  ) : null}
                </div>
                <div className="orders-workspace-kpis create-kpis">
                  <div>
                    <span>Товаров</span>
                    <strong>{createDraft.items.length}</strong>
                  </div>
                  <div>
                    <span>Оплат</span>
                    <strong>{createDraft.payments.filter((payment) => String(payment.method || '').trim() && Number(payment.amount || 0) > 0).length}</strong>
                  </div>
                  <div>
                    <span>Долг</span>
                    <strong>{formatMoney(createTotals.debtAmount)}</strong>
                  </div>
                </div>
              </div>
    
              <section className="order-step-card">
                <div className="order-step-head">
                  <div className="order-step-index">1</div>
                  <div>
                    <h3>Клиент и условия заказа</h3>
                    <p>Основные данные заказа. Итоговая цена теперь складывается из цен товарных позиций.</p>
                  </div>
                </div>
                <div className="form-grid edit-grid">
                  <label>
                    <span>Дата</span>
                    <input
                      type="date"
                      value={createDraft.orderDate}
                      onChange={(event) => updateCreateDraft('orderDate', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Менеджер <b className="required-mark">*</b></span>
                    <ManagerPicker
                      valueId={createDraft.managerId}
                      valueName={createDraft.managerName}
                      options={references?.managerOptions || []}
                      onChange={(manager) => setCreateDraft((draft) => ({ ...draft, managerId: manager?.id || 0, managerName: manager?.name || '' }))}
                    />
                  </label>
                  <label>
                    <span>Телефон клиента</span>
                    <input
                      value={createDraft.customerPhone}
                      onChange={(event) => updateCreateDraft('customerPhone', event.target.value)}
                      placeholder="Например: +7 777 123 45 67"
                    />
                  </label>
                  <label>
                    <span>Город</span>
                    <SmartPickerInput
                      value={createDraft.city}
                      onChange={(value) => updateCreateDraft('city', value)}
                      placeholder="Город или населённый пункт"
                      options={suggestionValues.cities}
                    />
                  </label>
                  <label>
                    <span>Доставка</span>
                    {zammlerMode ? (
                      <input value="ЗАММЛЕР" readOnly aria-label="Доставка ЗАММЛЕР" />
                    ) : (
                      <SmartPickerInput
                        value={createDraft.deliveryType}
                        onChange={(value) => updateCreateDraft('deliveryType', value)}
                        placeholder="Выберите доставку"
                        options={suggestionValues.deliveryTypes}
                      />
                    )}
                  </label>
                  <label className="wide-field">
                    <span>Комментарий</span>
                    <input
                      value={createDraft.comment}
                      onChange={(event) => updateCreateDraft('comment', event.target.value)}
                      placeholder="Необязательно: адрес, пожелание, уточнение"
                    />
                  </label>
                </div>
              </section>
    
              <section className="order-step-card">
                <div className="order-step-head order-step-head-split">
                  <div className="order-step-head-main">
                    <div className="order-step-index">2</div>
                    <div>
                      <h3>Товары в заказе</h3>
                      <p>Для каждой позиции укажите итоговую цену продажи. Цена Каталога подставляется как рекомендация, но её можно изменить.</p>
                    </div>
                  </div>
                  <button className="primary compact" type="button" onClick={addCreateItem}>
                    + Добавить товар
                  </button>
                </div>
                <div className="stack">
                  {createDraft.items.map((item, index) => (
                    <div className="mini-item order-line-card" key={`create-item-${index}`}>
                      <div className="mini-item-head">
                        <div className="mini-item-head-main">
                          <strong>Позиция {index + 1}</strong>
                          <span className="mini-item-summary">
                            {formatOrderItemTitle(item) || 'Заполните товар и характеристики'}
                          </span>
                        </div>
                        <button className="ghost danger compact" type="button" onClick={() => removeCreateItem(index)}>
                          Удалить
                        </button>
                      </div>
                      <div className="subgrid order-item-grid">
                        <label className="wide-field">
                          <span>Товар</span>
                          <SmartPickerInput
                            value={item.productName}
                            onChange={(value) => updateCreateItem(index, 'productName', value)}
                            onPick={(value) => applyCreateProductPick(index, value)}
                            placeholder="Начните вводить товар"
                            options={suggestionValues.products}
                          />
                        </label>
                        <div className="field-block">
                          <span>Тип</span>
                          <ChoicePills
                            value={normalizeAudienceTypeValue(item.audienceType)}
                            onChange={(value) => updateCreateItem(index, 'audienceType', value)}
                            options={[
                              { value: 'ВЗРОСЛЫЙ', label: 'Взрослый' },
                              { value: 'ДЕТСКИЙ', label: 'Детский' },
                            ]}
                          />
                        </div>
                        <label>
                          <span>{normalizeAudienceTypeValue(item.audienceType) === 'ДЕТСКИЙ' ? 'Возраст' : 'Размер'}</span>
                          {renderOrderSizeSelect(item, index, updateCreateItem, 'create')}
                        </label>
                        <div className="field-block">
                          <span>Пол</span>
                          <ChoicePills
                            value={item.gender || ''}
                            onChange={(value) => updateCreateItem(index, 'gender', value)}
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
                            onChange={(value) => updateCreateItem(index, 'color', value)}
                            placeholder="Цвет"
                            options={suggestionValues.colors}
                          />
                        </label>
                        <label>
                          <span>Материал</span>
                          <SmartPickerInput
                            value={item.material || ''}
                            onChange={(value) => updateCreateItem(index, 'material', value)}
                            placeholder="Материал"
                            options={suggestionValues.materials}
                          />
                        </label>
                        <label>
                          <span>Длина</span>
                          <SmartPickerInput
                            value={item.length || ''}
                            onChange={(value) => updateCreateItem(index, 'length', value)}
                            placeholder="Длина"
                            options={suggestionValues.lengths}
                          />
                        </label>
                        <label>
                          <span>Источник</span>
                          <select
                            value={item.sourceType || 'warehouse'}
                            onChange={(event) => updateCreateItem(index, 'sourceType', event.target.value)}
                          >
                            <option value="warehouse">Склад</option>
                            <option value="boutique">Бутик</option>
                            <option value="workshop">Цех</option>
                          </select>
                        </label>
                        <label>
                          <span>Кол-во</span>
                          <FriendlyNumberInput
                            type="number"
                            min="1"
                            value={item.quantity ?? 1}
                            onChange={(event) => updateCreateItem(index, 'quantity', Number(event.target.value))}
                          />
                        </label>
                        <div className="field-block">
                          <span>Цена по каталогу</span>
                          <strong>{item.catalogPriceSnapshot !== null && item.catalogPriceSnapshot !== undefined ? formatMoney(item.catalogPriceSnapshot) : 'Нет цены'}</strong>
                          <small>{item.catalogPriceSnapshot !== null && item.catalogPriceSnapshot !== undefined ? 'Рекомендованная цена для текущих характеристик.' : 'Введите цену продажи вручную.'}</small>
                        </div>
                        <label>
                          <span>Цена продажи <b className="required-mark">*</b></span>
                          <FriendlyNumberInput
                            type="number"
                            min="0"
                            value={item.unitPrice ?? ''}
                            onChange={(event) => updateCreateItem(index, 'unitPrice', event.target.value)}
                            placeholder="Введите итоговую цену"
                          />
                          <small>Можно указать 0. Эта цена сохранится как историческая цена продажи.</small>
                        </label>
                        <div className="field-block">
                          <span>Сумма позиции</span>
                          <strong>{item.unitPrice === undefined || item.unitPrice === null || String(item.unitPrice).trim() === '' ? '—' : formatMoney(Math.max(0, Number(item.quantity || 0)) * Math.max(0, Number(item.unitPrice || 0)))}</strong>
                        </div>
                        {item.priceNeedsConfirmation ? (
                          <div className="wide-field order-manager-required" role="alert">
                            Характеристики, влияющие на цену Каталога, изменились. Ручная цена сохранена, но её нужно подтвердить заново.
                            <button className="secondary compact" type="button" onClick={() => updateCreateItem(index, 'priceNeedsConfirmation', false)}>
                              Подтвердить цену
                            </button>
                          </div>
                        ) : null}
                        {normalizeSuggestion(item.sourceType) === 'WORKSHOP' && Number(item.quantity || 0) > 0 ? (
                          <>
                            <label className="wide-field">
                              <span>Комментарий для цеха</span>
                              <input
                                value={item.workshopComment || ''}
                                onChange={(event) => updateCreateItem(index, 'workshopComment', event.target.value)}
                                placeholder="Что передать в цех по этой позиции"
                              />
                              <small>Комментарий не делает позицию срочной. Срочность выбирается отдельно ниже.</small>
                            </label>
                            <label className="workshop-urgent-editor">
                              <input
                                type="checkbox"
                                checked={Boolean(item.workshopUrgent)}
                                onChange={(event) => updateCreateItem(index, 'workshopUrgent', event.target.checked)}
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
                                    onChange={(event) => updateCreateItem(index, 'workshopDueDate', event.target.value)}
                                  />
                                </label>
                                <label>
                                  <span>Время</span>
                                  <input
                                    type="time"
                                    value={item.workshopDueTime || ''}
                                    onChange={(event) => updateCreateItem(index, 'workshopDueTime', event.target.value)}
                                  />
                                </label>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      {renderOrderSourceAvailability(item, `create-item-${index}`, index)}
                    </div>
                  ))}
                </div>
                <div className="order-add-item-bottom">
                  <button className="primary compact" type="button" onClick={addCreateItem}>
                    + Добавить товар
                  </button>
                </div>
              </section>
    
              <section className="order-step-card">
                <div className="order-step-head order-step-head-split">
                  <div className="order-step-head-main">
                    <div className="order-step-index">3</div>
                    <div>
                      <h3>Оплаты</h3>
                      <p>Можно добавить несколько способов оплаты. Всё, что не покрыто оплатами, система сама оставит в долге.</p>
                    </div>
                  </div>
                  <button className="secondary compact" type="button" onClick={addCreatePayment}>
                    + Добавить оплату
                  </button>
                </div>
                <div className="stack">
                  {createDraft.payments.map((payment, index) => (
                    <div className="mini-item order-payment-card" key={`create-payment-${index}`}>
                      <div className="mini-item-head">
                        <strong>Оплата {index + 1}</strong>
                        <button className="ghost danger compact" type="button" onClick={() => removeCreatePayment(index)}>
                          Удалить
                        </button>
                      </div>
                      <div className="subgrid order-payment-grid">
                        <label>
                          <span>Дата</span>
                          <input
                            type="date"
                            value={payment.paymentDate}
                            onChange={(event) => updateCreatePayment(index, 'paymentDate', event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Способ оплаты</span>
                          {zammlerMode && index === 0 ? (
                            <input value="КАСПИ МАГАЗИН" readOnly aria-label="Способ оплаты КАСПИ МАГАЗИН" />
                          ) : (
                            <SmartPickerInput
                              value={payment.method}
                              onChange={(value) => updateCreatePayment(index, 'method', value)}
                              placeholder="Выберите способ"
                              options={suggestionValues.paymentMethods}
                            />
                          )}
                        </label>
                        <label>
                          <span>Сумма</span>
                          <FriendlyNumberInput
                            type="number"
                            min="0"
                            value={payment.amount ?? 0}
                            onChange={(event) => updateCreatePayment(index, 'amount', Number(event.target.value))}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
    
              <section className="order-step-card">
                <div className="order-step-head">
                  <div className="order-step-index">4</div>
                  <div>
                    <h3>Проверка заказа</h3>
                    <p>Перед сохранением сверьте цены позиций и оплаты. Итог заказа и долг рассчитываются автоматически.</p>
                  </div>
                </div>
                <div className="editor-summary order-check-panel">
                  <div className="editor-summary-head">
                    <div>
                      <strong>Итог по заказу</strong>
                      <span>Первичная оплата и долг определяются автоматически, вручную выбирать ничего не нужно.</span>
                    </div>
                    <span className={`status-pill ${createPricing?.status !== 'ready' || createTotals.debtAmount > 0 ? 'status-warning' : 'status-online'}`}>
                      {createPricing?.status !== 'ready' ? 'Нужно проверить' : createTotals.debtAmount <= 0 ? 'Оплата совпала' : 'Есть долг'}
                    </span>
                  </div>
                  <div className="editor-summary-grid">
                    <div>
                      <span>Итого по позициям</span>
                      <strong>{createPricing?.totalAmount === null ? '—' : formatMoney(createTotals.totalAmount)}</strong>
                    </div>
                    <div>
                      <span>Получено</span>
                      <strong>{formatMoney(createTotals.receivedAmount)}</strong>
                    </div>
                    <div>
                      <span>Долг</span>
                      <strong>{createPricing?.debtAmount === null ? '—' : formatMoney(createTotals.debtAmount)}</strong>
                    </div>
                    <div>
                      <span>Позиции</span>
                      <strong>{createDraft.items.length}</strong>
                    </div>
                  </div>
                </div>
    
                <div className="order-create-item-summary">
                  <div className="order-create-item-summary-head">
                    <strong>Состав заказа</strong>
                    <span>{createDraft.items.length} поз. · {createDraft.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0)} шт.</span>
                  </div>
                  <div className="order-create-item-summary-list">
                    {createDraft.items.map((item, index) => (
                      <div className="order-create-item-summary-row order-summary-card" key={`create-summary-${index}`}>
                        <span className="order-create-item-summary-index">{index + 1}</span>
                        <div className="order-summary-card-body">
                          <strong>{String(item.productName || '').trim() || 'Товар не указан'}</strong>
                          {formatOrderItemDetails(item) ? <span>{formatOrderItemDetails(item)}</span> : <small>Характеристики пока не заполнены</small>}
                        </div>
                        <div className="order-summary-card-side">
                          <span className={`order-create-item-summary-source source-${item.sourceType || 'warehouse'}`}>{sourceLabel(item.sourceType || 'warehouse')}</span>
                          <strong>× {Math.max(0, Number(item.quantity || 0))}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
    
                {createPricing?.status === 'blocked' ? (
                  <div className="order-manager-required" role="alert">
                    Перед сохранением проверьте отмеченные цены позиций и оплаты. Цена продажи обязательна для каждой заполненной позиции.
                  </div>
                ) : null}

                {!Number(createDraft.managerId || 0) ? (
                  <div className="order-manager-required" role="alert">
                    Выберите менеджера. Без менеджера заказ сохранить нельзя.
                  </div>
                ) : null}

                <div className="actions order-create-actions form-bottom-actions">
                  <button
                    className="primary"
                    onClick={createOrderFromDraft}
                    disabled={orderBusy || !Number(createDraft.managerId || 0)}
                    title={!Number(createDraft.managerId || 0) ? 'Сначала выберите менеджера' : undefined}
                  >
                    {orderBusy ? 'Создаю...' : 'Сохранить заказ'}
                  </button>
                  <button className="secondary" type="button" onClick={resetCreateOrderDraft}>
                    Очистить форму
                  </button>
                  <button className="secondary back-action" type="button" onClick={() => setOrderPanel('list')} disabled={orderBusy}>
                    Назад к таблице
                  </button>
                </div>
              </section>
            </article>
  )
}
