import { useEffect, useMemo, useState } from 'react'
import { readJsonResponse } from '../../app/utils'
import { rankedProducts } from './catalogResolutionFlow'
import './ReturnedItemResolutionModal.css'

type Props = {
  eventId: number | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  isAdmin: boolean
  onRequestAdminMode: () => void
  onClose: () => void
  onCompleted: () => void | Promise<void>
}

const clean = (value: unknown) => String(value ?? '').trim()
const norm = (value: unknown) => clean(value).toUpperCase()
const fieldLabels: Record<string, string> = {
  material: 'Материал',
  length: 'Длина',
  gender: 'Пол',
  color: 'Цвет',
  size: 'Размер / возраст',
}

export function ReturnedItemResolutionModal({ eventId, apiFetch, isAdmin, onRequestAdminMode, onClose, onCompleted }: Props) {
  const [context, setContext] = useState<any>(null)
  const [draft, setDraft] = useState<any>({ productId: 0, productName: '', createProduct: false, genderScope: '', category: 'adult', gender: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', color: '', size: '' })
  const [search, setSearch] = useState('')
  const [createFields, setCreateFields] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    setBusy(true)
    setError('')
    setContext(null)
    setSearch('')
    setCreateFields({})
    void apiFetch(`/api/inventory/lifecycle/${eventId}/context`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await readJsonResponse<any>(response, 'Уточнение принятого товара')
        if (!response.ok || data?.ok === false) throw new Error(data?.message || 'Не удалось открыть уточнение товара.')
        if (cancelled) return
        if (data.completed) {
          await onCompleted()
          onClose()
          return
        }
        const facts = data.facts || {}
        setContext(data)
        setDraft({
          productId: Number(data.product?.id || 0),
          productName: data.product?.name || facts.productName || '',
          createProduct: false,
          genderScope: data.product?.genderScope || '',
          category: facts.category || 'adult',
          gender: facts.gender || '',
          material: facts.material || 'СТАНДАРТ',
          length: facts.length || 'СТАНДАРТ',
          color: facts.color || '',
          size: facts.size || '',
        })
        setSearch(facts.productName || '')
      })
      .catch((value) => { if (!cancelled) setError(value instanceof Error ? value.message : 'Не удалось открыть уточнение товара.') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [eventId])

  const products = context?.products || []
  const ranked = useMemo(() => rankedProducts(products, search || context?.facts?.productName || '').filter((row: any) => row.score > 0).slice(0, 10), [products, search, context?.facts?.productName])
  const refs = context?.references || { materials: [], lengths: [], colors: [], sizes: [], childAges: [] }
  const valuesFor = (field: string) => field === 'material' ? refs.materials || []
    : field === 'length' ? refs.lengths || []
      : field === 'color' ? refs.colors || []
        : field === 'size' ? (draft.category === 'child' ? refs.childAges || [] : refs.sizes || [])
          : []
  const unknownReferenceFields = ['material', 'length', 'color', 'size'].filter((field) => {
    const value = clean(draft[field])
    if (!value) return false
    if ((field === 'material' || field === 'length') && norm(value) === 'СТАНДАРТ') return false
    if (field === 'size' && ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(norm(value))) return false
    return !valuesFor(field).some((entry: string) => norm(entry) === norm(value))
  })
  const canSubmit = Boolean((draft.productId || (isAdmin && draft.createProduct && clean(draft.productName) && draft.genderScope))
    && ['ЖЕН','МУЖ'].includes(norm(draft.gender))
    && clean(draft.color)
    && clean(draft.size)
    && unknownReferenceFields.every((field) => isAdmin && createFields[field]))

  const chooseProduct = (product: any) => {
    setDraft((current: any) => ({ ...current, productId: Number(product.id), productName: product.name, createProduct: false }))
    setSearch(product.name)
    setError('')
  }

  const submit = async () => {
    if (!eventId || !canSubmit || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/resolve-facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: draft.createProduct ? 0 : Number(draft.productId || 0),
          createProduct: Boolean(draft.createProduct),
          productName: draft.productName,
          genderScope: draft.genderScope,
          category: draft.category,
          gender: draft.gender,
          material: draft.material,
          length: draft.length,
          color: draft.color,
          size: draft.size,
          createFields: Object.entries(createFields).filter(([, enabled]) => enabled).map(([field]) => field),
        }),
      })
      const data = await readJsonResponse<any>(response, 'Уточнение принятого товара')
      if (!response.ok || data?.ok === false) throw new Error(data?.message || 'Не удалось сохранить товар.')
      await onCompleted()
      onClose()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось сохранить товар.')
    } finally {
      setBusy(false)
    }
  }

  if (!eventId) return null
  return (
    <div className="modal-backdrop returned-item-resolution-backdrop" role="presentation">
      <section className="modal-card returned-item-resolution-modal" role="dialog" aria-modal="true" aria-labelledby="returned-item-resolution-title">
        <div className="modal-head">
          <div>
            <div className="card-label">Приёмка товара</div>
            <h3 id="returned-item-resolution-title">Что именно приехало?</h3>
            <p>Товар уже отмечен как физически полученный. Осталось один раз сопоставить запись с каталогом, чтобы правильно добавить его в остаток.</p>
          </div>
          <button className="secondary compact" type="button" disabled={busy} onClick={onClose}>Закрыть</button>
        </div>

        {busy && !context ? <p>Проверяю товар…</p> : null}
        {error ? <div className="returned-item-resolution-error">{error}</div> : null}

        {context ? <>
          <div className="returned-item-source">
            <span>В операции написано</span>
            <strong>{context.facts?.productName || 'Без названия'}</strong>
            <small>{[context.facts?.gender, context.facts?.material, context.facts?.length, context.facts?.color, context.facts?.size].filter(Boolean).join(' · ')}</small>
          </div>

          {!context.product && !draft.createProduct ? <div className="returned-item-product-search">
            <label>Найти товар в каталоге<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Введите часть названия" autoFocus /></label>
            <div className="returned-item-product-results">
              {ranked.map(({ product }: any) => <button type="button" key={product.id} onClick={() => chooseProduct(product)}>{product.name}</button>)}
            </div>
            {!ranked.length ? <p>Подходящего товара пока не видно. Попробуйте другое слово из названия.</p> : null}
            {isAdmin ? <button type="button" className="secondary" onClick={() => setDraft((current: any) => ({ ...current, createProduct: true, productId: 0, productName: context.facts?.productName || current.productName }))}>Такого товара ещё нет</button>
              : <button type="button" className="secondary" onClick={onRequestAdminMode}>Товара нет в каталоге — нужен админ</button>}
          </div> : null}

          {context.product || draft.productId || draft.createProduct ? <div className="returned-item-fields">
            <div className="returned-item-selected-product">
              <span>Товар</span><strong>{draft.createProduct ? draft.productName : (draft.productName || context.product?.name)}</strong>
              {!draft.createProduct && !context.product && <button type="button" className="resolution-link" onClick={() => setDraft((current: any) => ({ ...current, productId: 0, productName: context.facts?.productName || '' }))}>Выбрать другой</button>}
            </div>
            {draft.createProduct ? <>
              <label>Название нового товара<input value={draft.productName} onChange={(event) => setDraft((current: any) => ({ ...current, productName: event.target.value }))} /></label>
              <label>Для кого<select value={draft.genderScope} onChange={(event) => setDraft((current: any) => ({ ...current, genderScope: event.target.value, gender: event.target.value === 'female' ? 'ЖЕН' : event.target.value === 'male' ? 'МУЖ' : current.gender }))}><option value="">Выберите</option><option value="female">Женский</option><option value="male">Мужской</option><option value="unisex">Унисекс</option></select></label>
            </> : null}
            <label>Пол<select value={draft.gender} onChange={(event) => setDraft((current: any) => ({ ...current, gender: event.target.value }))}><option value="">Выберите</option><option value="ЖЕН">Женский</option><option value="МУЖ">Мужской</option></select></label>
            {(['material','length','color','size'] as const).map((field) => <label key={field}>{fieldLabels[field]}
              <input list={`returned-item-${field}`} value={draft[field]} onChange={(event) => setDraft((current: any) => ({ ...current, [field]: event.target.value }))} />
              <datalist id={`returned-item-${field}`}>{valuesFor(field).map((value: string) => <option key={value} value={value} />)}</datalist>
              {unknownReferenceFields.includes(field) ? isAdmin
                ? <span className="returned-item-new-value"><input type="checkbox" checked={Boolean(createFields[field])} onChange={(event) => setCreateFields((current) => ({ ...current, [field]: event.target.checked }))} />Добавить «{draft[field]}» как новое значение</span>
                : <span className="returned-item-warning">Такого значения нет в справочнике. Выберите существующее или войдите в админ режим.</span>
                : null}
            </label>)}
          </div> : null}

          {!isAdmin && unknownReferenceFields.length ? <button type="button" className="secondary" onClick={onRequestAdminMode}>Войти в админ режим и продолжить здесь</button> : null}
          <div className="modal-actions">
            <button type="button" className="primary" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? 'Сохраняю…' : 'Подтвердить и принять в остаток'}</button>
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>Отложить</button>
          </div>
        </> : null}
      </section>
    </div>
  )
}
