import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { displayQuantityInput, previewQuantity, type UnifiedQuantityMode } from '../unifiedOperationMath'
import { StocktakeProductChoice, StocktakeSizeCountCell } from './StocktakeSharedInputs'
import '../../../styles/193-unified-inventory-operations.css'

type Mode = UnifiedQuantityMode | 'transfer'
type Row = { id?: number; draftKey?:string; variantId: number | string; productId: number | string; productName: string; gender?: string; material?: string; length?: string; color?: string; size?: string; audienceType?: string; quantity?: number; reservedQuantity?: number }
type Group = { key: string; productName: string; rows: Row[] }
type Draft = { variantId?: number | string; draftKey?:string; createMissingVariant?:boolean;
  productId?:number|string;productName?:string;category?:'adult'|'child';gender?:string;
  material?:string;length?:string;color?:string;size?:string;
  quantity?: number; touched?: boolean }
type Props = {
  mode: Mode; source: 'warehouse' | 'boutique'; targetSource: 'warehouse' | 'boutique'
  targetQuantity: (variantId: string | number) => number; onSwap: () => void
  groups: Group[]; draft: Draft[]
  busy: boolean; loading: boolean; error: string; saveError: string; reason: string; isAdmin: boolean
  blockedTransferSource: 'warehouse'|'boutique'|null; onOpenStocktake:(source:'warehouse'|'boutique')=>void
  newVariantWorkspace: ReactNode; extraArrival: { rows: number; totalQuantity: number }
  colorSuggestions: string[]; sizeSuggestions: string[]; childAgeSuggestions: string[]
  onInlineArrivalVariant: (seed: {productId:number|string;productName:string;category:'adult'|'child';gender:string;material:string;length:string;color:string;size:string;quantity:number})=>void
  onInlineCorrectionVariant: (seed: {productId:number|string;productName:string;category:'adult'|'child';gender:string;material:string;length:string;color:string;size:string;quantity:number})=>void
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
  transfer: { title: 'Перемещение', action: 'Подтвердить перемещение', input: 'Переместить', detail: 'Укажите количество для переноса между складом и бутиком. Резервы заказов не переписываются.' },
} as const
const int = (value: unknown) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0
const movementInput = (mode:Mode, item:Draft|undefined) => displayQuantityInput(mode==='transfer'?'writeoff':mode,item)
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
  const { mode, source, targetSource, groups: baseGroups, draft, busy, loading, error, saveError, blockedTransferSource, reason, isAdmin, newVariantWorkspace, extraArrival } = p
  const groups=useMemo(()=>baseGroups.map(group=>({
    ...group,
    rows:[...group.rows,...(mode==='manual_set' ? draft.filter(item=>
      item.createMissingVariant && item.draftKey
      && String(item.productId)===String(group.rows[0]?.productId)).map(item=>({
        variantId:item.draftKey!,draftKey:item.draftKey,productId:item.productId!,
        productName:item.productName||group.productName,
        audienceType:item.category||'adult',gender:item.gender||'',
        material:item.material||'СТАНДАРТ',length:item.length||'СТАНДАРТ',
        color:item.color||'',size:item.size||'',quantity:0,reservedQuantity:0,
      })) : [])],
  })),[baseGroups,draft,mode])
  const [startSearch, setStartSearch] = useState('')
  // Keep selections and the stage for each location, matching the non-destructive
  // source switching behavior of the stocktake screen.
  type Stage = 'select' | 'quantities' | 'review'
  const [selectedBySource,setSelectedBySource] = useState<Record<string,string[]>>({})
  const [currentBySource,setCurrentBySource] = useState<Record<string,string>>({})
  const [stageBySource,setStageBySource] = useState<Record<string,Stage>>({})
  const selected = selectedBySource[source] || []
  const current = currentBySource[source] || ''
  const stage = stageBySource[source] || 'select'
  const setSelected = (next: string[] | ((prev: string[])=>string[])) =>
    setSelectedBySource(old=>({...old,[source]:typeof next==='function'?next(old[source]||[]):next}))
  const setCurrent = (next:string) => setCurrentBySource(old=>({...old,[source]:next}))
  const setStage = (next:Stage) => setStageBySource(old=>({...old,[source]:next}))
  const [productSearch, setProductSearch] = useState('')
  const [newVariant, setNewVariant] = useState(false)
  const [inline, setInline] = useState<{ positionKey:string; color:string; kind:'size'|'color'; size:string; quantity:string } | null>(null)
  const [notice, setNotice] = useState('')
  const chosen = useMemo(() => selected.map(key => groups.find(group => group.key === key))
    .filter((g): g is Group => Boolean(g)), [selected, groups])
  const activeGroup = chosen.find(g => g.key === current) || chosen[0] || null
  const draftMap = useMemo(() => new Map(draft.filter(item => item.variantId || item.draftKey)
    .map(item => [String(item.draftKey || item.variantId), item])), [draft])
  const allRows = useMemo(() => new Map(groups.flatMap(g => g.rows.map(r => [String(r.variantId), r] as const))), [groups])
  const entries = useMemo(() => draft.filter(item => (item.variantId || item.draftKey) &&
    (mode === 'manual_set' ? item.touched : int(item.quantity) > 0))
    .map(item => ({ row: allRows.get(String(item.draftKey || item.variantId)), quantity: int(item.quantity) }))
    .filter((item): item is { row: Row; quantity: number } => Boolean(item.row)), [draft, allRows, mode])
  const changed = entries.length + (mode === 'arrival' ? extraArrival.rows : 0)
  const unselected = useMemo(() => groups.filter(g => g.productName.toLocaleLowerCase('ru').includes(startSearch.toLocaleLowerCase('ru').trim())).slice(0,180),[groups,startSearch])
  const searchableChosen = chosen.filter(g => g.productName.toLocaleLowerCase('ru').includes(productSearch.toLocaleLowerCase('ru').trim()))
  const groupIndex = chosen.findIndex(g => g.key === activeGroup?.key)
  const filledGroup = (g: Group) => g.rows.filter(r => movementInput(mode,draftMap.get(String(r.variantId))) !== '').length
  const ready = changed > 0 && (mode === 'arrival' || mode === 'transfer' || Boolean(reason.trim()))
  useEffect(() => {
    if(stage === 'review' && !busy && !changed) {
      setStage('select');setSelected([]);setCurrent('');setNotice('')
    }
  },[stage,busy,changed])

  function toggleProduct(key: string) {
    const remove = selected.includes(key)
    if(remove) {
      const g = groups.find(item => item.key === key)
      const filled = (g?.rows || []).filter(row => movementInput(mode,draftMap.get(String(row.variantId))) !== '')
      if(filled.length && !window.confirm('Убрать товар и очистить ' + filled.length + ' введённых значений?')) return
      for(const row of filled) p.onQuantity(row,'')
    }
    setSelected(old => remove ? old.filter(k => k !== key) : [...old,key])
    if(!remove) setCurrent(key)
  }
  function setSource(next: 'warehouse' | 'boutique') {
    if(next === source)return
    if(mode === 'arrival' && extraArrival.rows>0 &&
      !window.confirm('Есть несохранённые новые варианты прихода. При смене точки они будут очищены. Продолжить?')) return
    p.onSource(next)
    setNotice('')
  }
  function reset() {
    if(changed && !window.confirm('Очистить все несохранённые количества?'))return
    p.onClear();setStage('select');setSelected([]);setCurrent('');setProductSearch('');setStartSearch('');setNewVariant(false);setNotice('')
  }
  function addInlineVariant(sample:Row) {
    if(!inline)return
    if(mode!=='arrival'&&mode!=='manual_set')return
    const color=inline.color.trim(),size=inline.size.trim(),quantity=Number(inline.quantity)
    if(!color||!size||!Number.isInteger(quantity)||quantity<(mode==='manual_set'?0:1)||quantity>999999){
      setNotice('Выберите цвет, размер и целое количество от '+(mode==='manual_set'?'0':'1')+' до 999999.');return
    }
    if(activeGroup?.rows.some(row=>positionKey(row)===inline.positionKey &&
      (row.color||'').trim().toLocaleLowerCase('ru')===color.toLocaleLowerCase('ru') &&
      (row.size||'').trim().toLocaleLowerCase('ru')===size.toLocaleLowerCase('ru'))){
      setNotice('Такой вариант уже есть выше. Введите количество в его ячейку.');return
    }
    const seed={
      productId:sample.productId, productName:sample.productName,
      category:(sample.audienceType==='child'?'child':'adult') as 'child'|'adult', gender:sample.gender||'',
      material:sample.material||'СТАНДАРТ', length:sample.length||'СТАНДАРТ',
      color,size,quantity,
    }
    if(mode==='manual_set')p.onInlineCorrectionVariant(seed)
    else p.onInlineArrivalVariant(seed)
    setInline(null);setNotice('')
  }
  function review() {
    if(!changed){setNotice('Введите количество хотя бы в одной ячейке.');return}
    const limit=mode==='transfer'?60:100
    if(changed>limit){setNotice('В одну '+(mode==='transfer'?'перемещение':'операцию')+' допускается не более '+limit+' вариантов. Разделите список.');return}
    if(mode !== 'arrival' && mode !== 'transfer' && !reason.trim()){setNotice('Укажите причину операции.');return}
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
                if(changed && !window.confirm('Сменить операцию? Неотправленные данные этого режима будут очищены.'))return
                p.onMode(key)
              }}><strong>{label}</strong><span>{hint}</span></button>)}
      </div>
    </div>

    <div className="w7-operation-location">
      <div><strong>{mode==='transfer'?'Откуда → куда':'Точка операции'}</strong>
        <small>{mode==='transfer'?'Числа будут вычтены из первой точки и добавлены во вторую.':'Можно вернуться к другой точке без потери уже введённых чисел.'}</small></div>
      <div className="stocktake-source-switch stocktake-source-switch-v5" role="tablist" aria-label={mode==='transfer'?'Откуда перемещаем':'Место операции'}>
        {(['warehouse','boutique'] as const).map(key => <button type="button" role="tab" key={key}
          aria-selected={source === key} className={source === key?'is-active':''} disabled={busy}
          onClick={() => mode==='transfer' ? (key!==source&&(!changed||window.confirm('Сменить направление? Введённые количества перемещения будут очищены.'))&&p.onSwap()) : setSource(key)}>{sourceName(key)}</button>)}
      </div>
      {mode==='transfer' && <div className="w7-transfer-target">
        <span aria-hidden="true">→</span>
        <strong>{sourceName(targetSource)}</strong>
        <button type="button" className="secondary compact" disabled={busy} onClick={()=>{if(changed&&!window.confirm('Сменить направление? Введённые количества перемещения будут очищены.'))return;p.onSwap()}}>⇄ Поменять направление</button>
      </div>}
    </div>
    {mode==='transfer'&&blockedTransferSource&&<div className="w8-transfer-stocktake-lock" role="alert">
      <div><strong>Перемещение временно недоступно</strong>
        <p>В точке «{sourceName(blockedTransferSource)}» идёт ревизия. Чтобы результаты пересчёта оставались точными, сначала завершите или отмените её.</p>
        <small>Ваш выбранный товар и введённые числа останутся в форме, пока вы не измените направление или операцию.</small></div>
      <button className="secondary compact" type="button" onClick={()=>p.onOpenStocktake(blockedTransferSource)}>Открыть проверку</button>
    </div>}
    {loading && <div className="stocktake-inline-notice" role="status">Обновляю варианты и остатки выбранной точки…</div>}
    {error && <div className="stocktake-inline-notice w6-notice-error" role="alert">{error}
      <button className="secondary compact" type="button" onClick={p.onRefresh}>Обновить список</button></div>}
    {!loading && !error && (stage === 'select' ? <>
      <section className="stocktake-e-start stocktake-e-start-v5">
        <div className="stocktake-start-intro">
          <span className="stocktake-step-kicker">Новая операция</span>
          <h4>Какие товары хотите {mode === 'arrival'?'принять':mode === 'writeoff'?'списать':mode==='transfer'?'переместить':'исправить'}?</h4>
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
                for(const g of chosen) for(const row of g.rows) if(movementInput(mode,draftMap.get(String(row.variantId)))!=='')p.onQuantity(row,'')
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
      {mode==='manual_set'&&<div className="w8-correction-hint">
        Как в выборочной ревизии: «+ размер» и «+ цвет» добавляют отсутствующие варианты. Их количество — итоговый фактический остаток. Пустая ячейка ничего не меняет.
      </div>}
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
                          const value=movementInput(mode,draftMap.get(String(row.variantId)))
                          const currentQuantity=int(row.quantity)
                          const after=value===''?currentQuantity:(mode==='transfer'?Math.max(0,currentQuantity-int(value)):previewQuantity(mode,currentQuantity,int(value)))
                          const targetBefore=mode==='transfer'?p.targetQuantity(row.variantId):0
                          const shortage=Math.max(0,int(row.reservedQuantity)-after)
                          return <StocktakeSizeCountCell key={String(row.variantId)} cellId={row.variantId}
                            size={row.size||'—'} currentQuantity={currentQuantity} value={value}
                            disabled={busy}
                            ariaLabel={activeGroup.productName+' '+color+' '+(row.size||'')+': '+names[mode].input}
                            onChange={raw=>{if(raw!==''&&!/^\d{1,6}$/.test(raw))return;p.onQuantity(row,raw)}}
                            onClear={()=>p.onQuantity(row,'')}>
                            {value!==''&&<span className="w6-stocktake-after">{mode==='transfer'? 'Здесь: ' : 'Будет: '}<b>{after}</b></span>}
                            {value!==''&&mode==='transfer'&&<span className="w7-transfer-after">Там: <b>{targetBefore} → {targetBefore+int(value)}</b></span>}
                            {value!==''&&shortage>0&&<span className="w6-stocktake-shortage">Резерв {int(row.reservedQuantity)} · не хватит {shortage}</span>}
                          </StocktakeSizeCountCell>
                        })}
                      {(mode === 'arrival' || mode==='manual_set') &&
                        <button type="button" className="stocktake-inline-add-trigger"
                          onClick={()=>{setNotice('');setInline(inline?.kind==='size'&&inline.positionKey===position.key&&inline.color===color?null:
                            {positionKey:position.key,color,kind:'size',size:'',quantity:'1'})}}>+ {rows[0]?.audienceType==='child'?'возраст':'размер'}</button>}
                      </div>
                      {inline?.kind==='size'&&inline.positionKey===position.key&&inline.color===color&&
                        <div className="stocktake-inline-add-panel w7-inline-arrival">
                          <div className="stocktake-inline-add-head"><strong>{mode==='arrival'?'Добавить размер при приходе':'Добавить новый размер'}</strong>
                            <button type="button" className="ghost compact" onClick={()=>setInline(null)}>×</button></div>
                          <>
                            <label>Размер
                              <select value={inline.size} onChange={e=>setInline(v=>v&&({...v,size:e.target.value}))}>
                                <option value="">Выберите размер</option>
                                {(rows[0]?.audienceType==='child'?p.childAgeSuggestions:p.sizeSuggestions)
                                  .filter(v=>!rows.some(r=>r.size===v)).map(v=><option key={v} value={v}>{v}</option>)}
                              </select></label>
                            <label>{mode==='manual_set'?'Фактический остаток':'Количество'} <input type="number" min={mode==='manual_set'?'0':'1'} max="999999" value={inline.quantity}
                              onChange={e=>setInline(v=>v&&({...v,quantity:e.target.value}))}/></label>
                            <button type="button" className="primary compact" onClick={()=>addInlineVariant(rows[0])}>{mode==='manual_set'?'Добавить в корректировку':'Добавить к приходу'}</button>
                          </>
                        </div>}
                      </div>
                    </div>)}
                  </div>
                  {(mode==='arrival'||mode==='manual_set')&&
                    <div className="stocktake-inline-position-footer">
                      <button type="button" className="ghost compact stocktake-inline-color-trigger"
                        onClick={()=>{setNotice('');setInline(inline?.kind==='color'&&inline.positionKey===position.key?null:
                          {positionKey:position.key,color:'',kind:'color',size:'',quantity:'1'})}}>+ цвет</button>
                      {inline?.kind==='color'&&inline.positionKey===position.key&&<div className="stocktake-inline-add-panel w7-inline-arrival">
                        <div className="stocktake-inline-add-head"><strong>Добавить новый цвет</strong>
                          <button type="button" className="ghost compact" onClick={()=>setInline(null)}>×</button></div>
                        <>
                          <label>Цвет <select value={inline.color} onChange={e=>setInline(v=>v&&({...v,color:e.target.value}))}>
                            <option value="">Выберите цвет</option>{p.colorSuggestions
                              .filter(v=>!colors.has(v)).map(v=><option key={v} value={v}>{v}</option>)}
                          </select></label>
                          <label>Размер <select value={inline.size} onChange={e=>setInline(v=>v&&({...v,size:e.target.value}))}>
                            <option value="">Выберите размер</option>{(position.rows[0]?.audienceType==='child'?p.childAgeSuggestions:p.sizeSuggestions)
                              .map(v=><option key={v} value={v}>{v}</option>)}
                          </select></label>
                          <label>{mode==='manual_set'?'Фактический остаток':'Количество'} <input type="number" min={mode==='manual_set'?'0':'1'} max="999999" value={inline.quantity}
                            onChange={e=>setInline(v=>v&&({...v,quantity:e.target.value}))}/></label>
                          <button type="button" className="primary compact" onClick={()=>addInlineVariant(position.rows[0])}>{mode==='manual_set'?'Добавить в корректировку':'Добавить к приходу'}</button>
                        </>
                      </div>}
                    </div>}
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
          const before=int(row.quantity),after=mode==='transfer'?Math.max(0,before-quantity):previewQuantity(mode,before,quantity)
          const reserved=int(row.reservedQuantity)
          return <div className="stocktake-e-review-row" key={String(row.variantId)}>
            <div className="stocktake-e-review-name"><strong>{row.productName}</strong>
              <span>{[positionLabel(row),row.color,row.size].filter(Boolean).join(' · ')}</span></div>
            <div className="stocktake-e-review-quantity"><span>По системе</span><strong>{before}</strong></div>
            <div className="stocktake-e-review-quantity"><span>{names[mode].input}</span><strong>{quantity}</strong></div>
            <div className="stocktake-e-review-quantity"><span>Будет</span><strong>{after}</strong>
              {after<reserved&&<small className="w6-stocktake-shortage">Резерв: {reserved}, нехватка {reserved-after}</small>}
              {mode==='transfer'&&<small className="w7-transfer-after">{sourceName(targetSource)}: {p.targetQuantity(row.variantId)} → {p.targetQuantity(row.variantId)+quantity}</small>}
              {(mode==='writeoff'||mode==='transfer')&&quantity>Math.max(0,before)&&<small className="w6-stocktake-shortage">Нужно подтвердить фактическую выдачу сверх учёта</small>}
            </div>
          </div>
        })}
        {mode==='arrival'&&extraArrival.rows>0&&<div className="stocktake-e-review-row">
          <div className="stocktake-e-review-name"><strong>Новые варианты</strong><span>Создание через форму прихода</span></div>
          <div className="stocktake-e-review-quantity"><strong>{extraArrival.rows} вариантов</strong></div>
          <div className="stocktake-e-review-quantity"><strong>+{extraArrival.totalQuantity} шт.</strong></div>
        </div>}
      </div>
      <label className="w6-stocktake-reason">{mode==='arrival'?'Комментарий к приходу (необязательно)':mode==='transfer'?'Комментарий к перемещению (необязательно)':'Причина '+(mode==='writeoff'?'списания':'корректировки')+' (обязательно)'}
        <input value={reason} onChange={e=>p.onReason(e.target.value)} placeholder="Что произошло с товаром?" />
      </label>
      {notice&&<div className="stocktake-inline-notice w6-notice-error" role="alert">{notice}</div>}
      {saveError&&<div className="stocktake-inline-notice w6-notice-error w8-operation-save-error" role="alert">
        <strong>Не удалось подтвердить операцию</strong>
        <p>{saveError}</p>
        <button type="button" className="secondary compact" disabled={busy} onClick={p.onRefresh}>
          Обновить актуальные остатки
        </button>
      </div>}
      <div className="stocktake-e-review-actions"><button className="primary stocktake-finish-button" type="button"
        disabled={busy||!ready||(mode==='transfer'&&Boolean(blockedTransferSource))} onClick={()=>void p.onSave()}>{busy?'Сохраняю…':names[mode].action}</button>
        <button className="secondary" type="button" disabled={busy} onClick={()=>setStage(chosen.length?'quantities':'select')}>Вернуться к вводу</button></div>
    </>)}
  </div>
}
