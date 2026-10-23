import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { displayQuantityInput, previewQuantity, type UnifiedQuantityMode } from '../unifiedOperationMath'
import { StocktakeProductChoice, StocktakeSizeCountCell } from './StocktakeSharedInputs'
import '../../../styles/193-unified-inventory-operations.css'

type Mode = UnifiedQuantityMode
type Row = { id?: number; variantId: number | string; productId: number | string; productName: string; gender?: string; material?: string; length?: string; color?: string; size?: string; audienceType?: string; quantity?: number; reservedQuantity?: number }
type Group = { key: string; productName: string; rows: Row[] }
type Draft = { variantId?: number | string; quantity?: number; touched?: boolean }
type Props = {
  mode: Mode; source: 'warehouse' | 'boutique'; groups: Group[]; draft: Draft[]
  busy: boolean; loading: boolean; error: string; reason: string; isAdmin: boolean
  newVariantWorkspace: ReactNode; extraArrival: { rows: number; totalQuantity: number }
  onMode: (mode: Mode | 'transfer') => void
  onSource: (source: 'warehouse' | 'boutique') => void
  onReason: (value: string) => void
  onQuantity: (row: Row, value: string) => void
  onSave: () => Promise<unknown>; onClear: () => void; onRefresh: () => void
}
const names = {
  arrival: { title: 'Приход', action: 'Оформить приход', input: 'Пришло', detail: 'Введите количество поступивших вещей: оно прибавится к остатку.' },
  writeoff: { title: 'Списание', action: 'Подтвердить списание', input: 'Списать', detail: 'Введите количество списываемых вещей: оно вычтется из остатка.' },
  manual_set: { title: 'Корректировка', action: 'Сохранить корректировку', input: 'Фактически', detail: 'Введите итоговый остаток, как в выборочной ревизии.' },
} as const
const int = (value: unknown) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0
const sourceName = (s: string) => s === 'boutique' ? 'Бутик' : 'Склад'
function positionKey(row: Row) { return [row.material || 'СТАНДАРТ', row.length || 'СТАНДАРТ', row.audienceType || 'adult', row.gender || ''].join('::') }
function positionLabel(row: Row) {
  const parts = [row.material, row.length].filter(v => v && v !== 'СТАНДАРТ')
  const audience = [row.audienceType === 'child' ? 'Детский' : '', row.gender].filter(Boolean)
  return [...parts, ...audience].join(' · ') || 'Стандартное исполнение'
}
function positions(rows: Row[]) {
  const map = new Map<string, { key: string; label: string; rows: Row[] }>()
  for (const row of rows) {
    const key = positionKey(row)
    const current = map.get(key) || { key, label: positionLabel(row), rows: [] }
    current.rows.push(row)
    map.set(key,current)
  }
  return [...map.values()]
}

