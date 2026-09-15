import { useEffect, useMemo, useState } from 'react'
import type { CatalogResponse, CatalogReviewItem, CatalogReviewResponse, CatalogVariantRecord, OrderRecord } from '../../app/types'
import { readJsonResponse } from '../../app/utils'
import type { CatalogGenderScope, CatalogResolutionContext, CatalogResolutionInput, CatalogResolutionResponse } from '../../../shared/api-contracts.ts'
import './OrderCatalogResolutionModal.css'

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>
type CatalogProduct = CatalogResponse['products'][number]
type EditableField = 'material' | 'length' | 'color' | 'size'

type ResolverDraft = {
  productId: number
  createProduct: boolean
  productName: string
  genderScope: CatalogGenderScope | ''
  material: string
  length: string
  category: 'adult' | 'child'
  gender: string
  color: string
  size: string
}

type Props = {
  order: OrderRecord | null
  apiFetch: ApiFetch
  isAdmin: boolean
  onClose: () => void
  onCompleted: (order: OrderRecord) => void | Promise<void>
  onOpenFullReview?: (order: OrderRecord) => void | Promise<void>
}

function clean(value: unknown) {
  return String(value || '').trim()
}

function normalize(value: unknown) {
  return clean(value).toUpperCase().replace(/\s+/g, ' ')
}

