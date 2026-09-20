import { useEffect, useRef, useState } from 'react'
import type { CatalogResponse, CatalogReviewItem, CatalogReviewResponse, CatalogVariantRecord, OrderRecord } from '../../app/types'
import { readJsonResponse } from '../../app/utils'
import type { CatalogResolutionContext, CatalogResolutionProduct, CatalogResolutionResponse } from '../../../shared/api-contracts'
import { clean, normalize, fields, fieldLabel, initialDraft, nextQuestion, compoundRemainder, rankedProducts, rankedReferenceValues, referenceValues, segmentCompoundRemainder, needsReference, createResolutionSession } from './catalogResolutionFlow'
import type { Draft, Field } from './catalogResolutionFlow'
import './OrderCatalogResolutionModal.css'

type Props = {
  order: OrderRecord | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  isAdmin: boolean
  onClose: () => void
  onCompleted: (order: OrderRecord) => boolean | void | Promise<boolean | void>
  onRequestAdminMode?: () => void
  onOpenFullReview?: (order: OrderRecord) => void | Promise<void>
}
const displayFact = (field: Field, value: string) => field === 'category' ? (value === 'child' ? 'Детский' : 'Взрослый') : field === 'gender' ? (value === 'ЖЕН' ? 'Женский' : value === 'МУЖ' ? 'Мужской' : value) : value