export function InventoryUnifiedQuantityWorkspace(p: Props) {
  const { mode, source, groups, draft, busy, loading, error, reason, isAdmin, newVariantWorkspace, extraArrival } = p
  const [startSearch, setStartSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [current, setCurrent] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [stage, setStage] = useState<'select' | 'quantities' | 'review'>('select')
  const [newVariant, setNewVariant] = useState(false)
  const [notice, setNotice] = useState('')
  const chosen = useMemo(() => selected.map(key => groups.find(group => group.key === key))
    .filter((g): g is Group => Boolean(g)), [selected, groups])
  const activeGroup = chosen.find(g => g.key === current) || chosen[0] || null
  const draftMap = useMemo(() => new Map(draft.filter(item => item.variantId)
    .map(item => [String(item.variantId), item])), [draft])
  const allRows = useMemo(() => new Map(groups.flatMap(g => g.rows.map(r => [String(r.variantId), r] as const))), [groups])
  const entries = useMemo(() => draft.filter(item => item.variantId &&
    (mode === 'manual_set' ? item.touched : int(item.quantity) > 0))
    .map(item => ({ row: allRows.get(String(item.variantId)), quantity: int(item.quantity) }))
    .filter((item): item is { row: Row; quantity: number } => Boolean(item.row)), [draft, allRows, mode])
  const changed = entries.length + (mode === 'arrival' ? extraArrival.rows : 0)
  const changedUnitCount = entries.reduce((n,e) => n +
    (mode === 'manual_set' ? Math.abs(previewQuantity(mode,int(e.row.quantity),e.quantity) - int(e.row.quantity)) : e.quantity),0)
  const unselected = useMemo(() => groups.filter(g => g.productName.toLocaleLowerCase('ru').includes(startSearch.toLocaleLowerCase('ru').trim())).slice(0,180),[groups,startSearch])
  const searchableChosen = chosen.filter(g => g.productName.toLocaleLowerCase('ru').includes(productSearch.toLocaleLowerCase('ru').trim()))
  const groupIndex = chosen.findIndex(g => g.key === activeGroup?.key)
  const filledGroup = (g: Group) => g.rows.filter(r => displayQuantityInput(mode,draftMap.get(String(r.variantId))) !== '').length
  const ready = changed > 0 && (mode === 'arrival' || Boolean(reason.trim()))
  useEffect(() => {
    if(stage === 'review' && !busy && !changed) {
      setStage('select');setSelected([]);setCurrent('');setNotice('')
    }
  },[stage,busy,changed])

  function toggleProduct(key: string) {
    const remove = selected.includes(key)
    if(remove) {
      const g = groups.find(item => item.key === key)
      const filled = (g?.rows || []).filter(row => displayQuantityInput(mode,draftMap.get(String(row.variantId))) !== '')
      if(filled.length && !window.confirm('Убрать товар и очистить ' + filled.length + ' введённых значений?')) return
      for(const row of filled) p.onQuantity(row,'')
    }
    setSelected(old => remove ? old.filter(k => k !== key) : [...old,key])
    if(!remove) setCurrent(key)
  }
  function setSource(next: 'warehouse' | 'boutique') {
    if(next === source)return
    if(changed && !window.confirm('При смене точки введённые значения будут очищены. Продолжить?'))return
    p.onSource(next);setStage('select');setSelected([]);setCurrent('');setNotice('')
  }
  function reset() {
    if(changed && !window.confirm('Очистить все несохранённые количества?'))return
    p.onClear();setStage('select');setSelected([]);setCurrent('');setProductSearch('');setStartSearch('');setNewVariant(false);setNotice('')
  }
  function review() {
    if(!changed){setNotice('Введите количество хотя бы в одной ячейке.');return}
    if(entries.length > 100){setNotice('В одну операцию допускается не более 100 вариантов.');return}
    if(mode !== 'arrival' && !reason.trim()){setNotice('Укажите причину операции.');return}
    setNotice('');setStage('review')
  }
  return <div className="inventory-stocktake-panel stocktake-human-panel stocktake-session-v188e stocktake-reused-operations"
    data-unified-operation={mode}>
    <div className="stocktake-e-head"><div><h3>{names[mode].title}</h3><p>{names[mode].detail}</p></div></div>
    <div className="stocktake-e-start stocktake-e-start-v5 w6-operation-switch">
      <div className="stocktake-start-modes stocktake-start-modes-v5">
        {([['arrival','Приход','Прибавить к остатку'],['writeoff','Списание','Вычесть из остатка'],
          ['manual_set','Корректировка','Установить фактический остаток'],['transfer','Перемещение','Между точками']] as const)
          .filter(([key]) => key !== 'arrival' || isAdmin).map(([key,label,hint]) =>
            <button type="button" key={key} className={'stocktake-start-mode '+(mode === key?'is-active':'')}
              disabled={busy} onClick={() => {
                if(key === mode)return
                if(changed && !window.confirm('Сменить операцию и очистить несохранённые значения?'))return
                p.onMode(key)
              }}><strong>{label}</strong><span>{hint}</span></button>)}
      </div>
    </div>

    <div className="stocktake-source-switch stocktake-source-switch-v5" role="tablist" aria-label="Место операции">
      {(['warehouse','boutique'] as const).map(key => <button type="button" role="tab" key={key}
        aria-selected={source === key} className={source === key?'is-active':''} disabled={busy}
        onClick={() => setSource(key)}>{sourceName(key)}</button>)}
    </div>
    {loading && <div className="stocktake-inline-notice" role="status">Обновляю варианты и остатки выбранной точки…</div>}
    {error && <div className="stocktake-inline-notice w6-notice-error" role="alert">{error}
      <button className="secondary compact" type="button" onClick={p.onRefresh}>Обновить список</button></div>}
    {!loading && !error && (stage === 'select' ? <>
      <section className="stocktake-e-start stocktake-e-start-v5">
        <div className="stocktake-start-intro">
          <span className="stocktake-step-kicker">Новая операция</span>
          <h4>Какие товары хотите {mode === 'arrival'?'принять':mode === 'writeoff'?'списать':'исправить'}?</h4>
          <p>Выберите один или несколько товаров, как в выборочной ревизии.</p>
        </div>
        <div className="stocktake-selective-picker stocktake-selective-picker-v5 stocktake-selective-picker-w5">
          <div className="stocktake-selective-head">
            <label><span>Найдите товар</span><input value={startSearch} onChange={e => setStartSearch(e.target.value)}
              placeholder="Название товара…" /></label>
            <div className="stocktake-selective-count">
              <strong>{chosen.length ? chosen.length+' товаров выбрано' : 'Выберите товары'}</strong>
              <span>{chosen.length ? chosen.reduce((n,g)=>n+g.rows.length,0)+' вариантов' : 'Можно выбрать несколько'}</span>
            </div>
          </div>
          {!!chosen.length && <div className="stocktake-selective-queue">
            <div className="stocktake-selective-queue-head"><div><strong>Вы будете изменять</strong>
              <span>{chosen.length} товаров</span></div>
              <button className="ghost compact" type="button" onClick={() => {
                if(changed && !window.confirm('Очистить выбранные товары и числа?'))return
                for(const g of chosen) for(const row of g.rows) if(displayQuantityInput(mode,draftMap.get(String(row.variantId)))!=='')p.onQuantity(row,'')
                setSelected([]);setCurrent('')
              }}>Очистить</button>
            </div>
            <div className="stocktake-selective-chips">
              {chosen.map(g => <button type="button" className="stocktake-selective-chip" key={g.key}
                title="Убрать товар" onClick={() => toggleProduct(g.key)}><span>{g.productName}</span><small>{g.rows.length} поз.</small><b aria-hidden="true">×</b></button>)}
            </div>
          </div>}
          <div className="stocktake-selective-list stocktake-selective-list-v5">
            {unselected.length ? unselected.map(g => <StocktakeProductChoice key={g.key}
              name={g.productName} description={g.rows.length+' поз. '+(selected.includes(g.key)?'· выбрано':'')}
              checked={selected.includes(g.key)} onToggle={() => toggleProduct(g.key)} />)
              : <div className="stocktake-product-list-empty">По поиску ничего не найдено.</div>}
          </div>
          {groups.length > unselected.length && <small>Чтобы найти другие товары, уточните название в поиске.</small>}
        </div>
        {mode === 'arrival' && isAdmin && <div className="w6-stocktake-new">
          <button className="secondary compact" type="button" onClick={()=>setNewVariant(!newVariant)}>
            {newVariant?'− Скрыть создание варианта':'+ Нужного товара или варианта нет в каталоге'}
          </button>
          {newVariant && <div className="w6-stocktake-new-content">
            <p>Создание нового варианта выполняется отдельно; для существующих выбирайте размеры в таблице ревизии.</p>
            {newVariantWorkspace}
          </div>}
        </div>}
        <div className="stocktake-start-submit"><div>
          {chosen.length ? chosen.length+' товаров выбрано' : mode === 'arrival' && extraArrival.rows>0 ? 'Можно принять только новые варианты' : 'Выберите хотя бы один товар'}
        </div><button type="button" className="primary stocktake-e-start-button"
          disabled={busy || (!chosen.length && !(mode === 'arrival' && extraArrival.rows>0))}
          onClick={() => {setCurrent(chosen[0]?.key||'');setStage(chosen.length?'quantities':'review')}}>
          {chosen.length?'Начать работу с выбранными товарами':'Проверить новые варианты прихода'}
        </button></div>
      </section>
    </> : stage === 'quantities' ? <>
      <section className="stocktake-e-active-head">
        <div><span className="stocktake-step-kicker">{sourceName(source)}</span>
          <h4>{names[mode].title} · {chosen.length} товаров</h4>
          <p>{names[mode].detail}</p></div>
        <div className="stocktake-e-head-actions">
          <button className="secondary compact" type="button" onClick={() => setStage('select')}>Изменить выбор товаров</button>
          <button className="secondary compact" type="button" onClick={reset} disabled={busy}>Очистить</button>
        </div>
      </section>
      <div className="stocktake-sticky-progress">
        <div className="stocktake-sticky-progress-main">
          <strong>Заполнено {entries.length} из {chosen.reduce((n,g)=>n+g.rows.length,0)} вариантов</strong>
          <span>Пустые поля оставят остаток неизменным. Число 0 в корректировке установит остаток в ноль.</span>
        </div>
        <div className="stocktake-sticky-progress-bar"><i style={{width:
          (chosen.reduce((n,g)=>n+g.rows.length,0) ? Math.round(entries.length/chosen.reduce((n,g)=>n+g.rows.length,0)*100) : 0)+'%'}}/></div>
        <button className="primary compact stocktake-review-button" type="button" disabled={!changed||busy}
          onClick={review}>Проверить результат</button>
      </div>
      <div className="stocktake-counting-rule">{mode === 'arrival'
        ? 'Впишите, сколько поступило. По системе указан текущий остаток. Пустые поля ничего не меняют.'
        : mode === 'writeoff'
          ? 'Впишите, сколько нужно списать. По системе указан текущий остаток. Пустые поля ничего не меняют.'
          : 'Впишите фактический остаток, как в ревизии. Пустое поле ничего не меняет, введённый 0 обнуляет остаток.'}
        {' '}После ввода показываем, сколько будет в точке.</div>
      <div className="stocktake-counting-shell">
        <aside className="stocktake-counting-sidebar">
          <div className="stocktake-product-browser stocktake-product-browser-v5">
            <div className="stocktake-product-browser-title"><strong>Товары</strong>
              <span>{groupIndex+1} / {chosen.length}</span></div>
            <label className="stocktake-product-filter stocktake-product-filter-v5">
              <input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="Найти товар…" />
            </label>
            <div className="stocktake-product-list stocktake-product-list-v5" role="listbox" aria-label="Товары текущей операции">
              {searchableChosen.map(g=> <button type="button" role="option" key={g.key}
                aria-selected={activeGroup?.key===g.key} className={activeGroup?.key===g.key?'is-active':''}
                onClick={()=>setCurrent(g.key)}><span>{g.productName}</span>
                <small>{filledGroup(g)?filledGroup(g)+' введено':g.rows.length+' поз.'}</small></button>)}
            </div>
          </div>
        </aside>
        <div className="stocktake-counting-main">
          <label className="stocktake-mobile-product-select"><span>Текущий товар</span>
            <select value={activeGroup?.key||''} onChange={e=>setCurrent(e.target.value)}>
              {chosen.map(g=><option key={g.key} value={g.key}>{g.productName} · {filledGroup(g)} введено</option>)}
            </select></label>
          {activeGroup ? <section className="stocktake-e-work-card stocktake-e-work-card-calm">
            <div className="stocktake-e-product-nav stocktake-e-product-nav-calm stocktake-e-product-nav-v5">
              <div><span>Товар {groupIndex+1} из {chosen.length}</span><h4>{activeGroup.productName}</h4>
                <small className="stocktake-current-product-status">{filledGroup(activeGroup)} из {activeGroup.rows.length} позиций заполнено</small></div>
              <div className="stocktake-product-step-actions">
                <button className="ghost compact" type="button" disabled={groupIndex<=0}
                  onClick={()=>setCurrent(chosen[groupIndex-1].key)}>← <span>Пред.</span></button>
                <button className="ghost compact" type="button" disabled={groupIndex>=chosen.length-1}
                  onClick={()=>setCurrent(chosen[groupIndex+1].key)}><span>След.</span> →</button>
              </div>
            </div>
            <div className="stocktake-e-positions stocktake-e-positions-compact">
              {positions(activeGroup.rows).map(position=>{
                const colors=new Map<string,Row[]>()
                for(const row of position.rows) {
                  const color=row.color || 'БЕЗ ЦВЕТА'
                  colors.set(color,[...(colors.get(color)||[]),row])
                }
                const showTitle=positions(activeGroup.rows).length>1 || !['Стандартное исполнение','ЖЕН','МУЖ','Взрослый · ЖЕН','Взрослый · МУЖ'].includes(position.label)
                return <section className={'stocktake-e-position stocktake-e-position-compact '+(!showTitle?'is-default-position':'')}
                  key={position.key}>
                  {showTitle && <div className="stocktake-e-position-title"><strong>{position.label}</strong></div>}
                  <div className="stocktake-color-groups">
                    {[...colors.entries()].map(([color,rows])=><div className="stocktake-color-group" key={position.key+color}>
                      <div className="stocktake-color-group-head"><strong>{color}</strong></div>
                      <div className="stocktake-color-group-body"><div className="stocktake-size-grid">
                        {rows.slice().sort((a,b)=>(a.size||'').localeCompare(b.size||'','ru',{numeric:true})).map(row=>{
                          const value=displayQuantityInput(mode,draftMap.get(String(row.variantId)))
                          const currentQuantity=int(row.quantity)
                          const after=value===''?currentQuantity:previewQuantity(mode,currentQuantity,int(value))
                          const shortage=Math.max(0,int(row.reservedQuantity)-after)
                          return <StocktakeSizeCountCell key={String(row.variantId)} cellId={row.variantId}
                            size={row.size||'—'} currentQuantity={currentQuantity} value={value}
                            disabled={busy}
                            ariaLabel={activeGroup.productName+' '+color+' '+(row.size||'')+': '+names[mode].input}
                            onChange={raw=>{if(raw!==''&&!/^\d{1,6}$/.test(raw))return;p.onQuantity(row,raw)}}
                            onClear={()=>p.onQuantity(row,'')}>
                            {value!==''&&<span className="w6-stocktake-after">Будет: <b>{after}</b></span>}
                            {value!==''&&shortage>0&&<span className="w6-stocktake-shortage">Резерв {int(row.reservedQuantity)} · не хватит {shortage}</span>}
                          </StocktakeSizeCountCell>
                        })}
                      </div></div>
                    </div>)}
                  </div>
                </section>
              })}
            </div>
            {mode==='arrival'&&isAdmin&&<div className="stocktake-current-product-actions stocktake-current-product-actions-v5">
              <button className="secondary compact" type="button" onClick={()=>setNewVariant(!newVariant)}>
                {newVariant?'− Скрыть добавление':' + Добавить новый вариант'}</button>
              <span>Если варианта нет в каталоге, его можно создать через форму прихода.</span>
            </div>}
          </section>:<div className="empty-state">Не удалось найти выбранный товар. Вернитесь к выбору.</div>}
        </div>
      </div>
      {mode==='arrival'&&isAdmin&&newVariant&&<div className="w6-stocktake-new-content">
        {newVariantWorkspace}
      </div>}
      <label className="w6-stocktake-reason">{mode==='arrival'?'Комментарий к приходу (необязательно)': 'Причина '+(mode==='writeoff'?'списания':'корректировки')+' (обязательно)'}
        <input value={reason} onChange={e=>p.onReason(e.target.value)}
          placeholder={mode==='arrival'?'Новая партия':'Например: физическая сверка / повреждение'} />
      </label>
      {notice&&<div className="stocktake-inline-notice w6-notice-error" role="alert">{notice}</div>}
      <div className="stocktake-e-footer stocktake-e-footer-v4">
        <span>{changed ? changed+' вариантов введено' : 'Пока нет изменений'}</span>
        <button className="primary compact stocktake-review-button" type="button" disabled={!changed||busy}
          onClick={review}>Проверить результат</button>
      </div>
    </> : <>
      <section className="stocktake-e-review-head">
        <div><span className="stocktake-step-kicker">Проверка результата</span><h4>{names[mode].title} · {sourceName(source)}</h4>
          <p>Проверьте числа до сохранения. Остатки пока не изменялись.</p></div>
        <button className="secondary compact stocktake-review-back" type="button" disabled={busy}
          onClick={()=>setStage(chosen.length?'quantities':'select')}>← Исправить</button>
      </section>
      <div className="stocktake-e-review-list">
        {entries.map(({row,quantity})=>{
          const before=int(row.quantity),after=previewQuantity(mode,before,quantity)
          const reserved=int(row.reservedQuantity)
          return <div className="stocktake-e-review-row" key={String(row.variantId)}>
            <div className="stocktake-e-review-name"><strong>{row.productName}</strong>
              <span>{[positionLabel(row),row.color,row.size].filter(Boolean).join(' · ')}</span></div>
            <div className="stocktake-e-review-quantity"><span>По системе</span><strong>{before}</strong></div>
            <div className="stocktake-e-review-quantity"><span>{names[mode].input}</span><strong>{quantity}</strong></div>
            <div className="stocktake-e-review-quantity"><span>Будет</span><strong>{after}</strong>
              {after<reserved&&<small className="w6-stocktake-shortage">Резерв: {reserved}, нехватка {reserved-after}</small>}
              {mode==='writeoff'&&quantity>Math.max(0,before)&&<small className="w6-stocktake-shortage">Нужно подтвердить фактическую выдачу сверх учёта</small>}
            </div>
          </div>
        })}
        {mode==='arrival'&&extraArrival.rows>0&&<div className="stocktake-e-review-row">
          <div className="stocktake-e-review-name"><strong>Новые варианты</strong><span>Создание через форму прихода</span></div>
          <div className="stocktake-e-review-quantity"><strong>{extraArrival.rows} вариантов</strong></div>
          <div className="stocktake-e-review-quantity"><strong>+{extraArrival.totalQuantity} шт.</strong></div>
        </div>}
      </div>
      <label className="w6-stocktake-reason">{mode==='arrival'?'Комментарий к приходу (необязательно)':'Причина '+(mode==='writeoff'?'списания':'корректировки')+' (обязательно)'}
        <input value={reason} onChange={e=>p.onReason(e.target.value)} placeholder="Что произошло с товаром?" />
      </label>
      {notice&&<div className="stocktake-inline-notice w6-notice-error" role="alert">{notice}</div>}
      <div className="stocktake-e-review-actions"><button className="primary stocktake-finish-button" type="button"
        disabled={busy||!ready} onClick={()=>void p.onSave()}>{busy?'Сохраняю…':names[mode].action}</button>
        <button className="secondary" type="button" disabled={busy} onClick={()=>setStage(chosen.length?'quantities':'select')}>Вернуться к вводу</button></div>
    </>)}
  </div>
}
