import { useEffect, useMemo, useState } from 'react'
import type { CatalogResponse, CatalogReviewItem, CatalogReviewResponse, CatalogVariantRecord, OrderRecord } from '../../app/types'
import type { CatalogResolutionContext, CatalogResolutionResponse } from '../../../shared/api-contracts.ts'
import './OrderCatalogResolutionModal.css'

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

type Props = {
  order: OrderRecord | null
  apiFetch: ApiFetch
  isAdmin: boolean
  onClose: () => void
  onCompleted: (order: OrderRecord) => void | Promise<void>
  onOpenFullReview?: (order: OrderRecord) => void | Promise<void>
}

function normalize(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ')
}

function variantLabel(variant: CatalogVariantRecord) {
  return [variant.productName, variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · ')
}

function itemLabel(item: CatalogReviewItem) {
  return [item.gender, item.color, item.material, item.length, item.size]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · ')
}

export function OrderCatalogResolutionModal({ order, apiFetch, isAdmin, onClose, onCompleted, onOpenFullReview }: Props) {
  const [review, setReview] = useState<CatalogReviewResponse | null>(null)
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [context, setContext] = useState<CatalogResolutionContext | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedVariantId, setSelectedVariantId] = useState(0)
  const [error, setError] = useState('')

  const activeItem = review?.items?.[0] || null

  const load = async () => {
    if (!order?.id) return
    setBusy(true)
    setError('')
    try {
      const [reviewResponse, catalogResponse] = await Promise.all([
        apiFetch(`/api/orders/${order.id}/catalog-review`),
        apiFetch('/api/catalog'),
      ])
      const reviewData = await reviewResponse.json() as CatalogReviewResponse & { message?: string }
      const catalogData = await catalogResponse.json() as CatalogResponse & { message?: string }
      if (!reviewResponse.ok) throw new Error(reviewData.message || 'Не удалось загрузить позиции, которые требуют уточнения.')
      if (!catalogResponse.ok) throw new Error(catalogData.message || 'Не удалось загрузить каталог.')
      setReview(reviewData)
      setCatalog(catalogData)
      const first = reviewData.items?.[0]
      if (!first) {
        setContext(null)
        setSelectedVariantId(0)
        await onCompleted(order)
        return
      }
      const contextResponse = await apiFetch(`/api/orders/${order.id}/catalog-review/${first.orderItemId}/context`)
      const contextData = await contextResponse.json() as CatalogResolutionContext
      if (!contextResponse.ok) throw new Error(contextData.message || 'Не удалось определить, что именно нужно уточнить.')
      setContext(contextData)
      setSelectedVariantId(Number(contextData.existingVariantId || 0))
      setQuery('')
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось открыть уточнение товара.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!order?.id) return
    void load()
    // The modal state is intentionally reset for each blocked order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id])

  const candidates = useMemo(() => {
    if (!activeItem || !catalog) return []
    const preferredProductId = Number(activeItem.productId || context?.product?.id || 0)
    const rawName = normalize(activeItem.productName)
    const search = normalize(query)
    const rows = (catalog.variants || []).filter((variant) => {
      if (!variant.isActive) return false
      if (preferredProductId && Number(variant.productId) !== preferredProductId) return false
      if (!preferredProductId && rawName) {
        const productName = normalize(variant.productName)
        if (productName !== rawName && !productName.includes(rawName) && !rawName.includes(productName)) return false
      }
      if (search && !normalize(variantLabel(variant)).includes(search)) return false
      return true
    })

    const facts = context?.facts
    const score = (variant: CatalogVariantRecord) => {
      let value = 0
      if (Number(context?.existingVariantId || 0) === Number(variant.id)) value += 1000
      if (normalize(variant.productName) === rawName) value += 100
      if (facts) {
        if (normalize(variant.gender) === normalize(facts.gender)) value += 20
        if (normalize(variant.color) === normalize(facts.color)) value += 20
        if (normalize(variant.material) === normalize(facts.material)) value += 20
        if (normalize(variant.length) === normalize(facts.length)) value += 20
        if (normalize(variant.sizeLabel) === normalize(facts.size)) value += 20
      }
      return value
    }

    return rows
      .slice()
      .sort((left, right) => score(right) - score(left) || variantLabel(left).localeCompare(variantLabel(right), 'ru', { numeric: true }))
      .slice(0, 80)
  }, [activeItem, catalog, context, query])

  if (!order) return null

  const resolveSelected = async () => {
    if (!activeItem || !selectedVariantId || resolving) return
    setResolving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/orders/${order.id}/catalog-review/${activeItem.orderItemId}/resolve-existing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: selectedVariantId }),
      })
      const result = await response.json() as CatalogResolutionResponse
      if (!response.ok) throw new Error(result.message || 'Не удалось связать позицию с товаром каталога.')
      await load()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось сохранить уточнение товара.')
    } finally {
      setResolving(false)
    }
  }

  const issueText = context?.issueType === 'exact_existing'
    ? 'Каталог уже содержит точное совпадение. У этой строки заказа просто не была сохранена складская привязка.'
    : context?.issueType === 'unknown_product'
      ? 'Название строки заказа не связано с базовым товаром каталога. Выберите существующий вариант ниже.'
      : context?.issueType === 'unknown_attribute'
        ? 'Одна из характеристик строки не совпадает со справочником. Выберите фактический существующий вариант.'
        : 'Точной комбинации по данным заказа не найдено. Выберите фактический существующий вариант.'

  return (
    <div className="modal-backdrop order-catalog-resolution-backdrop" role="presentation">
      <div className="modal-card order-catalog-resolution-modal" role="dialog" aria-modal="true" aria-label="Уточнение товара перед отправкой">
        <div className="order-catalog-resolution-head">
          <div>
            <div className="card-label">Перед отправкой</div>
            <h3>Нужно уточнить товар</h3>
            <div className="muted">Заказ {order.external_id || `#${order.id}`}</div>
          </div>
          <button type="button" className="secondary-button" onClick={onClose} disabled={resolving}>Закрыть</button>
        </div>

        {busy ? <div className="order-catalog-resolution-loading">Загружаю проблемную позицию…</div> : null}
        {error ? <div className="order-catalog-resolution-error">{error}</div> : null}

        {!busy && activeItem ? (
          <>
            <div className="order-catalog-resolution-progress">Осталось уточнить: <strong>{review?.count || review?.items?.length || 1}</strong></div>
            <div className="order-catalog-resolution-item">
              <strong>{activeItem.productName || 'Без названия'}</strong>
              <span>{itemLabel(activeItem) || 'Характеристики не указаны'}</span>
              <small>{issueText}</small>
            </div>

            <label className="order-catalog-resolution-search">
              <span>Найти правильный вариант</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, материал, цвет, размер…" />
            </label>

            <div className="order-catalog-resolution-options">
              {candidates.length ? candidates.map((variant) => (
                <label key={variant.id} className={`order-catalog-resolution-option${selectedVariantId === variant.id ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="order-catalog-resolution-variant"
                    checked={selectedVariantId === variant.id}
                    onChange={() => setSelectedVariantId(variant.id)}
                  />
                  <span>
                    <strong>{variant.productName}</strong>
                    <small>{[variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel].filter(Boolean).join(' · ') || 'Стандартная комбинация'}</small>
                  </span>
                  {Number(context?.existingVariantId || 0) === Number(variant.id) ? <em>Точное совпадение</em> : null}
                </label>
              )) : (
                <div className="order-catalog-resolution-empty">
                  Подходящего существующего варианта не найдено. Нельзя отправлять заказ «в обход» — сначала администратор должен добавить или исправить комбинацию в каталоге.
                </div>
              )}
            </div>

            <div className="order-catalog-resolution-actions">
              <button type="button" className="primary-button" disabled={!selectedVariantId || resolving} onClick={() => void resolveSelected()}>
                {resolving ? 'Сохраняю…' : 'Подтвердить товар'}
              </button>
              {isAdmin && onOpenFullReview ? (
                <button type="button" className="secondary-button" disabled={resolving} onClick={() => void onOpenFullReview(order)}>
                  Нужна новая характеристика
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {!busy && !activeItem && !error ? (
          <div className="order-catalog-resolution-done">
            <strong>Все позиции этого заказа распознаны.</strong>
            <span>Теперь нажмите «Отправить клиенту» ещё раз — система повторно проверит физический склад.</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
