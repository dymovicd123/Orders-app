import { useEffect, useMemo, useState } from 'react'
import type { CatalogResolutionContext, CatalogResolutionResponse } from '../../../shared/api-contracts'
import { rankedProducts } from './catalogResolutionFlow'
import './ReturnedItemResolutionModal.css'

type Props = {
  eventId: number
  productName: string
  externalId?: string
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  isAdmin: boolean
  onClose: () => void
  onCompleted: () => void | Promise<void>
  onRequestAdminMode?: () => void
}

const clean = (value: unknown) => String(value || '').trim()
const norm = (value: unknown) => clean(value).toUpperCase()
const isKnown = (list: string[] | undefined, value: string) => (list || []).some(item => norm(item) === norm(value))

export function ReturnedItemResolutionModal({
  eventId,
  productName,
  externalId,
  apiFetch,
  isAdmin,
  onClose,
  onCompleted,
  onRequestAdminMode,
}: Props) {
  const [context, setContext] = useState<CatalogResolutionContext | null>(null)
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [createFields, setCreateFields] = useState<string[]>([])
  const [draft, setDraft] = useState({
    productId: 0,
    category: 'adult',
    gender: '',
    material: 'СТАНДАРТ',
    length: 'СТАНДАРТ',
    color: '',
    size: '',
  })

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError('')
    void (async () => {
      try {
        const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/context`)
        const data = await response.json() as CatalogResolutionContext & { message?: string; completed?: boolean }
        if (!response.ok) throw new Error(data.message || 'Не удалось открыть уточнение товара.')
        if (cancelled) return
        if (data.completed) {
          await onCompleted()
          onClose()
          return
        }
        setContext(data)
        setDraft({
          productId: Number(data.product?.id || 0),
          category: clean(data.facts?.category) === 'child' ? 'child' : 'adult',
          gender: clean(data.facts?.gender),
          material: clean(data.facts?.material) || 'СТАНДАРТ',
          length: clean(data.facts?.length) || 'СТАНДАРТ',
          color: clean(data.facts?.color),
          size: clean(data.facts?.size),
        })
      } catch (value) {
        if (!cancelled) setError(value instanceof Error ? value.message : 'Не удалось открыть уточнение товара.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [eventId])

  const products = context?.product ? [context.product] : (context?.products || [])
  const ranked = useMemo(
    () => rankedProducts(products, search || productName).filter(entry => entry.score > 0).slice(0, 8),
    [products, search, productName],
  )
  const refs = context?.references
  const referenceRows = [
    { field: 'material', label: 'Материал', values: refs?.materials || [] },
    { field: 'length', label: 'Длина', values: refs?.lengths || [] },
    { field: 'color', label: 'Цвет', values: refs?.colors || [] },
    { field: 'size', label: draft.category === 'child' ? 'Возраст / размер' : 'Размер', values: draft.category === 'child' ? (refs?.childAges || []) : (refs?.sizes || []) },
  ] as const

  const chooseProduct = (product: { id: number; name: string; category?: string; genderScope?: string }) => {
    const fixedGender = product.genderScope === 'female' ? 'ЖЕН' : product.genderScope === 'male' ? 'МУЖ' : draft.gender
    setDraft(current => ({
      ...current,
      productId: Number(product.id),
      category: product.category === 'child' ? 'child' : current.category,
      gender: fixedGender,
    }))
    setSearch(product.name)
  }

  const toggleCreateField = (field: string) => {
    setCreateFields(current => current.includes(field) ? current.filter(item => item !== field) : [...current, field])
  }

  const save = async () => {
    if (!draft.productId) {
      setError('Сначала выберите товар.')
      return
    }
    if (!['ЖЕН', 'МУЖ'].includes(norm(draft.gender))) {
      setError('Укажите пол этой вещи.')
      return
    }
    if (!draft.color || !draft.size) {
      setError('Укажите цвет и размер / возраст.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/resolve-facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, createProduct: false, createFields }),
      })
      const data = await response.json() as CatalogResolutionResponse & { message?: string }
      if (!response.ok || data.ok === false) throw new Error(data.message || 'Не удалось принять товар в остаток.')
      await onCompleted()
      onClose()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось принять товар в остаток.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="returned-resolution-backdrop" role="presentation">
      <section className="returned-resolution-card" role="dialog" aria-modal="true" aria-labelledby="returned-resolution-title">
        <header>
          <div>
            <div className="returned-resolution-kicker">Приёмка товара</div>
            <h3 id="returned-resolution-title">Что именно пришло?</h3>
            <p>{externalId ? `Заказ ${externalId} · ` : ''}{productName}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose} disabled={saving}>Закрыть</button>
        </header>

        {busy ? <div className="returned-resolution-loading">Загружаю варианты…</div> : null}
        {error ? <div className="returned-resolution-error">{error}</div> : null}

        {!busy && context ? (
          <>
            <div className="returned-resolution-summary">
              <strong>{context.inventorySource === 'boutique' ? 'Бутик' : 'Склад'} · {Number(context.quantity || 1)} шт.</strong>
              <span>Товар уже физически пришёл. Осталось только определить его, чтобы система правильно прибавила остаток.</span>
            </div>

            {!context.product ? (
              <div className="returned-resolution-block">
                <h4>Выберите товар</h4>
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Начните вводить название"
                  autoFocus
                />
                <div className="returned-resolution-choices">
                  {ranked.map(({ product }) => (
                    <button type="button" key={product.id} onClick={() => chooseProduct(product)}>{product.name}</button>
                  ))}
                </div>
                {!ranked.length && search ? <small>Похожих товаров не нашли. Попробуйте другое слово из названия.</small> : null}
              </div>
            ) : (
              <div className="returned-resolution-product">
                <span>Товар</span>
                <strong>{context.product.name}</strong>
              </div>
            )}

            {draft.productId ? (
              <div className="returned-resolution-fields">
                <div className="returned-resolution-field">
                  <span>Пол</span>
                  <div className="returned-resolution-inline">
                    <button type="button" className={norm(draft.gender) === 'ЖЕН' ? 'is-active' : ''} onClick={() => setDraft(current => ({ ...current, gender: 'ЖЕН' }))}>Жен</button>
                    <button type="button" className={norm(draft.gender) === 'МУЖ' ? 'is-active' : ''} onClick={() => setDraft(current => ({ ...current, gender: 'МУЖ' }))}>Муж</button>
                  </div>
                </div>
                {referenceRows.map(row => {
                  const value = clean(draft[row.field])
                  const unknown = Boolean(value && !isKnown(row.values, value) && !((row.field === 'material' || row.field === 'length') && norm(value) === 'СТАНДАРТ'))
                  return (
                    <label className="returned-resolution-field" key={row.field}>
                      <span>{row.label}</span>
                      <select value={value} onChange={event => {
                        const next = event.target.value
                        setDraft(current => ({ ...current, [row.field]: next }))
                        setCreateFields(current => current.filter(item => item !== row.field))
                      }}>
                        {value && !isKnown(row.values, value) ? <option value={value}>{value} · как записано</option> : null}
                        {!value ? <option value="">Выберите</option> : null}
                        {row.values.map(item => <option value={item} key={item}>{item}</option>)}
                      </select>
                      {unknown ? (
                        isAdmin ? (
                          <button type="button" className={createFields.includes(row.field) ? 'secondary is-active' : 'secondary'} onClick={() => toggleCreateField(row.field)}>
                            {createFields.includes(row.field) ? 'Добавим как новое значение' : 'Это действительно новое значение'}
                          </button>
                        ) : (
                          <small>Такого значения ещё нет. Выберите существующее или войдите в Админ режим, если значение действительно новое.</small>
                        )
                      ) : null}
                    </label>
                  )
                })}
              </div>
            ) : null}

            {!isAdmin && referenceRows.some(row => {
              const value = clean(draft[row.field])
              return Boolean(value && !isKnown(row.values, value) && !((row.field === 'material' || row.field === 'length') && norm(value) === 'СТАНДАРТ'))
            }) && onRequestAdminMode ? (
              <button type="button" className="secondary returned-resolution-admin" onClick={onRequestAdminMode}>Войти в Админ режим</button>
            ) : null}

            <div className="returned-resolution-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>Оставить на уточнение</button>
              <button type="button" className="primary" onClick={() => void save()} disabled={saving || !draft.productId}>
                {saving ? 'Сохраняю…' : 'Подтвердить и принять в остаток'}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