export function OrderCatalogResolutionModal({ order, apiFetch, isAdmin, onClose, onCompleted, onRequestAdminMode }: Props) {
  const [item, setItem] = useState<CatalogReviewItem | null>(null)
  const [context, setContext] = useState<CatalogResolutionContext | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [choices, setChoices] = useState<CatalogResolutionProduct[]>([])
  const [busy, setBusy] = useState(true)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [variantQuery, setVariantQuery] = useState('')
  const [classified, setClassified] = useState(false)
  const [confirmed, setConfirmed] = useState<Partial<Record<Field, boolean>>>({})
  const [legacy, setLegacy] = useState(false)
  const [editing, setEditing] = useState<Field | null>(null)
  const [answer, setAnswer] = useState('')
  const [creatingReference, setCreatingReference] = useState<Field | null>(null)
  const [compoundOverride, setCompoundOverride] = useState<string | null>(null)
  const [needsRecheck, setNeedsRecheck] = useState(false)
  const [progress, setProgress] = useState({ total: 0, remaining: 0 })
  const generation = useRef(0)
  const session = useRef(createResolutionSession())
  const catalogPromise = useRef<Promise<CatalogResponse> | null>(null)
  const previewPending = useRef(false)
  const mutationPending = useRef(false)
  const dialog = useRef<HTMLDivElement>(null)
  const questionHeading = useRef<HTMLHeadingElement>(null)

  const read = async <T extends object>(path: string, init?: RequestInit) => {
    const response = await apiFetch(path, { cache: 'no-store', ...init })
    if (response.headers.get('X-Orders-App-Stale') === '1') throw new Error('Нужны свежие данные. Повторите проверку.')
    const data = await readJsonResponse<T & { ok?: boolean; message?: string }>(response, 'Уточнение товара')
    if (data.ok === false) throw new Error(data.message || 'Не удалось проверить товар.')
    return data
  }
  const readContext = (orderItemId: number, next?: Draft) => {
    const params = new URLSearchParams()
    if (next) for (const key of ['productId', ...fields] as const) params.set(key, String(next[key]))
    return read<CatalogResolutionContext>(`/api/orders/${order!.id}/catalog-review/${orderItemId}/context?${params}`)
  }
  const load = async () => {
    if (!order) return false
    const ticket = ++generation.current
    setBusy(true); setError('')
    try {
      const review = await read<CatalogReviewResponse>(`/api/orders/${order.id}/catalog-review`)
      if (ticket !== generation.current) return false
      if (!Array.isArray(review.items) || !Number.isInteger(review.count) || review.count < 0) throw new Error('Не удалось проверить все товары. Повторите.')
      const first = review.items?.[0]
      if (!first) {
        if (review.count !== 0 || review.truncated) throw new Error('Не удалось закончить проверку товаров. Повторите.')
        setItem(null); setDraft(null); setContext(null)
        if (!session.current.changed) setError('Список уточнений пуст. Отправка не продолжена. Закройте окно и проверьте заказ.')
        return true
      }
      const data = await readContext(first.orderItemId)
      if (ticket !== generation.current) return false
      setItem(first); setContext(data); setDraft(initialDraft(first, data)); setChoices(data.products || [])
      setProgress(previous => ({ total: previous.total || Number(review.count || review.items.length), remaining: Number(review.count || review.items.length) }))
      setConfirmed({}); setClassified(false); setLegacy(false); setEditing(null); setAnswer(''); setCreatingReference(null); setCompoundOverride(null)
      setSearchOpen(false); setSearch(''); setAdvancedOpen(false); setVariantQuery(''); setNeedsRecheck(false)
      return false
    } finally { if (ticket === generation.current) setBusy(false) }
  }
  useEffect(() => {
    const owner = createResolutionSession()
    session.current = owner
    // Every order owns its own resolver activity. Never inherit a pending click/request
    // from the previously opened order; stale async work is already fenced by generation/session.
    previewPending.current = false
    mutationPending.current = false
    setResolving(false)
    setItem(null); setDraft(null); setContext(null); setProgress({ total: 0, remaining: 0 }); setNotice('')
    setNeedsRecheck(false); setCatalog(null); catalogPromise.current = null
    void load().catch(value => { if (owner === session.current) setError(value instanceof Error ? value.message : 'Не удалось загрузить товар.') })
    return () => { generation.current++; session.current = createResolutionSession() }
    // Every order owns a separate completion latch; passive loading cannot complete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id])

  const sourceRemainder = item && context?.product ? compoundRemainder(item.productName, context.product.name) : ''
  const remainder = compoundOverride === null ? sourceRemainder : compoundOverride
  const compoundParts = context && draft && remainder
    ? segmentCompoundRemainder(remainder, context, draft)
    : { segments: [], unknown: '', complete: false }
  const alreadyClassified = Boolean(remainder && [draft?.material, draft?.color].some(v => normalize(v) === remainder))
  const question = context && draft ? nextQuestion(context, draft, { remainder, classified: classified || alreadyClassified, confirmed, legacy, editing }) : null
  const minimalFieldQuestion = question?.kind === 'field' && !editing && Boolean(context?.product)
  const questionKey = question ? `${item?.orderItemId}:${question.kind}:${'field' in question ? question.field : ''}` : ''
  useEffect(() => { if (!busy) questionHeading.current?.focus() }, [questionKey, busy])

  const preview = async (next: Draft) => {
    if (!item || previewPending.current || resolving) return
    const ticket = ++generation.current
    previewPending.current = true
    setDraft(next); setBusy(true); setError('')
    try {
      if (!next.createProduct) {
        const data = await readContext(item.orderItemId, next)
        if (ticket !== generation.current) return
        setContext(data)
        // Only canonicalize supplied facts; blank source color/size stay unconfirmed.
        setDraft({ ...next, genderScope: data.product?.genderScope || '', gender: data.facts?.gender || next.gender,
          material: data.facts?.material || next.material, length: data.facts?.length || next.length,
          color: next.color ? data.facts?.color || next.color : '', size: next.size ? data.facts?.size || next.size : '' })
        if (data.products?.length) setChoices(data.products)
      }
    } catch (value) {
      if (ticket === generation.current) { setContext(current => current ? { ...current, exactVariant: null, existingVariantId: null } : current); setError(value instanceof Error ? value.message : 'Не удалось проверить ответ.') }
    } finally { previewPending.current = false; if (ticket === generation.current) setBusy(false) }
  }
  const answerField = (field: Field, value: string) => {
    if (!draft || !clean(value)) return
    setNotice(`${fieldLabel(field, field === 'category' ? value : draft.category)}: ${displayFact(field, value)} ✓`)
    setConfirmed(current => ({ ...current, [field]: true })); setEditing(null); setCreatingReference(null); setAnswer('')
    if (field === 'gender') setLegacy(false)
    void preview({ ...draft, [field]: value, createFields: draft.createFields?.filter(f => f !== field) })
  }
  const chooseProduct = (product: CatalogResolutionProduct) => {
    if (!draft) return
    setNotice(`Мы нашли: ${product.name} ✓`); setClassified(false); setCompoundOverride(null); setLegacy(false); setSearchOpen(false); setConfirmed({}); setCreatingReference(null)
    void preview({ ...draft, productId: product.id, createProduct: false, genderScope: product.genderScope || '', gender: clean(item?.gender) })
  }
  const openAdvanced = async (createProduct = false) => {
    if (!isAdmin || resolving || busy) return
    setError('')
    if (createProduct && draft) {
      setDraft({ ...draft, productId: 0, createProduct: true, genderScope: '' })
      setContext(current => current ? { ...current, exactVariant: null, existingVariantId: null } : current)
      setAdvancedOpen(true)
      return
    }
    setBusy(true)
    const ticket = generation.current
    try {
      // Full catalog is only needed for the explicit existing-product/manual fallback.
      if (!catalogPromise.current) catalogPromise.current = read<CatalogResponse>('/api/catalog').catch(error => { catalogPromise.current = null; throw error })
      const data = await catalogPromise.current
      if (ticket !== generation.current) return
      setCatalog(data); setAdvancedOpen(true)
    } catch (value) { if (ticket === generation.current) setError(value instanceof Error ? value.message : 'Не удалось открыть редактирование.') }
    finally { if (ticket === generation.current) setBusy(false) }
  }
  const finish = async (variantId?: number, next = draft) => {
    if (!order || !item || !next || resolving || busy || error || previewPending.current || mutationPending.current) return
    mutationPending.current = true
    const owner = session.current, ticket = generation.current
    setResolving(true); setError('')
    try {
      await owner.run(async () => {
        const needsAdminCatalogMutation = !variantId && Boolean(next.createProduct || next.createFields?.length || legacy)
        if (needsAdminCatalogMutation && !isAdmin) throw new Error('Нужен администратор, чтобы добавить это в каталог.')
        const path = variantId ? `/api/orders/${order.id}/catalog-review/${item.orderItemId}/resolve-existing`
          : `/api/orders/${order.id}/catalog-review/${item.orderItemId}/resolve-facts`
        await read<CatalogResolutionResponse>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(variantId ? { variantId } : { ...next, legacyUnknownGender: legacy }) })
        if (ticket === generation.current) { setNeedsRecheck(true); setNotice('Товар уточнён ✓ Проверяю остальные позиции…') }
      }, async () => ticket === generation.current ? load() : false, async () => owner === session.current ? await onCompleted(order) : false)
    } catch (value) { if (owner === session.current) setError(value instanceof Error ? value.message : 'Не удалось сохранить товар.') }
    finally { mutationPending.current = false; if (owner === session.current) setResolving(false) }
  }
  const retry = async () => {
    setError('')
    const owner = session.current
    try {
      if (needsRecheck) await owner.run(null, load, async () => order && owner === session.current ? await onCompleted(order) : false)
      else if (item && draft) await preview(draft)
      else await load()
    } catch (value) { if (owner === session.current) setError(value instanceof Error ? value.message : 'Не удалось проверить товар.') }
  }
  const editDraft = (field: keyof Draft, value: string | boolean | number) => {
    setDraft(current => current ? { ...current, [field]: value, createFields: current.createFields?.filter(f => f !== field) } : current)
    setContext(current => current ? { ...current, exactVariant: null, existingVariantId: null } : current)
  }
  const chooseVariant = (variant: CatalogVariantRecord) => {
    if (!draft) return
    setNotice('Характеристики выбранного товара показаны ниже ✓')
    void preview({ ...draft, createProduct: false, productId: variant.productId, category: variant.productCategory === 'child' ? 'child' : 'adult', gender: clean(variant.gender), color: clean(variant.color) || 'БЕЗ ЦВЕТА', material: clean(variant.material) || 'СТАНДАРТ', length: clean(variant.length) || 'СТАНДАРТ', size: clean(variant.sizeLabel) || 'БЕЗ РАЗМЕРА', createFields: [] })
  }
  if (!order) return null
  const exactDraftVariant = context?.exactVariant
  const canLegacy = isAdmin && Boolean(context?.canLeaveGenderUnknown) && !draft?.createProduct
  const disabled = busy || resolving || needsRecheck
  const approveReference = (field: Field, value = clean(draft?.[field])) => {
    if (!draft || !clean(value)) return
    const next = {
      ...draft,
      [field]: clean(value),
      createFields: [...new Set([...(draft.createFields || []), field])],
    }
    setDraft(next)
    setContext(current => current ? { ...current, exactVariant: null, existingVariantId: null } : current)
    setConfirmed(current => ({ ...current, [field]: true }))
    setCreatingReference(null); setEditing(null); setAnswer('')
    setNotice(`Новое значение: «${clean(value)}» ✓`)
  }
  const applyCompoundSegments = (segments: typeof compoundParts.segments, unknown = '') => {
    if (!draft || !segments.length) return
    let next = { ...draft }
    const nextConfirmed = { ...confirmed }
    for (const segment of segments) {
      next = { ...next, [segment.field]: segment.value }
      nextConfirmed[segment.field] = true
    }
    setConfirmed(nextConfirmed)
    setCompoundOverride(unknown)
    setClassified(!unknown)
    setCreatingReference(null); setEditing(null); setAnswer('')
    setNotice(unknown
      ? `Распознано: ${segments.map(segment => `${fieldLabel(segment.field, next.category)} — ${segment.value}`).join(' · ')}. Осталось уточнить «${unknown}».`
      : `Разобрано: ${segments.map(segment => `${fieldLabel(segment.field, next.category)} — ${segment.value}`).join(' · ')} ✓`)
    void preview(next)
  }
  const finalAction = () => {
    if (!draft || !context) return null
    const needsAdminCatalogMutation = Boolean(draft.createProduct || draft.createFields?.length || legacy)
    if (!isAdmin && needsAdminCatalogMutation) return <div className="resolution-admin-required"><p>Нужен администратор, чтобы добавить это в каталог.</p>{onRequestAdminMode ? <button type="button" className="primary-button" onClick={onRequestAdminMode}>Войти как администратор</button> : null}</div>
    return <button type="button" className="primary-button" disabled={disabled || Boolean(error)} onClick={() => void finish(legacy ? undefined : exactDraftVariant?.id)}>{resolving ? 'Сохраняю…' : 'Сохранить и продолжить'}</button>
  }
  const renderQuestion = () => {
    if (!question || !draft || !context || !item) return null
    if (question.kind === 'product') {
      const sorted = rankedProducts(choices, item.productName)
      const searchRanked = rankedProducts(choices, search || item.productName)
      const shown = (searchOpen ? searchRanked : sorted).filter(entry => entry.score > 0).slice(0, searchOpen ? 10 : 6)
      return <><h4 ref={questionHeading} tabIndex={-1}>Выберите товар</h4>
        {searchOpen ? <label>Поиск по каталогу<input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Название товара" /></label> : null}
        <div className="resolution-choices">{shown.map(({ product }) => <button type="button" key={product.id} onClick={() => chooseProduct(product)}>{product.name}</button>)}</div>
        {searchOpen && !shown.length ? <p>Пока ничего подходящего не видно. Попробуйте часть названия.</p> : null}
        {!searchOpen ? <button type="button" className="secondary-button" onClick={() => setSearchOpen(true)}>Другой товар</button> : null}
        {isAdmin ? <div className="resolution-new-value-actions">
          <button type="button" className="secondary-button" onClick={() => void openAdvanced(true)}>Новый товар</button>
          <button type="button" className="resolution-link" onClick={() => void openAdvanced()}>Весь каталог</button>
        </div> : <div className="resolution-admin-required">
          <p>Нет такого товара? Попросите администратора добавить его.</p>
          <div className="resolution-inline-actions">
            {onRequestAdminMode ? <button type="button" className="secondary-button" onClick={onRequestAdminMode}>Войти как администратор</button> : null}
            <button type="button" className="resolution-link" onClick={() => void load()}>Проверить снова</button>
          </div>
        </div>}</>
    }
    if (question.kind === 'compound') {
      const wholeFragment = compoundOverride === null ? sourceRemainder : remainder
      if (compoundParts.complete) return <><h4 ref={questionHeading} tabIndex={-1}>Проверьте характеристики</h4>
        <div className="resolution-segment-list">{compoundParts.segments.map(segment => <span key={`${segment.field}-${segment.start}-${segment.value}`}><small>{fieldLabel(segment.field, draft.category)}</small><strong>{segment.value}</strong></span>)}</div>
        <div className="resolution-choices">
          <button type="button" className="primary-button" onClick={() => applyCompoundSegments(compoundParts.segments)}>Всё верно</button>
          <button type="button" onClick={() => { setClassified(true); setCompoundOverride(''); answerField('material', wholeFragment) }}>Это один материал</button>
          <button type="button" onClick={() => { setSearchOpen(true); setCompoundOverride(null); setNotice('Выберите правильный товар'); void preview({ ...draft, productId: 0 }) }}>Другой товар</button>
        </div></>
      if (compoundParts.segments.length && compoundParts.unknown) return <><h4 ref={questionHeading} tabIndex={-1}>Что означает «{compoundParts.unknown}»?</h4>
        <small className="resolution-eyebrow">Уже распознано</small><div className="resolution-segment-list">{compoundParts.segments.map(segment => <span key={`${segment.field}-${segment.start}-${segment.value}`}><small>{fieldLabel(segment.field, draft.category)}</small><strong>{segment.value}</strong></span>)}</div>
        <div className="resolution-choices">
          <button type="button" className="primary-button" onClick={() => applyCompoundSegments(compoundParts.segments, compoundParts.unknown)}>Уточнить «{compoundParts.unknown}»</button>
          <button type="button" onClick={() => { setClassified(true); setCompoundOverride(''); answerField('material', wholeFragment) }}>Вся фраза — материал</button>
          <button type="button" onClick={() => { setSearchOpen(true); setCompoundOverride(null); setNotice('Выберите правильный товар'); void preview({ ...draft, productId: 0 }) }}>Другой товар</button>
        </div></>
      return <><h4 ref={questionHeading} tabIndex={-1}>Что означает «{remainder}»?</h4>
        <div className="resolution-choices">
          <button type="button" onClick={() => { setClassified(true); setCompoundOverride(''); answerField('material', remainder) }}>Материал</button>
          <button type="button" onClick={() => { setClassified(true); setCompoundOverride(''); answerField('color', remainder) }}>Цвет</button>
          <button type="button" onClick={() => { setClassified(true); setCompoundOverride(''); answerField('length', remainder) }}>Длина</button>
          <button type="button" onClick={() => { setClassified(true); setCompoundOverride(''); answerField('size', remainder) }}>{draft.category === 'child' ? 'Возраст' : 'Размер'}</button>
          <button type="button" onClick={() => { setSearchOpen(true); setCompoundOverride(null); setNotice('Выберите правильный товар'); void preview({ ...draft, productId: 0 }) }}>Часть названия товара</button>
        </div></>
    }
    if (question.kind === 'combined') return <><h4 ref={questionHeading} tabIndex={-1}>Цвет и {draft.category === 'child' ? 'возраст' : 'размер'} не указаны</h4><p>Они действительно не нужны для этого товара?</p><div className="resolution-choices">
      <button type="button" className="primary-button" onClick={() => { const next = { ...draft, color: 'БЕЗ ЦВЕТА', size: 'БЕЗ РАЗМЕРА' }; setDraft(next); setNotice(`Без цвета и без ${draft.category === 'child' ? 'возраста' : 'размера'} ✓`); void finish(exactDraftVariant?.id, next) }}>Да, не нужны</button>
      <button type="button" onClick={() => { setEditing('color'); setAnswer('') }}>Указать</button>
    </div></>
    if (question.kind === 'reference') {
      const field = question.field
      const label = fieldLabel(field, draft.category)
      const suggestions = rankedReferenceValues(referenceValues(context, draft, field), draft[field], field)
        .filter(entry => entry.score >= 5000 && normalize(entry.value) !== normalize(draft[field]))
        .slice(0, 3)
      if (creatingReference === field) return <><h4 ref={questionHeading} tabIndex={-1}>Новый {label.toLowerCase()}</h4>
        <form onSubmit={event => { event.preventDefault(); approveReference(field, answer) }}>
          <label>Название<input autoFocus value={answer} onChange={event => setAnswer(event.target.value)} /></label>
          <div className="resolution-inline-actions">
            <button type="button" className="primary-button" disabled={!clean(answer)} onClick={() => approveReference(field, answer)}>Добавить</button>
            <button type="button" className="secondary-button" onClick={() => { setCreatingReference(null); setAnswer('') }}>Назад</button>
          </div>
        </form></>
      return <><h4 ref={questionHeading} tabIndex={-1}>Проверьте {label.toLowerCase()}</h4><p className="resolution-current-value">В заказе: <strong>{draft[field]}</strong></p>
        {suggestions.length ? <div className="resolution-suggestion"><small>Возможно</small><div className="resolution-choices">{suggestions.map(entry => <button type="button" className={entry === suggestions[0] ? 'primary-button' : ''} key={entry.value} onClick={() => answerField(field, entry.value)}>{entry.value}</button>)}</div></div> : null}
        <div className="resolution-inline-actions">
          <button type="button" className="secondary-button" onClick={() => { setEditing(field); setCreatingReference(null); setAnswer('') }}>Другой вариант</button>
          {isAdmin ? <button type="button" className="secondary-button" onClick={() => { setCreatingReference(field); setAnswer(draft[field]) }}>Новый {label.toLowerCase()}</button> : null}
        </div>
        {!isAdmin ? <div className="resolution-admin-required"><p>Нет такого значения? Попросите администратора добавить его.</p><div className="resolution-inline-actions">{onRequestAdminMode ? <button type="button" className="secondary-button" onClick={onRequestAdminMode}>Войти как администратор</button> : null}<button type="button" className="resolution-link" onClick={() => void preview(draft)}>Проверить снова</button></div></div> : null}</>
    }
    if (question.kind === 'field') {
      const field = question.field
      const label = fieldLabel(field, draft.category)
      const small = field === 'gender' ? [['ЖЕН', 'Жен'], ['МУЖ', 'Муж']] : field === 'category' ? [['adult', 'Взрослый'], ['child', 'Детский']] : []
      const heading = clean(draft[field])
        ? `Уточните: ${label.toLowerCase()}`
        : field === 'category' ? 'Это взрослый или детский товар?'
          : field === 'length' ? 'Не указана длина'
            : `Не указан ${label.toLowerCase()}`
      const values = referenceValues(context, draft, field)
      const ranked = rankedReferenceValues(values, answer, field)
      const matched = ranked.filter(entry => entry.score > 0)
      const visibleValues = (clean(answer) && matched.length ? matched.map(entry => entry.value) : [...values].sort((a, b) => a.localeCompare(b, 'ru'))).slice(0, 12)
      return <>{minimalFieldQuestion && context.product ? <strong>{context.product.name}</strong> : null}<h4 ref={questionHeading} tabIndex={-1}>{heading}</h4>
        {small.length ? <div className="resolution-choices">{small.map(([value, text]) => <button type="button" key={value} onClick={() => answerField(field, value)}>{text}</button>)}</div> : <>
          {!editing && (field === 'color' || field === 'size') ? <div className="resolution-choices"><button type="button" onClick={() => answerField(field, field === 'color' ? 'БЕЗ ЦВЕТА' : 'БЕЗ РАЗМЕРА')}>{field === 'color' ? 'Без цвета' : draft.category === 'child' ? 'Без возраста' : 'Без размера'}</button><button type="button" onClick={() => { setEditing(field); setCreatingReference(null); setAnswer('') }}>{field === 'color' ? 'Выбрать цвет' : `Выбрать ${label.toLowerCase()}`}</button></div> : <form onSubmit={event => { event.preventDefault(); answerField(field, answer) }}>
            <label>{label}<input autoFocus value={answer} onChange={event => setAnswer(event.target.value)} placeholder={`Введите или выберите ${label.toLowerCase()}`} /></label>
            {values.length ? <div className="resolution-combobox" role="listbox" aria-label={`Справочник: ${label}`}><small>{clean(answer) && matched.length ? 'Подходящие варианты' : 'Все варианты'}</small><div className="resolution-combobox-list">{visibleValues.map(value => <button type="button" key={value} onClick={() => answerField(field, value)}>{value}</button>)}</div></div> : null}
            <button type="submit" className="primary-button" disabled={!clean(answer)}>Подтвердить</button>
          </form>}
        </>}
        {field === 'gender' && canLegacy ? <button type="button" className="resolution-link" onClick={() => { setLegacy(true); setNotice('Пол останется неизвестным для этой позиции ✓') }}>Не удалось выяснить</button> : null}</>
    }
    return <><h4 ref={questionHeading} tabIndex={-1}>{question.kind === 'workshop' ? 'Подтвердите товар для Цеха' : 'Всё необходимое уточнено'}</h4>{finalAction()}</>
  }
  return <div className="modal-backdrop order-catalog-resolution-backdrop"><div ref={dialog} className="modal-card order-catalog-resolution-modal" role="dialog" aria-modal="true" aria-labelledby="resolution-title" onKeyDown={event => {
    if (event.key === 'Escape' && !resolving) onClose()
    if (event.key === 'Tab') {
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter(node => node.getClientRects().length)
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <header><div><h3 id="resolution-title">Уточнить товар</h3><small>{order.external_id || `Заказ #${order.id}`}{progress.total > 1 ? ` · Товар ${progress.total - progress.remaining + 1} из ${progress.total}` : ''}</small></div><button type="button" className="secondary-button" disabled={resolving} onClick={onClose}>Закрыть</button></header>
    {item && !minimalFieldQuestion ? <section className="resolution-source"><small>В заказе</small><strong>{item.productName}</strong><span>{[item.gender, item.material, normalize(item.length) !== 'СТАНДАРТ' ? item.length : '', context?.isWorkshop ? '' : item.color || 'Цвет не указан', context?.isWorkshop ? '' : item.size || (draft?.category === 'child' ? 'Возраст не указан' : 'Размер не указан')].filter(Boolean).join(' · ')}</span></section> : null}
    {draft && context && !minimalFieldQuestion ? <section className="resolution-understanding"><small className="resolution-eyebrow">{draft.createProduct ? 'Новый товар' : context.product ? 'В каталоге' : 'Товар'}</small><strong>{draft.createProduct ? draft.productName : context.product ? context.product.name : 'Не выбран'}</strong>
      {!context.isWorkshop ? <p>{fields.filter(field => clean(draft[field]) && (field !== 'length' || normalize(draft.length) !== 'СТАНДАРТ')).map(field => <span key={field}>{fieldLabel(field, draft.category)}: {displayFact(field, draft[field])}{confirmed[field] ? ' ✓' : ''}</span>)}</p> : <p>Для Цеха нужно уточнить только сам товар.</p>}
    </section> : null}
    {!minimalFieldQuestion && notice ? <div role="status" aria-live="polite" className="resolution-feedback">{notice}</div> : null}
    {error ? <div role="alert" className="resolution-error"><p>{error}</p><button type="button" className="secondary-button" disabled={busy || resolving} onClick={() => void retry()}>{needsRecheck ? 'Проверить оставшиеся позиции' : 'Повторить проверку'}</button></div> : null}
    {busy ? <p role="status">Проверяю товар…</p> : null}
    {!advancedOpen ? <fieldset disabled={disabled || Boolean(error)} className="resolution-question" aria-busy={disabled}>{!needsRecheck ? renderQuestion() : <p>Товар сохранён. Проверяем, остались ли ещё вопросы.</p>}</fieldset> : draft && context ? <section className="resolution-advanced">
      <h4>{draft.createProduct ? 'Новый товар' : 'Исправить товар вручную'}</h4>
      <fieldset disabled={disabled}>
        {draft.createProduct ? <>
          <label>Название нового товара<input autoFocus value={draft.productName} onChange={e => editDraft('productName', e.target.value)} /></label>
          <label>Для кого<select value={draft.genderScope} onChange={e => { editDraft('genderScope', e.target.value); editDraft('gender', e.target.value === 'female' ? 'ЖЕН' : e.target.value === 'male' ? 'МУЖ' : '') }}><option value="">Выберите</option><option value="female">Женский</option><option value="male">Мужской</option><option value="unisex">Для обоих полов</option></select></label>
          <div className="resolution-known-facts">
            <small>Характеристики из заказа</small>
            <p>{fields.filter(field => field !== 'gender' && clean(draft[field])).map(field => <span key={field}>{fieldLabel(field, draft.category)}: <strong>{displayFact(field, draft[field])}</strong></span>)}</p>
          </div>
          <button type="button" className="resolution-link" onClick={() => { setAdvancedOpen(false); setDraft({ ...draft, productId: 0, createProduct: false, genderScope: '' }); setContext(current => current ? { ...current, product: null, exactVariant: null, existingVariantId: null } : current); setNotice('Выберите существующий товар из каталога') }}>Нет, это существующий товар</button>
          <button type="button" className="primary-button" disabled={!clean(draft.productName) || !draft.genderScope} onClick={() => { setAdvancedOpen(false); setClassified(true); setEditing(null); void preview(draft) }}>Продолжить уточнение</button>
          {!clean(draft.productName) || !draft.genderScope ? <small className="resolution-form-hint">Заполните название и поле «Для кого».</small> : null}
        </> : <>
          <label>Товар<select value={draft.productId} onChange={e => { const product = catalog?.products.find(p => p.id === Number(e.target.value)); if (product) chooseProduct(product) }}><option value="">Выберите товар</option>{catalog?.products.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button type="button" className="resolution-link" onClick={() => { setAdvancedOpen(false); void openAdvanced(true) }}>Это действительно новый товар</button>
          <label>Найти существующий товар с нужными характеристиками<input value={variantQuery} onChange={e => setVariantQuery(e.target.value)} /></label>
          <div className="resolution-choices">{(catalog?.variants || []).filter(v => v.isActive && v.productId === draft.productId && normalize([v.gender, v.material, v.length, v.color, v.sizeLabel].join(' ')).includes(normalize(variantQuery))).slice(0, 12).map(v => <button type="button" key={v.id} onClick={() => chooseVariant(v)}>{[v.gender, v.material, v.length, v.color || 'БЕЗ ЦВЕТА', v.sizeLabel || 'БЕЗ РАЗМЕРА'].join(' · ')}</button>)}</div>
          {!context.isWorkshop ? <div className="resolution-fields">{fields.map(field => <label key={field}>{fieldLabel(field, draft.category)}{field === 'category' || field === 'gender' ? <select value={draft[field]} onChange={e => editDraft(field, e.target.value)}>{field === 'gender' ? <><option value="">Не указан</option><option value="ЖЕН">Женский</option><option value="МУЖ">Мужской</option></> : <><option value="adult">Взрослый</option><option value="child">Детский</option></>}</select> : <><input list={`advanced-${field}`} value={draft[field]} onChange={e => editDraft(field, e.target.value)} /><datalist id={`advanced-${field}`}>{referenceValues(context, draft, field).map(v => <option key={v} value={v} />)}</datalist></>}{needsReference(context, draft, field) && !draft.createFields?.includes(field) ? <button type="button" onClick={() => approveReference(field)}>Добавить «{draft[field]}» для следующих заказов</button> : null}</label>)}</div> : null}
          <button type="button" className="primary-button" onClick={() => { setAdvancedOpen(false); setClassified(true); setEditing(null); void preview(draft) }}>Продолжить</button>
        </>}
      </fieldset>
    </section> : null}
    {isAdmin && item && !advancedOpen && !minimalFieldQuestion ? <footer><button type="button" className="resolution-link" disabled={disabled} onClick={() => void openAdvanced()}>Исправить вручную</button></footer> : null}
  </div></div>
}
