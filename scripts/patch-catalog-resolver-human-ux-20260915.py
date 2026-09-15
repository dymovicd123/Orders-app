from pathlib import Path
import json
import subprocess


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, got {count}')
    return text.replace(old, new, 1)

# 1) Reservation bug: undefined observedPhysicalQuantity must mean "not supplied".
reservations_path = Path('worker/domains/order-reservations.ts')
reservations = reservations_path.read_text(encoding='utf-8')
reservations = replace_once(
    reservations,
    "  const observedPhysical = item.observedPhysicalQuantity;\n",
    "  // Resolver/manual callers may construct a normalized order item without this optional field.\n  // Treat both null and undefined as ‘no physical count supplied’; never bind undefined into D1.\n  const observedPhysical = item.observedPhysicalQuantity == null ? null : item.observedPhysicalQuantity;\n",
    'normalize optional physical observation',
)
reservations_path.write_text(reservations, encoding='utf-8')

review_path = Path('worker/domains/catalog-review.ts')
review = review_path.read_text(encoding='utf-8')
review = replace_once(
    review,
    "    workshopDueDate: '',\n  } as ReturnType<typeof normalizeOrderItems>[number];\n",
    "    workshopDueDate: '',\n    observedPhysicalQuantity: null,\n    shortageAcknowledged: false,\n  } as ReturnType<typeof normalizeOrderItems>[number];\n",
    'resolver order item explicit optional fields',
)
review_path.write_text(review, encoding='utf-8')

# 2) Human-oriented resolver UI.
modal_path = Path('src/features/orders/OrderCatalogResolutionModal.tsx')
modal = modal_path.read_text(encoding='utf-8')

helper_anchor = "function productVariantCategory(variant: CatalogVariantRecord): 'adult' | 'child' {\n  return String(variant.productCategory || '').toLowerCase() === 'child' ? 'child' : 'adult'\n}\n"
helper_addition = helper_anchor + "\nfunction noSizeValue(value: unknown) {\n  const text = normalize(value)\n  return !text || ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(text) ? '' : text\n}\n\nfunction variantCompatibleWithDraft(variant: CatalogVariantRecord, draft: ResolverDraft) {\n  if (Number(variant.productId) !== Number(draft.productId)) return false\n  if (productVariantCategory(variant) !== draft.category) return false\n  if (normalize(variant.gender) !== normalize(draft.gender)) return false\n  if ((normalize(variant.material) || 'СТАНДАРТ') !== (normalize(draft.material) || 'СТАНДАРТ')) return false\n  if ((normalize(variant.length) || 'СТАНДАРТ') !== (normalize(draft.length) || 'СТАНДАРТ')) return false\n  if (clean(draft.color) && (normalize(variant.color) || 'БЕЗ ЦВЕТА') !== normalize(draft.color)) return false\n  if (clean(draft.size) && noSizeValue(variant.sizeLabel) !== noSizeValue(draft.size)) return false\n  return true\n}\n\nfunction variantExactlyMatchesDraft(variant: CatalogVariantRecord, draft: ResolverDraft) {\n  if (!clean(draft.color) || !clean(draft.size)) return false\n  return variantCompatibleWithDraft(variant, draft)\n    && (normalize(variant.color) || 'БЕЗ ЦВЕТА') === normalize(draft.color)\n    && noSizeValue(variant.sizeLabel) === noSizeValue(draft.size)\n}\n"
modal = replace_once(modal, helper_anchor, helper_addition, 'variant compatibility helpers')

modal = replace_once(
    modal,
    "  const [error, setError] = useState('')\n",
    "  const [error, setError] = useState('')\n  const [advancedOpen, setAdvancedOpen] = useState(false)\n",
    'advanced state',
)
modal = replace_once(
    modal,
    "      setCreateFields({})\n",
    "      setCreateFields({})\n      setAdvancedOpen(!contextData.existingVariantId)\n",
    'advanced initial state',
)

