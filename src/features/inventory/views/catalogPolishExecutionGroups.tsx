import { useState } from 'react'

const normalizedText = (value: unknown) => String(value || '').trim()
const normalizedKey = (value: unknown) => normalizedText(value).toUpperCase() || 'СТАНДАРТ'

export const pluralRu = (value: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(value)
  const lastTwo = absolute % 100
  const last = absolute % 10
  if (lastTwo >= 11 && lastTwo <= 19) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

function colorGroupsFor(variants: any[], getCatalogVariantCategory: (variant: any) => string) {
  const groups = new Map<string, any>()
  for (const variant of variants) {
    const colorLabel = normalizedText(variant.color) || 'Цвет не указан'
    const colorKey = normalizedKey(colorLabel)
    if (!groups.has(colorKey)) groups.set(colorKey, { key: colorKey, label: colorLabel, variants: [], subgroupMap: new Map<string, any>() })
    const colorGroup = groups.get(colorKey)!
    colorGroup.variants.push(variant)
    const category = getCatalogVariantCategory(variant)
    const gender = normalizedText(variant.gender) || 'Пол не указан'
    const subgroupKey = `${category}¦${normalizedKey(gender)}`
    if (!colorGroup.subgroupMap.has(subgroupKey)) colorGroup.subgroupMap.set(subgroupKey, { key: subgroupKey, category, gender, variants: [] })
    colorGroup.subgroupMap.get(subgroupKey)!.variants.push(variant)
  }

  return Array.from(groups.values()).map((group: any) => ({
    ...group,
    subgroups: Array.from(group.subgroupMap.values()).map((subgroup: any) => ({
      ...subgroup,
      variants: [...subgroup.variants].sort((a: any, b: any) => normalizedText(a.sizeLabel).localeCompare(normalizedText(b.sizeLabel), 'ru', { numeric: true })),
    })).sort((a: any, b: any) => a.category.localeCompare(b.category) || a.gender.localeCompare(b.gender, 'ru')),
  })).sort((a: any, b: any) => a.label.localeCompare(b.label, 'ru', { numeric: true }))
}

function executionHumanSummary(
  variants: any[],
  getCatalogVariantCategory: (variant: any) => string,
) {
  const colors = new Set(variants.map((variant: any) => normalizedText(variant.color) || 'Цвет не указан'))
  const sizes = Array.from(new Set(variants.map((variant: any) => normalizedText(variant.sizeLabel)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
  const colorText = `${colors.size} ${pluralRu(colors.size, 'цвет', 'цвета', 'цветов')}`
  if (!sizes.length) return colorText
  const categories = new Set(variants.map((variant: any) => getCatalogVariantCategory(variant)))
  if (categories.size === 1 && categories.has('child')) {
    return sizes.length === 1 ? `${colorText} · возраст ${sizes[0]}` : `${colorText} · возраст ${sizes[0]}–${sizes[sizes.length - 1]}`
  }
  if (categories.size === 1) {
    return sizes.length === 1 ? `${colorText} · размер ${sizes[0]}` : `${colorText} · размеры ${sizes[0]}–${sizes[sizes.length - 1]}`
  }
  return `${colorText} · ${sizes.length} ${pluralRu(sizes.length, 'значение размера/возраста', 'значения размера/возраста', 'значений размера/возраста')}`
}

async function readCatalogMutationResult(response: Response) {
  const text = await response.text()
  if (!text) return { ok: response.ok, message: '' }
  try {
    return JSON.parse(text) as { ok?: boolean; message?: string }
  } catch {
    return { ok: response.ok, message: response.ok ? '' : 'Сервер вернул неполный ответ. Обновите каталог перед повтором.' }
  }
}

export function CatalogPolishExecutionGroups({
  executionGroups,
  selectedVariants,
  selectedProduct,
  getStockQuantityForVariant,
  getCatalogVariantCategory,
  productCategoryLabel,
  catalogVariantDraft,
  showVariantEditor,
  openVariantEditor,
  stocktakeReferenceReady,
  openNewVariant,
  isAdmin,
  loadCatalogData,
}: any) {
  const [variantCard, setVariantCard] = useState<any | null>(null)
  const [retireConfirmVariantId, setRetireConfirmVariantId] = useState(0)
  const [actionBusyVariantId, setActionBusyVariantId] = useState(0)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')

  const openVariantCard = (variant: any, group: any, colorGroup: any, subgroup: any) => {
    setVariantCard({ variant, group, colorGroup, subgroup })
    setRetireConfirmVariantId(0)
    setActionError('')
  }

  const closeVariantCard = () => {
    setVariantCard(null)
    setRetireConfirmVariantId(0)
    setActionError('')
  }

  const retireVariant = async (variant: any) => {
    if (!isAdmin || !variant?.id || actionBusyVariantId) return
    const warehouseQty = Number(getStockQuantityForVariant('warehouse', variant.id) || 0)
    const boutiqueQty = Number(getStockQuantityForVariant('boutique', variant.id) || 0)
    if (warehouseQty + boutiqueQty !== 0) {
      setActionError('Нельзя вывести позицию, пока на Складе или в Бутике есть физический остаток.')
      return
    }

    setActionBusyVariantId(Number(variant.id))
    setActionError('')
    setActionMessage('')
    try {
      const response = await fetch(`/api/catalog/variants/${encodeURIComponent(String(variant.id))}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      })
      const result = await readCatalogMutationResult(response)
      if (!response.ok || result.ok === false) {
        setActionError(result.message || 'Позиция не выведена из каталога. Обновите данные и проверьте связанные операции.')
        return
      }

      // The PATCH is authoritative. A later refresh failure must not turn a successful
      // retirement into a false mutation error or tempt the user to repeat the write.
      setActionMessage('Позиция выведена из активного каталога. История и прошлые операции сохранены.')
      setVariantCard(null)
      setRetireConfirmVariantId(0)
      try {
        await loadCatalogData(true)
      } catch {
        setActionMessage('Позиция выведена из активного каталога, но список не обновился. Нажмите «Обновить»; повторять вывод не нужно.')
      }
    } catch {
      // A lost response is ambiguous: the server may already have committed the PATCH.
      // Never advise an immediate repeat of the mutation.
      setActionError('Не удалось подтвердить результат операции. Нажмите «Обновить» и проверьте позицию перед любым повтором.')
    } finally {
      setActionBusyVariantId(0)
    }
  }

  return (
    <div className="catalog-execution-list">
      {actionMessage ? <div className="catalog-sku-action-status is-success" role="status">{actionMessage}</div> : null}
      {executionGroups.length ? executionGroups.map((group: any) => {
        const groupPhysical = group.variants.reduce((sum: number, variant: any) => sum + (getStockQuantityForVariant('warehouse', variant.id) || 0) + (getStockQuantityForVariant('boutique', variant.id) || 0), 0)
        const colorGroups = colorGroupsFor(group.variants, getCatalogVariantCategory)
        return (
          <section key={`execution-${group.key}`} className="catalog-execution-card">
            <div className="catalog-execution-head">
              <div>
                <span className="catalog-detail-eyebrow">Исполнение</span>
                <h3>{group.label}</h3>
                <p>{group.label === 'Основное исполнение' ? `Базовое исполнение · ${executionHumanSummary(group.variants, getCatalogVariantCategory)}` : executionHumanSummary(group.variants, getCatalogVariantCategory)}</p>
              </div>
              <div className="catalog-execution-summary catalog-execution-commercial-anchor" data-execution-key={group.key}>
                <strong>{groupPhysical}</strong>
                <span>физически в точках</span>
              </div>
            </div>

            <div className="catalog-color-list">
              {colorGroups.map((colorGroup: any) => {
                const colorPhysical = colorGroup.variants.reduce((sum: number, variant: any) => sum + (getStockQuantityForVariant('warehouse', variant.id) || 0) + (getStockQuantityForVariant('boutique', variant.id) || 0), 0)
                const colorSizeCount = new Set(colorGroup.variants.map((variant: any) => normalizedText(variant.sizeLabel)).filter(Boolean)).size
                return (
                  <section key={`color-${group.key}-${colorGroup.key}`} className="catalog-color-group">
                    <div className="catalog-color-head">
                      <div className="catalog-color-title">
                        <strong>{colorGroup.label}</strong>
                        <span>{colorSizeCount ? `${colorSizeCount} ${pluralRu(colorSizeCount, 'размер/возраст', 'размера/возраста', 'размеров/возрастов')}` : 'Без указанного размера/возраста'}</span>
                      </div>
                      <div className="catalog-color-total">
                        <strong>{colorPhysical}</strong>
                        <span>на месте</span>
                      </div>
                    </div>

                    <div className="catalog-color-subgroups">
                      {colorGroup.subgroups.map((subgroup: any) => {
                        const cardIsHere = Boolean(variantCard
                          && variantCard.group.key === group.key
                          && variantCard.colorGroup.key === colorGroup.key
                          && variantCard.subgroup.key === subgroup.key
                          && subgroup.variants.some((variant: any) => Number(variant.id) === Number(variantCard.variant.id)))
                        const cardVariant = cardIsHere ? subgroup.variants.find((variant: any) => Number(variant.id) === Number(variantCard.variant.id)) : null
                        const cardWarehouseQty = cardVariant ? Number(getStockQuantityForVariant('warehouse', cardVariant.id) || 0) : 0
                        const cardBoutiqueQty = cardVariant ? Number(getStockQuantityForVariant('boutique', cardVariant.id) || 0) : 0
                        const cardTotalQty = cardWarehouseQty + cardBoutiqueQty
                        return (
                          <div key={`subgroup-${group.key}-${colorGroup.key}-${subgroup.key}`} className="catalog-color-subgroup">
                            <div className="catalog-color-subgroup-label">
                              <strong>{subgroup.gender}</strong>
                              <span>{productCategoryLabel(subgroup.category)} · {subgroup.category === 'child' ? 'возраст' : 'размер'}</span>
                            </div>
                            <div className="catalog-size-grid">
                              {subgroup.variants.map((variant: any) => {
                                const warehouseQty = getStockQuantityForVariant('warehouse', variant.id) || 0
                                const boutiqueQty = getStockQuantityForVariant('boutique', variant.id) || 0
                                const totalQty = warehouseQty + boutiqueQty
                                const sizeLabel = normalizedText(variant.sizeLabel) || (subgroup.category === 'child' ? '— возраст' : '— размер')
                                const selected = Number(variantCard?.variant?.id || 0) === Number(variant.id)
                                  || (catalogVariantDraft.id === variant.id && showVariantEditor)
                                return (
                                  <button
                                    key={`w6-variant-${variant.id}`}
                                    type="button"
                                    className={`catalog-size-tile catalog-variant-commercial-anchor ${totalQty > 0 ? 'has-stock' : 'is-zero'} ${selected ? 'is-selected' : ''}`}
                                    data-variant-id={variant.id}
                                    title="Открыть карточку этой точной позиции"
                                    aria-label={`Открыть карточку: ${colorGroup.label}, ${subgroup.category === 'child' ? 'возраст' : 'размер'} ${sizeLabel}, на месте ${totalQty}`}
                                    onClick={() => openVariantCard(variant, group, colorGroup, subgroup)}
                                  >
                                    <span className="catalog-size-value">{sizeLabel}</span>
                                    <span className="catalog-size-stock">{totalQty} шт</span>
                                    <small>Склад {warehouseQty} · Бутик {boutiqueQty}</small>
                                  </button>
                                )
                              })}
                            </div>

                            {cardVariant ? (
                              <section className="catalog-sku-card" data-variant-id={cardVariant.id} aria-label="Карточка точной позиции">
                                <div className="catalog-sku-card-head">
                                  <div>
                                    <span className="catalog-detail-eyebrow">Точная позиция</span>
                                    <h4>{colorGroup.label} · {normalizedText(cardVariant.sizeLabel) || (subgroup.category === 'child' ? 'возраст не указан' : 'размер не указан')}</h4>
                                    <p>{selectedProduct?.name} · {group.label}</p>
                                  </div>
                                  <button className="secondary compact" type="button" onClick={closeVariantCard}>Закрыть</button>
                                </div>

                                <div className="catalog-sku-identity">
                                  <span><small>Тип</small><strong>{productCategoryLabel(subgroup.category)}</strong></span>
                                  <span><small>Пол</small><strong>{subgroup.gender}</strong></span>
                                  <span><small>Цвет</small><strong>{colorGroup.label}</strong></span>
                                  <span><small>{subgroup.category === 'child' ? 'Возраст' : 'Размер'}</small><strong>{normalizedText(cardVariant.sizeLabel) || 'Не указан'}</strong></span>
                                  <span><small>Материал</small><strong>{normalizedText(cardVariant.material) || 'СТАНДАРТ'}</strong></span>
                                  <span><small>Длина</small><strong>{normalizedText(cardVariant.length) || 'СТАНДАРТ'}</strong></span>
                                </div>

                                <div className="catalog-sku-stock" aria-label="Физический остаток позиции">
                                  <span><small>Склад</small><strong>{cardWarehouseQty}</strong></span>
                                  <span><small>Бутик</small><strong>{cardBoutiqueQty}</strong></span>
                                  <span><small>Всего на месте</small><strong>{cardTotalQty}</strong></span>
                                </div>

                                <div className="catalog-sku-safety-note">
                                  <strong>Идентичность позиции защищается историей.</strong>
                                  <span>Для другого цвета, размера или исполнения создавайте новую позицию. Исправление существующей допустимо только пока она ещё нигде не использовалась — сервер проверит это при сохранении.</span>
                                </div>

                                {isAdmin ? (
                                  <div className="catalog-sku-actions">
                                    <button
                                      className="primary compact"
                                      type="button"
                                      disabled={!stocktakeReferenceReady || Boolean(actionBusyVariantId)}
                                      onClick={() => { closeVariantCard(); openVariantEditor(selectedProduct, { ...cardVariant, id: 0 }) }}
                                    >
                                      Создать похожий
                                    </button>
                                    <button
                                      className="secondary compact"
                                      type="button"
                                      disabled={!stocktakeReferenceReady || Boolean(actionBusyVariantId)}
                                      onClick={() => { closeVariantCard(); openVariantEditor(selectedProduct, cardVariant) }}
                                    >
                                      Исправить ошибку
                                    </button>
                                    {retireConfirmVariantId === Number(cardVariant.id) ? (
                                      <div className="catalog-sku-retire-confirm" role="alert">
                                        <span>Позиция исчезнет из рабочего каталога, но её история останется. Сервер дополнительно проверит остаток, резервы, активные заказы, Цех, приёмку и текущую ревизию.</span>
                                        <div>
                                          <button className="danger compact" type="button" disabled={Boolean(actionBusyVariantId)} onClick={() => void retireVariant(cardVariant)}>
                                            {actionBusyVariantId === Number(cardVariant.id) ? 'Проверяю…' : 'Подтвердить вывод'}
                                          </button>
                                          <button className="secondary compact" type="button" disabled={Boolean(actionBusyVariantId)} onClick={() => { setRetireConfirmVariantId(0); setActionError('') }}>Отмена</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        className="secondary compact catalog-sku-retire-action"
                                        type="button"
                                        disabled={Boolean(actionBusyVariantId) || cardTotalQty !== 0}
                                        title={cardTotalQty !== 0 ? 'Сначала разберите физический остаток этой позиции' : 'Сервер проверит остальные связанные операции перед выводом'}
                                        onClick={() => { setRetireConfirmVariantId(Number(cardVariant.id)); setActionError('') }}
                                      >
                                        Вывести из каталога
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="catalog-sku-readonly-note">Изменения каталога доступны только в админ-режиме. Остатки показаны для справки.</div>
                                )}
                                {actionError ? <div className="catalog-sku-action-status is-error" role="alert">{actionError}</div> : null}
                              </section>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          </section>
        )
      }) : (
        <div className="catalog-detail-empty">
          <strong>{selectedVariants.length ? 'Нет вариантов по текущему фильтру' : 'У товара пока нет вариантов'}</strong>
          <p>{selectedVariants.length ? 'Измените поиск или фильтр, чтобы снова показать варианты этого товара.' : 'Создайте первый вариант только если это реальная комбинация характеристик, которая должна участвовать в заказах и остатках.'}</p>
          {!selectedVariants.length ? <button className="primary compact" type="button" disabled={!stocktakeReferenceReady} onClick={() => openNewVariant(selectedProduct)}>+ Добавить первый вариант</button> : null}
        </div>
      )}
    </div>
  )
}