function identityText(value: unknown) {
  return normalize(value)
    .replace(/[«»“”„"']/g, ' ')
    .replace(/[‐‑‒–—-]+/g, ' ')
    .replace(/[^0-9A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function variantLabel(variant: CatalogVariantRecord) {
  return [variant.productName, variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel]
    .map(clean)
    .filter(Boolean)
    .join(' · ')
}

function fixedGender(scope: CatalogGenderScope | '' | undefined) {
  return scope === 'female' ? 'ЖЕН' : scope === 'male' ? 'МУЖ' : ''
}

function productScore(rawName: string, product: CatalogProduct) {
  const raw = identityText(rawName)
  const name = identityText(product.name)
  if (!raw || !name) return 0
  if (raw === name) return 10_000 + name.length
  if (raw.includes(name)) return 5_000 + name.length
  if (name.includes(raw) && raw.length >= 4) return 2_000 + raw.length
  const rawTokens = new Set(raw.split(' ').filter((token) => token.length >= 3))
  const nameTokens = name.split(' ').filter((token) => token.length >= 3)
  const overlap = nameTokens.filter((token) => rawTokens.has(token)).length
  return overlap ? overlap * 100 + name.length : 0
}

function rankedProducts(catalog: CatalogResponse | null, rawName: string) {
  return (catalog?.products || [])
    .filter((product) => product.isActive)
    .map((product) => ({ product, score: productScore(rawName, product) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || String(left.product.name).localeCompare(String(right.product.name), 'ru'))
}

function compoundRemainder(rawName: string, productName: string) {
  const cleanRaw = clean(rawName).replace(/[«»“”„"']/g, '').trim()
  const productKey = identityText(productName)
  if (!cleanRaw || !productKey) return ''
  const parts = cleanRaw.split(/\s*[‐‑‒–—-]+\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length > 1) {
    const rest = parts.filter((part) => identityText(part) !== productKey)
    if (rest.length !== parts.length) return rest.join(' · ')
  }
  return ''
}

function productVariantCategory(variant: CatalogVariantRecord): 'adult' | 'child' {
  return String(variant.productCategory || '').toLowerCase() === 'child' ? 'child' : 'adult'
}

function noSizeValue(value: unknown) {
  const text = normalize(value)
  return !text || ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(text) ? '' : text
}

function variantCompatibleWithDraft(variant: CatalogVariantRecord, draft: ResolverDraft) {
  if (Number(variant.productId) !== Number(draft.productId)) return false
  if (productVariantCategory(variant) !== draft.category) return false
  if (normalize(variant.gender) !== normalize(draft.gender)) return false
  if ((normalize(variant.material) || 'СТАНДАРТ') !== (normalize(draft.material) || 'СТАНДАРТ')) return false
  if ((normalize(variant.length) || 'СТАНДАРТ') !== (normalize(draft.length) || 'СТАНДАРТ')) return false
  if (clean(draft.color) && (normalize(variant.color) || 'БЕЗ ЦВЕТА') !== normalize(draft.color)) return false
  if (clean(draft.size) && noSizeValue(variant.sizeLabel) !== noSizeValue(draft.size)) return false
  return true
}

function variantExactlyMatchesDraft(variant: CatalogVariantRecord, draft: ResolverDraft) {
  if (!clean(draft.color) || !clean(draft.size)) return false
  return variantCompatibleWithDraft(variant, draft)
    && (normalize(variant.color) || 'БЕЗ ЦВЕТА') === normalize(draft.color)
    && noSizeValue(variant.sizeLabel) === noSizeValue(draft.size)
}

function initialDraft(item: CatalogReviewItem, context: CatalogResolutionContext, catalog: CatalogResponse): ResolverDraft {
  const suggestions = rankedProducts(catalog, item.productName)
  const suggestedProduct = context.product?.id
    ? (catalog.products || []).find((product) => Number(product.id) === Number(context.product?.id)) || null
    : suggestions[0]?.score >= 5_000 ? suggestions[0].product : null
  const scope = (suggestedProduct?.genderScope || context.product?.genderScope || '') as CatalogGenderScope | ''
  const facts = context.facts || { material: '', length: '', category: 'adult', gender: '', color: '', size: '' }
  const rawColor = clean(item.color)
  const rawSize = clean(item.size)
  return {
    productId: Number(suggestedProduct?.id || context.product?.id || item.productId || 0),
    createProduct: false,
    productName: clean(item.productName),
    genderScope: scope,
    material: clean(item.material) || clean(facts.material) || 'СТАНДАРТ',
    length: clean(item.length) || clean(facts.length) || 'СТАНДАРТ',
    category: String(item.category || facts.category).toLowerCase() === 'child' ? 'child' : 'adult',
    gender: clean(item.gender) || clean(facts.gender) || fixedGender(scope),
    color: rawColor,
    size: rawSize,
  }
}

export function OrderCatalogResolutionModal({ order, apiFetch, isAdmin, onClose, onCompleted }: Props) {
  const [review, setReview] = useState<CatalogReviewResponse | null>(null)
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [context, setContext] = useState<CatalogResolutionContext | null>(null)
  const [draft, setDraft] = useState<ResolverDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [variantQuery, setVariantQuery] = useState('')
  const [selectedVariantId, setSelectedVariantId] = useState(0)
  const [createFields, setCreateFields] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const activeItem = review?.items?.[0] || null

  const load = async (completeWhenEmpty = false) => {
    if (!order?.id) return
    setBusy(true)
    setError('')
    try {
      const [reviewResponse, catalogResponse] = await Promise.all([
        apiFetch(`/api/orders/${order.id}/catalog-review`),
        apiFetch('/api/catalog'),
      ])
      const reviewData = await readJsonResponse<CatalogReviewResponse>(reviewResponse, 'Не удалось загрузить позиции, которые требуют уточнения')
      const catalogData = await readJsonResponse<CatalogResponse>(catalogResponse, 'Не удалось загрузить каталог')
      setReview(reviewData)
      setCatalog(catalogData)
      const first = reviewData.items?.[0]
      if (!first) {
        setContext(null)
        setDraft(null)
        setSelectedVariantId(0)
        if (completeWhenEmpty) {
          await onCompleted(order)
        } else {
          setError('Список позиций для разбора вернулся пустым. Окно оставлено открытым: автоматическое закрытие до действия пользователя запрещено. Закройте его вручную и повторите отправку, если позиция всё ещё блокирует заказ.')
        }
        return
      }
      const contextResponse = await apiFetch(`/api/orders/${order.id}/catalog-review/${first.orderItemId}/context`)
      const contextData = await readJsonResponse<CatalogResolutionContext>(contextResponse, 'Не удалось определить, что именно нужно уточнить')
      setContext(contextData)
      setDraft(initialDraft(first, contextData, catalogData))
      setSelectedVariantId(Number(contextData.existingVariantId || 0))
      setVariantQuery('')
      setCreateFields({})
      setAdvancedOpen(!contextData.existingVariantId)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось открыть уточнение товара.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!order?.id) return
    void load()
    // Resolver state must restart for every blocked order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id])

  const productSuggestions = useMemo(() => rankedProducts(catalog, activeItem?.productName || ''), [catalog, activeItem?.productName])
  const selectedProduct = useMemo(() => {
    if (!draft?.productId) return null
    return (catalog?.products || []).find((product) => Number(product.id) === Number(draft.productId)) || null
  }, [catalog, draft?.productId])

  const variants = useMemo(() => {
    if (!draft?.productId || !catalog) return []
    const search = normalize(variantQuery)
    const rows = (catalog.variants || []).filter((variant) => {
      if (!variant.isActive || Number(variant.productId) !== Number(draft.productId)) return false
      return !search || normalize(variantLabel(variant)).includes(search)
    })
    const score = (variant: CatalogVariantRecord) => {
      let value = 0
      if (Number(context?.existingVariantId || 0) === Number(variant.id)) value += 10_000
      if (normalize(variant.material) === normalize(draft.material)) value += 50
      if (normalize(variant.length) === normalize(draft.length)) value += 40
      if (normalize(variant.gender) === normalize(draft.gender)) value += 30
      if (normalize(variant.color) === normalize(draft.color)) value += 30
      if (normalize(variant.sizeLabel) === normalize(draft.size)) value += 30
      if (productVariantCategory(variant) === draft.category) value += 20
      return value
    }
    return rows.slice().sort((left, right) => score(right) - score(left) || variantLabel(left).localeCompare(variantLabel(right), 'ru', { numeric: true })).slice(0, 24)
  }, [catalog, context?.existingVariantId, draft, variantQuery])

  const exactDraftVariant = useMemo(() => {
    if (!draft || !catalog) return null
    return (catalog.variants || []).find((variant) => variant.isActive && variantExactlyMatchesDraft(variant, draft)) || null
  }, [catalog, draft])

  const contextRecommendedVariant = useMemo(() => {
    if (!draft || !catalog || !context?.existingVariantId) return null
    const candidate = (catalog.variants || []).find((variant) => Number(variant.id) === Number(context.existingVariantId) && variant.isActive) || null
    return candidate && variantCompatibleWithDraft(candidate, draft) ? candidate : null
  }, [catalog, context?.existingVariantId, draft])

  const recommendedVariant = exactDraftVariant || contextRecommendedVariant

  const compoundHint = useMemo(() => {
    if (!activeItem || !selectedProduct) return ''
    return compoundRemainder(activeItem.productName, selectedProduct.name)
  }, [activeItem, selectedProduct])

  const productCategoryWarning = useMemo(() => {
    if (!selectedProduct || !draft || !catalog) return ''
    const active = (catalog.variants || []).filter((variant) => variant.isActive && Number(variant.productId) === Number(selectedProduct.id))
    if (!active.length) return 'У этого товара пока нет активных вариантов. Проверьте характеристики и создайте первую точную комбинацию.'
    const sameCategory = active.filter((variant) => productVariantCategory(variant) === draft.category)
    if (!sameCategory.length) {
      const other = draft.category === 'adult' ? 'детские' : 'взрослые'
      return `В каталоге у «${selectedProduct.name}» есть только ${other} варианты. Не выбирайте их автоматически: подтвердите тип и создайте правильную комбинацию, если это действительно другая вещь.`
    }
    return ''
  }, [catalog, draft, selectedProduct])

  if (!order) return null

  const referencesFor = (field: EditableField) => {
    const refs = context?.references
    if (field === 'material') return refs?.materials || []
    if (field === 'length') return refs?.lengths || []
    if (field === 'color') return refs?.colors || []
    return draft?.category === 'child' ? (refs?.childAges || []) : (refs?.sizes || [])
  }

  const valueNeedsCreation = (field: EditableField, value: string) => {
    const normalized = normalize(value)
    if (!normalized) return false
    if ((field === 'material' || field === 'length') && normalized === 'СТАНДАРТ') return false
    if (field === 'size' && ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(normalized)) return false
    return !referencesFor(field).some((entry) => normalize(entry) === normalized)
  }

  const changeField = <K extends keyof ResolverDraft>(field: K, value: ResolverDraft[K]) => {
    setDraft((current) => current ? { ...current, [field]: value } : current)
    if (field === 'material' || field === 'length' || field === 'color' || field === 'size') {
      setCreateFields((current) => ({ ...current, [field]: false }))
    }
    setSelectedVariantId(0)
  }

  const chooseProduct = (productId: number) => {
    const product = (catalog?.products || []).find((entry) => Number(entry.id) === Number(productId)) || null
    const scope = (product?.genderScope || '') as CatalogGenderScope | ''
    setDraft((current) => current ? {
      ...current,
      productId: Number(product?.id || 0),
      createProduct: false,
      genderScope: scope,
      gender: fixedGender(scope) || current.gender,
    } : current)
    setSelectedVariantId(0)
  }

  const chooseVariant = (variant: CatalogVariantRecord) => {
    setSelectedVariantId(Number(variant.id))
    setCreateFields({})
    setDraft((current) => current ? {
      ...current,
      productId: Number(variant.productId),
      createProduct: false,
      productName: variant.productName,
      genderScope: (selectedProduct?.genderScope || current.genderScope || '') as CatalogGenderScope | '',
      category: productVariantCategory(variant),
      gender: clean(variant.gender),
      color: clean(variant.color) || 'БЕЗ ЦВЕТА',
      material: clean(variant.material) || 'СТАНДАРТ',
      length: clean(variant.length) || 'СТАНДАРТ',
      size: clean(variant.sizeLabel) || 'БЕЗ РАЗМЕРА',
    } : current)
  }

  const resolveSelected = async (variantId = selectedVariantId) => {
    if (!activeItem || !variantId || resolving) return
    setResolving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/orders/${order.id}/catalog-review/${activeItem.orderItemId}/resolve-existing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variantId }),
      })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Не удалось связать позицию с товаром каталога')
      if (!response.ok || result.ok === false) throw new Error(result.message || 'Не удалось связать существующий вариант.')
      await load(true)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось сохранить уточнение товара.')
    } finally {
      setResolving(false)
    }
  }

  const newReferenceFields = draft
    ? (['material', 'length', 'color', 'size'] as const).filter((field) => valueNeedsCreation(field, draft[field]))
    : []
  const unconfirmedNewFields = newReferenceFields.filter((field) => !createFields[field])
  const effectiveScope = draft?.createProduct ? draft.genderScope : ((selectedProduct?.genderScope || draft?.genderScope || '') as CatalogGenderScope | '')
  const genderMissing = !context?.isWorkshop && effectiveScope === 'unisex' && !['ЖЕН', 'МУЖ'].includes(normalize(draft?.gender))
  const explicitColorMissing = !context?.isWorkshop && !clean(draft?.color)
  const explicitSizeMissing = !context?.isWorkshop && !clean(draft?.size)
  const productMissing = !draft?.productId && !draft?.createProduct
  const newProductIncomplete = Boolean(draft?.createProduct && (!clean(draft.productName) || !draft.genderScope))
  const factsBlocked = productMissing || newProductIncomplete || genderMissing || explicitColorMissing || explicitSizeMissing || unconfirmedNewFields.length > 0

  const resolveFacts = async () => {
    if (!activeItem || !draft || resolving || factsBlocked || !isAdmin) return
    if (exactDraftVariant?.id) {
      await resolveSelected(Number(exactDraftVariant.id))
      return
    }
    setResolving(true)
    setError('')
    try {
      const payload: CatalogResolutionInput = {
        productId: Number(draft.productId || 0),
        createProduct: draft.createProduct,
        productName: draft.createProduct ? clean(draft.productName) : clean(activeItem.productName),
        genderScope: draft.genderScope,
        material: clean(draft.material) || 'СТАНДАРТ',
        length: clean(draft.length) || 'СТАНДАРТ',
        category: draft.category,
        gender: clean(draft.gender),
        color: clean(draft.color),
        size: clean(draft.size),
        createFields: Object.entries(createFields).filter(([, enabled]) => enabled).map(([field]) => field),
      }
      const response = await apiFetch(`/api/catalog/review/${activeItem.orderItemId}/resolve-facts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Не удалось создать или связать точную комбинацию')
      if (!response.ok || result.ok === false) throw new Error(result.message || 'Не удалось сохранить фактические характеристики.')
      await load(true)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось сохранить фактические характеристики.')
    } finally {
      setResolving(false)
    }
  }

  const renderField = (field: EditableField, label: string) => {
    if (!draft) return null
    const value = draft[field]
    const needsCreation = valueNeedsCreation(field, value)
    const listId = `order-catalog-${field}-options`
    return (
      <label className={`order-catalog-resolution-field${needsCreation ? ' needs-create' : ''}`}>
        <span>{label}</span>
        <input
          value={value}
          list={listId}
          onChange={(event) => changeField(field, event.target.value)}
          placeholder={field === 'size' ? (draft.category === 'child' ? 'Возраст или «БЕЗ РАЗМЕРА»' : 'Размер или «БЕЗ РАЗМЕРА»') : label}
        />
        <datalist id={listId}>{referencesFor(field).map((entry) => <option key={`${field}-${entry}`} value={entry} />)}</datalist>
        {needsCreation ? (
          <button
            className={createFields[field] ? 'order-catalog-resolution-create is-approved' : 'order-catalog-resolution-create'}
            type="button"
            onClick={() => setCreateFields((current) => ({ ...current, [field]: !current[field] }))}
          >
            {createFields[field] ? `✓ Добавить «${value}» в справочник` : `Новое значение — добавить «${value}» в справочник`}
          </button>
        ) : <small>Можно изменить, даже если исходное значение формально было допустимым.</small>}
      </label>
    )
  }

  return (
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
            <div className="order-catalog-resolution-guard">Без уточнения отправить заказ нельзя.</div>
          </>
        ) : null}

        {!busy && !activeItem && !error ? (
          <div className="order-catalog-resolution-done"><strong>Готово.</strong><span>Товар уточнён. Повторите отправку заказа.</span></div>
        ) : null}
      </div>
    </div>
  )
}