compound_anchor = "  const compoundHint = useMemo(() => {\n"
computed = "  const exactDraftVariant = useMemo(() => {\n    if (!draft || !catalog) return null\n    return (catalog.variants || []).find((variant) => variant.isActive && variantExactlyMatchesDraft(variant, draft)) || null\n  }, [catalog, draft])\n\n  const contextRecommendedVariant = useMemo(() => {\n    if (!draft || !catalog || !context?.existingVariantId) return null\n    const candidate = (catalog.variants || []).find((variant) => Number(variant.id) === Number(context.existingVariantId) && variant.isActive) || null\n    return candidate && variantCompatibleWithDraft(candidate, draft) ? candidate : null\n  }, [catalog, context?.existingVariantId, draft])\n\n  const recommendedVariant = exactDraftVariant || contextRecommendedVariant\n\n"
if compound_anchor not in modal:
    raise SystemExit('computed recommendation anchor missing')
modal = modal.replace(compound_anchor, computed + compound_anchor, 1)

modal = replace_once(
    modal,
    "  const resolveSelected = async () => {\n    if (!activeItem || !selectedVariantId || resolving) return\n",
    "  const resolveSelected = async (variantId = selectedVariantId) => {\n    if (!activeItem || !variantId || resolving) return\n",
    'resolve selected signature',
)
modal = replace_once(
    modal,
    "body: JSON.stringify({ variantId: selectedVariantId }),",
    "body: JSON.stringify({ variantId }),",
    'resolve selected body',
)
modal = replace_once(
    modal,
    "  const resolveFacts = async () => {\n    if (!activeItem || !draft || resolving || factsBlocked || !isAdmin) return\n    setResolving(true)\n",
    "  const resolveFacts = async () => {\n    if (!activeItem || !draft || resolving || factsBlocked || !isAdmin) return\n    if (exactDraftVariant?.id) {\n      await resolveSelected(Number(exactDraftVariant.id))\n      return\n    }\n    setResolving(true)\n",
    'reuse exact existing variant from manual facts',
)

return_anchor = '  return (\n    <div className="modal-backdrop order-catalog-resolution-backdrop" role="presentation">\n'
start = modal.rfind(return_anchor)
if start < 0:
    raise SystemExit('final JSX return anchor missing')

