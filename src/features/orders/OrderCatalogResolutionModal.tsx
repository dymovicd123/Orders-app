import { useEffect, useRef, useState } from 'react'
import type { CatalogResponse, CatalogReviewItem, CatalogReviewResponse, CatalogVariantRecord, OrderRecord } from '../../app/types'
import { readJsonResponse } from '../../app/utils'
import type { CatalogResolutionContext, CatalogResolutionProduct, CatalogResolutionResponse } from '../../../shared/api-contracts'
import { clean, normalize, fields, labels, initialDraft, nextQuestion, compoundRemainder, rankedProducts, referenceValues, needsReference, createResolutionSession } from './catalogResolutionFlow'
import type { Draft, Field } from './catalogResolutionFlow'
import './OrderCatalogResolutionModal.css'

type Props = {
  order: OrderRecord | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  isAdmin: boolean
  onClose: () => void
  onCompleted: (order: OrderRecord) => void | Promise<void>
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
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [variantQuery, setVariantQuery] = useState('')
  const [classified, setClassified] = useState(false)
  const [confirmed, setConfirmed] = useState<Partial<Record<Field, boolean>>>({})
  const [legacy, setLegacy] = useState(false)
  const [editing, setEditing] = useState<Field | null>(null)
  const [answer, setAnswer] = useState('')
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
      if (!Array.isArray(review.items) || !Number.isInteger(review.count) || review.count < 0) throw new Error('Список позиций не подтверждён. Повторите проверку.')
      const first = review.items?.[0]
      if (!first) {
        if (review.count !== 0 || review.truncated) throw new Error('Не удалось получить все позиции. Повторите проверку.')
        setItem(null); setDraft(null); setContext(null)
        if (!session.current.changed) setError('Список уточнений пуст. Отправка не продолжена. Закройте окно и проверьте заказ.')
        return true
      }
      const data = await readContext(first.orderItemId)
      if (ticket !== generation.current) return false
      setItem(first); setContext(data); setDraft(initialDraft(first, data)); setChoices(data.products || [])
      setProgress(previous => ({ total: previous.total || Number(review.count || review.items.length), remaining: Number(review.count || review.items.length) }))
      setConfirmed({}); setClassified(false); setLegacy(false); setEditing(null); setAnswer('')
      setSearchOpen(false); setSearch(''); setAdvancedOpen(false); setFallbackOpen(false); setVariantQuery(''); setNeedsRecheck(false)
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

  const remainder = item && context?.product ? compoundRemainder(item.productName, context.product.name) : ''
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
    setNotice(`${labels[field]}: ${displayFact(field, value)} ✓`)
    setConfirmed(current => ({ ...current, [field]: true })); setEditing(null); setAnswer('')
    if (field === 'gender') setLegacy(false)
    void preview({ ...draft, [field]: value, createFields: draft.createFields?.filter(f => f !== field) })
  }
  const chooseProduct = (product: CatalogResolutionProduct) => {
    if (!draft) return
    setNotice(`Мы нашли: ${product.name} ✓`); setClassified(false); setLegacy(false); setSearchOpen(false); setConfirmed({})
    void preview({ ...draft, productId: product.id, createProduct: false, genderScope: product.genderScope || '', gender: clean(item?.gender) })
  }
  const openAdvanced = async (createProduct = false) => {
    if (!isAdmin || resolving || busy) return
    setBusy(true); setError('')
    const ticket = generation.current
    try {
      // The only full-catalog read: explicit admin fallback, reused on subsequent opens.
      if (!catalogPromise.current) catalogPromise.current = read<CatalogResponse>('/api/catalog').catch(error => { catalogPromise.current = null; throw error })
      const data = await catalogPromise.current
      if (ticket !== generation.current) return
      setCatalog(data); setAdvancedOpen(true)
      if (createProduct && draft) { setDraft({ ...draft, productId: 0, createProduct: true, genderScope: '' }); setContext(current => current ? { ...current, exactVariant: null } : current) }
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
        if (needsAdminCatalogMutation && !isAdmin) throw new Error('Нужно добавить новый товар или новое значение справочника. Для этого требуется Админ режим; переходить на Склад не нужно.')
        const path = variantId ? `/api/orders/${order.id}/catalog-review/${item.orderItemId}/resolve-existing`
          : `/api/orders/${order.id}/catalog-review/${item.orderItemId}/resolve-facts`
        await read<CatalogResolutionResponse>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(variantId ? { variantId } : { ...next, legacyUnknownGender: legacy }) })
        if (ticket === generation.current) { setNeedsRecheck(true); setNotice('Товар уточнён ✓ Проверяю остальные позиции…') }
      }, async () => ticket === generation.current ? load() : false, async () => { if (owner === session.current) await onCompleted(order) })
    } catch (value) { if (owner === session.current) setError(value instanceof Error ? value.message : 'Не удалось сохранить товар.') }
    finally { mutationPending.current = false; if (owner === session.current) setResolving(false) }
  }
  const retry = async () => {
    setError('')
    const owner = session.current
    try {
      if (needsRecheck) await owner.run(null, load, async () => { if (order && owner === session.current) await onCompleted(order) })
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
  const approveReference = (field: Field) => { setDraft(current => current ? { ...current, createFields: [...(current.createFields || []), field] } : current); setNotice(`«${draft?.[field]}» будет добавлено при сохранении ✓`) }
  const finalAction = () => {
    if (!draft || !context) return null
    const needsAdminCatalogMutation = Boolean(draft.createProduct || draft.createFields?.length || legacy)
    if (!isAdmin && needsAdminCatalogMutation) return <div className="resolution-admin-required"><p>Нужно изменить каталог для этого заказа. Войдите в Админ режим — после входа вы останетесь в этом же уточнении.</p>{onRequestAdminMode ? <button type="button" className="primary-button" onClick={onRequestAdminMode}>Войти в Админ режим и продолжить</button> : null}</div>
    return <><p>{legacy ? 'Пол останется неизвестным только у этой позиции. Сам товар в каталоге от этого не изменится.' : exactDraftVariant || context.isWorkshop ? 'Будет уточнён товар в заказе. Затем система автоматически продолжит отправку.' : 'Все факты уже известны. Система создаст недостающую комбинацию этого товара и автоматически продолжит отправку.'}</p>
      <button type="button" className="primary-button" disabled={disabled || Boolean(error)} onClick={() => void finish(legacy ? undefined : exactDraftVariant?.id)}>{resolving ? 'Сохраняю…' : legacy ? 'Сохранить и продолжить' : exactDraftVariant || context.isWorkshop ? 'Подтвердить товар' : 'Создать комбинацию и отправить'}</button></>
  }
  const renderQuestion = () => {
    if (!question || !draft || !context || !item) return null
    if (question.kind === 'product') {
      const sorted = rankedProducts(choices, item.productName)
      const shown = searchOpen ? sorted.filter(({ product }) => normalize(product.name).includes(normalize(search))).slice(0, 5) : sorted.filter(entry => entry.score > 0).slice(0, 4)
      return <><h4 ref={questionHeading} tabIndex={-1}>Какой это товар?</h4>
        {searchOpen ? <label>Найти товар<input autoFocus value={search} onChange={e => setSearch(e.target.value)} /></label> : null}
        <div className="resolution-choices">{shown.map(({ product }) => <button type="button" key={product.id} onClick={() => chooseProduct(product)}>{product.name}</button>)}</div>
        {searchOpen && !shown.length ? <p>Совпадений нет. Проверьте название или попросите администратора уточнить товар.</p> : null}
        {!searchOpen ? <button type="button" className="secondary-button" onClick={() => setSearchOpen(true)}>Найти другой товар</button> : null}
        {isAdmin ? <button type="button" className="resolution-link" onClick={() => void openAdvanced()}>Проверить весь каталог</button> : onRequestAdminMode ? <button type="button" className="resolution-link" onClick={onRequestAdminMode}>Не нашли товар — войти в Админ режим</button> : null}</>
    }
    if (question.kind === 'compound') return <><h4 ref={questionHeading} tabIndex={-1}>Что означает часть названия «{remainder}»?</h4><div className="resolution-choices">
      <button type="button" onClick={() => { setClassified(true); answerField('material', remainder) }}>Материал</button>
      <button type="button" onClick={() => { setClassified(true); answerField('color', remainder) }}>Цвет</button>
      <button type="button" onClick={() => { setSearchOpen(true); setNotice('Выберите правильный товар'); void preview({ ...draft, productId: 0 }) }}>Это часть названия / товар определён неверно</button>
    </div></>
    if (question.kind === 'combined') return <><h4 ref={questionHeading} tabIndex={-1}>В заказе не указаны цвет и размер. Этот товар действительно без цвета и без размера?</h4><div className="resolution-choices">
      <button type="button" className="primary-button" onClick={() => { const next = { ...draft, color: 'БЕЗ ЦВЕТА', size: 'БЕЗ РАЗМЕРА' }; setDraft(next); setNotice('Без цвета и без размера ✓'); void finish(exactDraftVariant?.id, next) }}>Да, всё верно</button>
      <button type="button" onClick={() => { setEditing('color'); setAnswer('') }}>Нет, исправить</button>
    </div></>
    if (question.kind === 'reference') return <><h4 ref={questionHeading} tabIndex={-1}>Значение «{draft[question.field]}» ещё не использовалось. Добавить?</h4><p>{labels[question.field]}: это значение станет доступно в следующих заказах. Добавление произойдёт при сохранении товара.</p>
      {isAdmin ? <button type="button" className="primary-button" onClick={() => approveReference(question.field)}>Добавить</button> : <div className="resolution-admin-required"><p>Добавить новое значение можно в Админ режиме. После входа это окно останется открытым.</p>{onRequestAdminMode ? <button type="button" className="primary-button" onClick={onRequestAdminMode}>Войти в Админ режим и продолжить</button> : null}</div>}
      <button type="button" className="secondary-button" onClick={() => { setEditing(question.field); setAnswer(draft[question.field]) }}>Исправить название</button></>
    if (question.kind === 'field') {
      const field = question.field
      const small = field === 'gender' ? [['ЖЕН', 'Жен'], ['МУЖ', 'Муж']] : field === 'category' ? [['adult', 'Взрослый'], ['child', 'Детский']] : []
      const heading = clean(draft[field])
        ? `Уточните: ${labels[field].toLowerCase()}`
        : field === 'category' ? 'Это взрослый или детский товар?'
          : field === 'length' ? 'Не указана длина'
            : `Не указан ${labels[field].toLowerCase()}`
      return <>{minimalFieldQuestion && context.product ? <strong>{context.product.name}</strong> : null}<h4 ref={questionHeading} tabIndex={-1}>{heading}</h4>
        {small.length ? <div className="resolution-choices">{small.map(([value, label]) => <button type="button" key={value} onClick={() => answerField(field, value)}>{label}</button>)}</div> : <>
          {!editing && (field === 'color' || field === 'size') ? <div className="resolution-choices"><button type="button" onClick={() => answerField(field, field === 'color' ? 'БЕЗ ЦВЕТА' : 'БЕЗ РАЗМЕРА')}>{field === 'color' ? 'Без цвета' : 'Без размера'}</button><button type="button" onClick={() => { setEditing(field); setAnswer('') }}>{field === 'color' ? 'Выбрать цвет' : 'Выбрать размер / возраст'}</button></div> : <form onSubmit={event => { event.preventDefault(); answerField(field, answer) }}><label>{labels[field]}<input autoFocus list="resolution-answers" value={answer} onChange={event => setAnswer(event.target.value)} /></label><datalist id="resolution-answers">{referenceValues(context, draft, field).map(value => <option key={value} value={value} />)}</datalist><button type="submit" className="primary-button" disabled={!clean(answer)}>Подтвердить</button>{!clean(answer) ? <small>Введите или выберите {labels[field].toLowerCase()}.</small> : null}</form>}
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
    <header><div><h3 id="resolution-title">Уточним товар перед отправкой</h3><small>{order.external_id || `Заказ #${order.id}`}{progress.total > 1 ? ` · Товар ${progress.total - progress.remaining + 1} из ${progress.total}` : ''}</small></div><button type="button" className="secondary-button" disabled={resolving} onClick={onClose}>Закрыть</button></header>
    {item && !minimalFieldQuestion ? <section className="resolution-source"><small>Менеджер записал</small><strong>{item.productName}</strong><span>{[item.gender, item.material, normalize(item.length) !== 'СТАНДАРТ' ? item.length : '', context?.isWorkshop ? '' : item.color || 'Цвет не указан', context?.isWorkshop ? '' : item.size || 'Размер не указан'].filter(Boolean).join(' · ')}</span></section> : null}
    {draft && context && !minimalFieldQuestion ? <section className="resolution-understanding"><strong>{draft.createProduct ? `Новый товар: ${draft.productName}` : context.product ? `Мы нашли: ${context.product.name}` : 'Товар пока не определён'}</strong>
      {!context.isWorkshop ? <p>{fields.filter(field => clean(draft[field]) && (field !== 'length' || normalize(draft.length) !== 'СТАНДАРТ')).map(field => <span key={field}>{labels[field]}: {displayFact(field, draft[field])}{confirmed[field] ? ' ✓' : ''}</span>)}</p> : <p>Для Цеха нужно уточнить только сам товар.</p>}
    </section> : null}
    {!minimalFieldQuestion ? <div role="status" aria-live="polite" className="resolution-feedback">{notice}</div> : null}
    {error ? <div role="alert" className="resolution-error"><p>{error}</p><button type="button" className="secondary-button" disabled={busy || resolving} onClick={() => void retry()}>{needsRecheck ? 'Проверить оставшиеся позиции' : 'Повторить проверку'}</button></div> : null}
    {busy ? <p role="status">Проверяю товар…</p> : null}
    {!advancedOpen ? <fieldset disabled={disabled || Boolean(error)} className="resolution-question" aria-busy={disabled}>{!needsRecheck ? renderQuestion() : <p>Товар сохранён. Проверяем, остались ли ещё вопросы.</p>}</fieldset> : draft && context ? <section className="resolution-advanced">
      <h4>Расширенное исправление</h4><p>Создание товара и новых характеристик изменяет каталог для следующих заказов. Само уточнение применяется только к этой позиции заказа.</p>
      <fieldset disabled={disabled}>
        <label>Товар<select value={draft.createProduct ? '' : draft.productId} onChange={e => { const product = catalog?.products.find(p => p.id === Number(e.target.value)); if (product) chooseProduct(product) }}><option value="">Выберите товар</option>{catalog?.products.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button type="button" className="resolution-link" onClick={() => { editDraft('createProduct', !draft.createProduct); if (!draft.createProduct) { editDraft('productId', 0); editDraft('genderScope', '') } }}>{draft.createProduct ? 'Выбрать существующий товар' : 'Создать новый товар'}</button>
        {draft.createProduct ? <><label>Название нового товара<input value={draft.productName} onChange={e => editDraft('productName', e.target.value)} /></label><label>Для кого<select value={draft.genderScope} onChange={e => { editDraft('genderScope', e.target.value); editDraft('gender', e.target.value === 'female' ? 'ЖЕН' : e.target.value === 'male' ? 'МУЖ' : '') }}><option value="">Выберите</option><option value="female">Женский</option><option value="male">Мужской</option><option value="unisex">Для обоих полов</option></select></label></> : <><label>Найти существующий товар с нужными характеристиками<input value={variantQuery} onChange={e => setVariantQuery(e.target.value)} /></label><div className="resolution-choices">{(catalog?.variants || []).filter(v => v.isActive && v.productId === draft.productId && normalize([v.gender, v.material, v.length, v.color, v.sizeLabel].join(' ')).includes(normalize(variantQuery))).slice(0, 12).map(v => <button type="button" key={v.id} onClick={() => chooseVariant(v)}>{[v.gender, v.material, v.length, v.color || 'БЕЗ ЦВЕТА', v.sizeLabel || 'БЕЗ РАЗМЕРА'].join(' · ')}</button>)}</div></>}
        {!context.isWorkshop ? <div className="resolution-fields">{fields.map(field => <label key={field}>{labels[field]}{field === 'category' || field === 'gender' ? <select value={draft[field]} onChange={e => editDraft(field, e.target.value)}>{field === 'gender' ? <><option value="">Не указан</option><option value="ЖЕН">Женский</option><option value="МУЖ">Мужской</option></> : <><option value="adult">Взрослый</option><option value="child">Детский</option></>}</select> : <><input list={`advanced-${field}`} value={draft[field]} onChange={e => editDraft(field, e.target.value)} /><datalist id={`advanced-${field}`}>{referenceValues(context, draft, field).map(v => <option key={v} value={v} />)}</datalist></>}{needsReference(context, draft, field) && !draft.createFields?.includes(field) ? <button type="button" onClick={() => approveReference(field)}>Добавить «{draft[field]}» для следующих заказов</button> : null}</label>)}</div> : null}
        <button type="button" className="primary-button" disabled={draft.createProduct && (!clean(draft.productName) || !draft.genderScope)} onClick={() => { setAdvancedOpen(false); setClassified(true); setEditing(null); void preview(draft) }}>Проверить и продолжить</button>
        {draft.createProduct && (!clean(draft.productName) || !draft.genderScope) ? <p>Укажите название нового товара и для кого он предназначен.</p> : null}
      </fieldset>
    </section> : null}
    {isAdmin && item && !advancedOpen && !minimalFieldQuestion ? <footer>{fallbackOpen ? <button type="button" className="resolution-link" disabled={disabled} onClick={() => void openAdvanced()}>Расширенное исправление</button> : <button type="button" className="resolution-link" disabled={disabled} onClick={() => setFallbackOpen(true)}>Не нашли правильный вариант?</button>}</footer> : null}
    {!minimalFieldQuestion ? <small className="resolution-guard">Без уточнения отправить заказ нельзя.</small> : null}
  </div></div>
}