new_return = r'''  return (
    <div className="modal-backdrop order-catalog-resolution-backdrop" role="presentation">
      <div className="modal-card order-catalog-resolution-modal" role="dialog" aria-modal="true" aria-label="Уточнение товара перед отправкой">
        <div className="order-catalog-resolution-head">
          <div>
            <div className="card-label">Перед отправкой</div>
            <h3>Уточнить товар</h3>
            <div className="muted">{order.external_id || `Заказ #${order.id}`}</div>
          </div>
          <button type="button" className="secondary-button" onClick={onClose} disabled={resolving}>Закрыть</button>
        </div>

        {busy ? <div className="order-catalog-resolution-loading">Загружаю товар…</div> : null}
        {error ? <div className="order-catalog-resolution-error">{error}</div> : null}

        {!busy && activeItem && draft ? (
          <>
            <div className="order-catalog-resolution-progress">
              {review?.count || review?.items?.length || 1} {Number(review?.count || review?.items?.length || 1) === 1 ? 'позиция требует уточнения' : 'позиции требуют уточнения'}
            </div>

            <section className="order-catalog-resolution-source">
              <div className="order-catalog-resolution-source-main">
                <span>В заказе</span>
                <strong>{activeItem.productName || 'Без названия'}</strong>
              </div>
              <div className="order-catalog-resolution-chips">
                {clean(activeItem.gender) ? <span>{activeItem.gender}</span> : null}
                {clean(activeItem.material) ? <span>{activeItem.material}</span> : null}
                {clean(activeItem.length) && normalize(activeItem.length) !== 'СТАНДАРТ' ? <span>{activeItem.length}</span> : null}
                {clean(activeItem.color) ? <span>{activeItem.color}</span> : <span className="is-missing">Цвет не указан</span>}
                {clean(activeItem.size) ? <span>{activeItem.size}</span> : <span className="is-missing">Размер не указан</span>}
              </div>
            </section>

            {recommendedVariant ? (
              <section className="order-catalog-resolution-recommendation">
                <div className="order-catalog-resolution-recommendation-head">
                  <div>
                    <span>Подходит существующий вариант</span>
                    <strong>{recommendedVariant.productName}</strong>
                  </div>
                  <em>Совпадение найдено</em>
                </div>
                <div className="order-catalog-resolution-recommendation-facts">
                  {[productVariantCategory(recommendedVariant) === 'child' ? 'Детский' : 'Взрослый', recommendedVariant.gender, recommendedVariant.color || 'БЕЗ ЦВЕТА', recommendedVariant.material || 'СТАНДАРТ', normalize(recommendedVariant.length) === 'СТАНДАРТ' ? null : recommendedVariant.length, recommendedVariant.sizeLabel || 'БЕЗ РАЗМЕРА'].filter(Boolean).map((value) => <span key={String(value)}>{value}</span>)}
                </div>

                {(explicitColorMissing || explicitSizeMissing) ? (
                  <div className="order-catalog-resolution-missing-decisions">
                    <span>В заказе не хватало данных. Подтвердите:</span>
                    <div>
                      {explicitColorMissing ? <button type="button" onClick={() => changeField('color', 'БЕЗ ЦВЕТА')}>Без цвета</button> : <span className="is-done">✓ Без цвета</span>}
                      {explicitSizeMissing ? <button type="button" onClick={() => changeField('size', 'БЕЗ РАЗМЕРА')}>Без размера</button> : <span className="is-done">✓ Без размера</span>}
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="primary-button order-catalog-resolution-confirm"
                  disabled={resolving || genderMissing || explicitColorMissing || explicitSizeMissing}
                  onClick={() => void resolveSelected(Number(recommendedVariant.id))}
                >
                  {resolving ? 'Сохраняю…' : 'Подтвердить этот товар'}
                </button>
              </section>
            ) : null}

            <details
              className="order-catalog-resolution-advanced"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary>{recommendedVariant ? 'Выбрать другой вариант или исправить данные' : 'Уточнить товар и характеристики'}</summary>
              <div className="order-catalog-resolution-advanced-body">
                <section className="order-catalog-resolution-product">
                  <div className="order-catalog-resolution-compact-title"><strong>Товар</strong>{context?.product?.id ? <span>Система нашла базовый товар</span> : null}</div>

                  {!draft.createProduct ? (
                    <label className="order-catalog-resolution-simple-field">
                      <span>Товар из каталога</span>
                      <select value={draft.productId || ''} onChange={(event) => chooseProduct(Number(event.target.value || 0))}>
                        <option value="">Выберите товар</option>
                        {(catalog?.products || []).filter((product) => product.isActive).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')).map((product) => (
                          <option key={`resolver-product-${product.id}`} value={product.id}>{product.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="order-catalog-resolution-new-product-grid">
                      <label><span>Название нового товара</span><input value={draft.productName} onChange={(event) => changeField('productName', event.target.value)} /></label>
                      <label><span>Для кого</span><select value={draft.genderScope} onChange={(event) => {
                        const scope = event.target.value as CatalogGenderScope | ''
                        setDraft((current) => current ? { ...current, genderScope: scope, gender: fixedGender(scope) || current.gender } : current)
                      }}><option value="">Выберите</option><option value="female">Женский</option><option value="male">Мужской</option><option value="unisex">Унисекс</option></select></label>
                    </div>
                  )}

                  {!context?.product?.id && productSuggestions.length ? (
                    <div className="order-catalog-resolution-suggestions">
                      <span>Возможно, это:</span>
                      {productSuggestions.slice(0, 4).map(({ product }) => <button key={`suggested-product-${product.id}`} type="button" className={Number(draft.productId) === Number(product.id) ? 'is-active' : ''} onClick={() => chooseProduct(Number(product.id))}>{product.name}</button>)}
                    </div>
                  ) : null}

                  {isAdmin ? <button type="button" className="order-catalog-resolution-new-product-toggle" onClick={() => {
                    setDraft((current) => current ? { ...current, createProduct: !current.createProduct, productId: current.createProduct ? current.productId : 0, productName: clean(activeItem.productName), genderScope: current.createProduct ? current.genderScope : '' } : current)
                    setSelectedVariantId(0)
                  }}>{draft.createProduct ? 'Выбрать товар из каталога' : 'Такого товара нет — создать новый'}</button> : null}

                  {compoundHint ? (
                    <div className="order-catalog-resolution-compound-hint">
                      <strong>В названии есть «{compoundHint}»</strong>
                      <span>Если это характеристика, можно сразу подставить:</span>
                      <div><button type="button" onClick={() => changeField('material', compoundHint)}>Материал</button><button type="button" onClick={() => changeField('color', compoundHint)}>Цвет</button></div>
                    </div>
                  ) : null}
                  {productCategoryWarning ? <div className="order-catalog-resolution-warning">{productCategoryWarning}</div> : null}
                </section>

                {draft.productId && variants.length ? (
                  <section className="order-catalog-resolution-existing">
                    <div className="order-catalog-resolution-compact-title"><strong>Другие существующие варианты</strong><span>Если предложенный выше не подходит</span></div>
                    <input className="order-catalog-resolution-variant-search" value={variantQuery} onChange={(event) => setVariantQuery(event.target.value)} placeholder="Материал, цвет или размер" />
                    <div className="order-catalog-resolution-options">
                      {variants.filter((variant) => Number(variant.id) !== Number(recommendedVariant?.id || 0)).slice(0, 12).map((variant) => (
                        <label key={variant.id} className={`order-catalog-resolution-option${selectedVariantId === variant.id ? ' is-selected' : ''}`}>
                          <input type="radio" name="order-catalog-resolution-variant" checked={selectedVariantId === variant.id} onChange={() => chooseVariant(variant)} />
                          <span><strong>{variant.productName}</strong><small>{[variant.gender, variant.color || 'БЕЗ ЦВЕТА', variant.material || 'СТАНДАРТ', normalize(variant.length) === 'СТАНДАРТ' ? null : variant.length, variant.sizeLabel || 'БЕЗ РАЗМЕРА'].filter(Boolean).join(' · ')}</small></span>
                        </label>
                      ))}
                    </div>
                    {selectedVariantId && Number(selectedVariantId) !== Number(recommendedVariant?.id || 0) ? <button type="button" className="primary-button" disabled={resolving} onClick={() => void resolveSelected()}>{resolving ? 'Сохраняю…' : 'Использовать выбранный вариант'}</button> : null}
                  </section>
                ) : null}

                {isAdmin ? (
                  <section className="order-catalog-resolution-facts">
                    <div className="order-catalog-resolution-compact-title"><strong>Характеристики</strong><span>Изменяйте только то, что нужно</span></div>
                    {context?.isWorkshop ? <div className="order-catalog-resolution-workshop-note">Для позиции Цеха достаточно выбрать базовый товар.</div> : (
                      <>
                        <div className="order-catalog-resolution-facts-grid">
                          <label className="order-catalog-resolution-field"><span>Тип</span><select value={draft.category} onChange={(event) => changeField('category', event.target.value === 'child' ? 'child' : 'adult')}><option value="adult">Взрослый</option><option value="child">Детский</option></select></label>
                          <label className={`order-catalog-resolution-field${genderMissing ? ' needs-create' : ''}`}><span>Пол</span><select value={draft.gender} onChange={(event) => changeField('gender', event.target.value)}><option value="">Не указан</option><option value="ЖЕН">ЖЕН</option><option value="МУЖ">МУЖ</option></select></label>
                          {renderField('material', 'Материал')}
                          {renderField('length', 'Длина')}
                          <div className="order-catalog-resolution-field-with-shortcut">{renderField('color', 'Цвет')}<button type="button" onClick={() => changeField('color', 'БЕЗ ЦВЕТА')}>Без цвета</button></div>
                          <div className="order-catalog-resolution-field-with-shortcut">{renderField('size', draft.category === 'child' ? 'Возраст' : 'Размер')}<button type="button" onClick={() => changeField('size', 'БЕЗ РАЗМЕРА')}>Без размера</button></div>
                        </div>
                        {(explicitColorMissing || explicitSizeMissing) ? <div className="order-catalog-resolution-warning">Подтвердите отсутствующие данные: цвет и размер нельзя угадывать.</div> : null}
                        {unconfirmedNewFields.length ? <div className="order-catalog-resolution-warning">Новые значения нужно подтвердить перед добавлением: {unconfirmedNewFields.map((field) => ({ material: 'материал', length: 'длина', color: 'цвет', size: draft.category === 'child' ? 'возраст' : 'размер' }[field])).join(', ')}.</div> : null}
                      </>
                    )}
                    <div className="order-catalog-resolution-actions">
                      <button type="button" className="primary-button" disabled={factsBlocked || resolving} onClick={() => void resolveFacts()}>{resolving ? 'Сохраняю…' : exactDraftVariant ? 'Подтвердить этот вариант' : context?.isWorkshop ? 'Подтвердить товар' : 'Сохранить характеристики'}</button>
                    </div>
                  </section>
                ) : (
                  <div className="order-catalog-resolution-empty">Если подходящего варианта нет, попросите администратора добавить или исправить характеристики.</div>
                )}
              </div>
            </details>
          </>
        ) : null}

        {!busy && !activeItem && !error ? (
          <div className="order-catalog-resolution-done"><strong>Готово.</strong><span>Товар уточнён. Повторите отправку заказа.</span></div>
        ) : null}
      </div>
    </div>
  )
}
'''
modal = modal[:start] + new_return
modal_path.write_text(modal, encoding='utf-8')

css = r'''.order-catalog-resolution-backdrop {
  z-index: 1200;
}

.order-catalog-resolution-modal {
  width: min(790px, calc(100vw - 28px));
  max-height: min(860px, calc(100vh - 28px));
  overflow: auto;
  padding: 20px;
}

.order-catalog-resolution-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.order-catalog-resolution-head h3 {
  margin: 3px 0 2px;
  font-size: 22px;
}

.order-catalog-resolution-loading,
.order-catalog-resolution-error,
.order-catalog-resolution-done,
.order-catalog-resolution-empty,
.order-catalog-resolution-warning,
.order-catalog-resolution-workshop-note,
.order-catalog-resolution-compound-hint {
  margin-top: 12px;
  padding: 11px 12px;
  border-radius: 10px;
  background: var(--surface-soft, #f6f7f9);
}

.order-catalog-resolution-error {
  background: #fff1f1;
  color: #9c1c1c;
  border: 1px solid #f2c8c8;
}

.order-catalog-resolution-warning {
  background: #fff8e8;
  color: #77510a;
  border: 1px solid #f0d89b;
}

.order-catalog-resolution-workshop-note,
.order-catalog-resolution-done {
  background: #eefaf2;
  border: 1px solid #c6ebd1;
}

.order-catalog-resolution-progress {
  margin: 12px 0 8px;
  color: var(--muted-color, #667085);
  font-size: 13px;
}

.order-catalog-resolution-source {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #dde1e7);
  border-radius: 12px;
  background: #f8fafc;
}

.order-catalog-resolution-source-main {
  display: grid;
  gap: 2px;
  min-width: 120px;
}

.order-catalog-resolution-source-main span,
.order-catalog-resolution-recommendation-head span {
  color: var(--muted-color, #667085);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .035em;
}

.order-catalog-resolution-chips,
.order-catalog-resolution-recommendation-facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.order-catalog-resolution-chips span,
.order-catalog-resolution-recommendation-facts span,
.order-catalog-resolution-missing-decisions .is-done {
  padding: 5px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: #344054;
  font-size: 12px;
  line-height: 1.2;
}

.order-catalog-resolution-chips .is-missing {
  background: #fff3df;
  color: #8a5a00;
}

.order-catalog-resolution-recommendation {
  margin-top: 10px;
  padding: 14px;
  border: 1px solid #b8dfc5;
  border-radius: 14px;
  background: #f3fbf5;
}

.order-catalog-resolution-recommendation-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.order-catalog-resolution-recommendation-head > div {
  display: grid;
  gap: 3px;
}

.order-catalog-resolution-recommendation-head strong {
  font-size: 18px;
}

.order-catalog-resolution-recommendation-head em {
  padding: 4px 7px;
  border-radius: 999px;
  background: #dff3e5;
  color: #166534;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  white-space: nowrap;
}

.order-catalog-resolution-recommendation-facts {
  justify-content: flex-start;
  margin-top: 10px;
}

.order-catalog-resolution-missing-decisions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #d8eadc;
  color: #475467;
  font-size: 13px;
}

.order-catalog-resolution-missing-decisions > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.order-catalog-resolution-missing-decisions button,
.order-catalog-resolution-suggestions button,
.order-catalog-resolution-compound-hint button,
.order-catalog-resolution-field-with-shortcut > button,
.order-catalog-resolution-new-product-toggle,
.order-catalog-resolution-create {
  border: 1px solid #cfd6e4;
  border-radius: 8px;
  background: #fff;
  padding: 7px 10px;
  font: inherit;
  cursor: pointer;
}

.order-catalog-resolution-confirm {
  margin-top: 12px;
}

.order-catalog-resolution-advanced {
  margin-top: 10px;
  border: 1px solid var(--border-color, #dde1e7);
  border-radius: 12px;
  background: #fff;
}

.order-catalog-resolution-advanced > summary {
  padding: 12px 14px;
  cursor: pointer;
  font-weight: 700;
  font-size: 13px;
  color: #344054;
}

.order-catalog-resolution-advanced[open] > summary {
  border-bottom: 1px solid var(--border-color, #dde1e7);
}

.order-catalog-resolution-advanced-body {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.order-catalog-resolution-product,
.order-catalog-resolution-existing,
.order-catalog-resolution-facts {
  padding: 12px;
  border-radius: 10px;
  background: #f9fafb;
}

.order-catalog-resolution-compact-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 9px;
}

.order-catalog-resolution-compact-title > span {
  color: var(--muted-color, #667085);
  font-size: 12px;
}

.order-catalog-resolution-simple-field,
.order-catalog-resolution-new-product-grid label,
.order-catalog-resolution-field {
  display: grid;
  gap: 5px;
}

.order-catalog-resolution-simple-field > span,
.order-catalog-resolution-new-product-grid label > span,
.order-catalog-resolution-field > span {
  font-size: 12px;
  font-weight: 700;
  color: #475467;
}

.order-catalog-resolution-product select,
.order-catalog-resolution-product input,
.order-catalog-resolution-field select,
.order-catalog-resolution-field input,
.order-catalog-resolution-variant-search {
  width: 100%;
}

.order-catalog-resolution-new-product-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 10px;
}

.order-catalog-resolution-suggestions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 9px;
}

.order-catalog-resolution-suggestions > span {
  color: var(--muted-color, #667085);
  font-size: 12px;
}

.order-catalog-resolution-suggestions button.is-active,
.order-catalog-resolution-create.is-approved {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.order-catalog-resolution-new-product-toggle {
  margin-top: 9px;
  font-size: 12px;
}

.order-catalog-resolution-compound-hint {
  display: grid;
  gap: 6px;
  background: #f5f8ff;
  border: 1px solid #d7e3ff;
  font-size: 12px;
}

.order-catalog-resolution-compound-hint > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.order-catalog-resolution-options {
  display: grid;
  gap: 6px;
  margin-top: 8px;
  max-height: 220px;
  overflow: auto;
}

.order-catalog-resolution-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid var(--border-color, #dde1e7);
  border-radius: 9px;
  background: #fff;
  cursor: pointer;
}

.order-catalog-resolution-option.is-selected {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb inset;
  background: #f8fbff;
}

.order-catalog-resolution-option > span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.order-catalog-resolution-option small,
.order-catalog-resolution-field small,
.order-catalog-resolution-done span {
  color: var(--muted-color, #667085);
  font-size: 11px;
}

.order-catalog-resolution-existing > .primary-button {
  margin-top: 9px;
}

.order-catalog-resolution-facts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.order-catalog-resolution-field,
.order-catalog-resolution-field-with-shortcut {
  min-width: 0;
}

.order-catalog-resolution-field {
  padding: 9px;
  border: 1px solid #e1e6ef;
  border-radius: 9px;
  background: #fff;
}

.order-catalog-resolution-field.needs-create {
  border-color: #efc86f;
  background: #fffaf0;
}

.order-catalog-resolution-create {
  text-align: left;
  font-size: 11px;
}

.order-catalog-resolution-field-with-shortcut {
  display: grid;
  gap: 5px;
}

.order-catalog-resolution-field-with-shortcut > button {
  justify-self: start;
  padding: 5px 8px;
  font-size: 11px;
}

.order-catalog-resolution-actions {
  margin-top: 11px;
}

.order-catalog-resolution-done {
  display: grid;
  gap: 4px;
}

@media (max-width: 640px) {
  .order-catalog-resolution-modal {
    width: calc(100vw - 12px);
    max-height: calc(100vh - 12px);
    padding: 14px;
  }

  .order-catalog-resolution-source,
  .order-catalog-resolution-recommendation-head,
  .order-catalog-resolution-missing-decisions,
  .order-catalog-resolution-compact-title {
    align-items: stretch;
    flex-direction: column;
  }

  .order-catalog-resolution-chips,
  .order-catalog-resolution-recommendation-facts {
    justify-content: flex-start;
  }

  .order-catalog-resolution-facts-grid,
  .order-catalog-resolution-new-product-grid {
    grid-template-columns: 1fr;
  }

  .order-catalog-resolution-confirm,
  .order-catalog-resolution-existing > .primary-button,
  .order-catalog-resolution-actions > button {
    width: 100%;
  }
}
'''
Path('src/features/orders/OrderCatalogResolutionModal.css').write_text(css, encoding='utf-8')

# 3) Focused regression now checks the real undefined->D1 failure and the compact UX.
test_path = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
test = test_path.read_text(encoding='utf-8')
test = replace_once(test, "  const catalog = read('worker/domains/catalog.ts')\n", "  const catalog = read('worker/domains/catalog.ts')\n  const reservations = read('worker/domains/order-reservations.ts')\n", 'reservation test source')
old_checks = "  check(modal.includes('Связать выбранный существующий вариант'), 'R2 must retain a fast exact-existing-variant path')\n  check(modal.includes('/resolve-existing'), 'Orders UI must retain the narrow existing-variant resolver')\n  check(modal.includes('/resolve-facts'), 'R2 must resolve new/corrected characteristics without leaving Orders')\n  check(modal.includes('Можно исправить любое поле'), 'R2 must not freeze fields merely because the backend recognized a placeholder')\n  check(modal.includes('Новое значение — добавить'), 'R2 must add a new reference value inline with explicit confirmation')\n  check(modal.includes('Пустое поле из заказа не считается фактом'), 'Missing color/size must require an explicit operator decision')\n  check(modal.includes('В исходном названии остался текст'), 'R2 must surface compound-name residue instead of treating the whole dirty string as a canonical product')\n  check(modal.includes('как материал'), 'Compound-name residue must be reusable as a material hypothesis')\n"
new_checks = "  check(modal.includes('Подходит существующий вариант'), 'R3 must lead with a human-readable recommended existing variant')\n  check(modal.includes('Подтвердить этот товар'), 'R3 must make the normal resolver path a single clear confirmation')\n  check(modal.includes('Выбрать другой вариант или исправить данные'), 'R3 must keep advanced correction available without making it the default surface')\n  check(modal.includes('/resolve-existing'), 'Orders UI must retain the narrow existing-variant resolver')\n  check(modal.includes('/resolve-facts'), 'R3 must resolve new/corrected characteristics without leaving Orders')\n  check(modal.includes('Новое значение — добавить'), 'R3 must add a new reference value inline with explicit confirmation')\n  check(modal.includes('Подтвердите отсутствующие данные'), 'Missing color/size must still require an explicit operator decision')\n  check(modal.includes('В названии есть'), 'R3 must surface compound-name residue without technical wording')\n  check(modal.includes('Материал'), 'Compound-name residue must remain reusable as a material hypothesis')\n  check(!modal.includes('2. Быстрый путь') && !modal.includes('каноническую привязку'), 'R3 must remove developer-facing catalog jargon from the ordinary flow')\n  check(modal.includes('exactDraftVariant') && modal.includes('await resolveSelected(Number(exactDraftVariant.id))'), 'Facts matching an existing SKU must use the existing-variant path instead of recreating facts')\n  check(review.includes('observedPhysicalQuantity: null'), 'Catalog resolver order items must explicitly say no physical count was supplied')\n  check(reservations.includes('item.observedPhysicalQuantity == null ? null : item.observedPhysicalQuantity'), 'Reservation code must never bind undefined as an observed physical quantity')\n"
test = replace_once(test, old_checks, new_checks, 'focused resolver checks')
test = test.replace("CONTEXTUAL CATALOG RESOLUTION R2 PASSED", "CONTEXTUAL CATALOG RESOLUTION R3 PASSED")
test = test.replace("CONTEXTUAL CATALOG RESOLUTION R2 FAILED", "CONTEXTUAL CATALOG RESOLUTION R3 FAILED")
test_path.write_text(test, encoding='utf-8')

# 4) Accept exact frontend blobs/line counts in the existing preservation manifest.
manifest_path = Path('scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for path in ['src/features/orders/OrderCatalogResolutionModal.tsx', 'src/features/orders/OrderCatalogResolutionModal.css']:
    blob = subprocess.check_output(['git', 'hash-object', path], text=True).strip()
    lines = len(Path(path).read_text(encoding='utf-8').splitlines())
    manifest['files'][path]['afterGitBlob'] = blob
    manifest['files'][path]['afterLines'] = lines
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('catalog resolver human UX + undefined reservation fix applied')
