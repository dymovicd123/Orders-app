import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import '../../../styles/193-unified-inventory-operations.css'

type Mode = 'arrival' | 'writeoff' | 'manual_set'
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
  arrival: { title: 'Приход', action: 'Оформить приход', input: 'Поступило', detail: 'Добавляем введённое количество к текущему остатку.' },
  writeoff: { title: 'Списание', action: 'Списать товары', input: 'Списать', detail: 'Вычитаем введённое количество из текущего остатка.' },
  manual_set: { title: 'Корректировка', action: 'Исправить остатки', input: 'Фактически', detail: 'Устанавливаем введённое фактическое количество, как в ревизии.' },
} as const
const int = (value: unknown) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0
const sourceName = (s: string) => s === 'boutique' ? 'Бутик' : 'Склад'
export function inventoryOperationAfter(mode: Mode, before: number, entered: number) {
  return mode === 'arrival' ? before + entered : mode === 'writeoff' ? Math.max(0, before - entered) : entered
}
export function inventoryOperationDisplay(mode: Mode, item: Draft | undefined) {
  if (!item || (mode === 'manual_set' && !item.touched) || (mode !== 'manual_set' && !int(item.quantity))) return ''
  return String(item.quantity ?? '')
}
function grouped(rows: Row[]) {
  const map = new Map<string, { title: string; colors: Map<string, Row[]> }>()
  for (const row of rows) {
    const key = [row.audienceType, row.gender, row.material, row.length].join('|')
    if (!map.has(key)) map.set(key, {
      title: [row.audienceType === 'child' ? 'Детский' : 'Взрослый', row.gender, row.material, row.length]
        .filter(v => v && v !== 'СТАНДАРТ').join(' · ') || 'Стандартный вариант',
      colors: new Map(),
    })
    const group = map.get(key)!
    const color = row.color || 'Без цвета'
    group.colors.set(color, [...(group.colors.get(color) || []), row])
  }
  return [...map].map(([key, value]) => ({
    key, title: value.title,
    colors: [...value.colors].map(([color, variants]) => ({
      color, variants: variants.sort((a, b) => (a.size || '').localeCompare(b.size || '', 'ru', { numeric: true })),
    })),
  }))
}
export function InventoryUnifiedQuantityWorkspace(p: Props) {
  const {mode,source,groups,draft,busy,loading,error,reason,isAdmin,newVariantWorkspace,extraArrival}=p
  const [query,setQuery]=useState('')
  const [selected,setSelected]=useState<string[]>([])
  const [current,setCurrent]=useState('')
  const [stage,setStage]=useState<'select'|'quantities'|'review'>('select')
  const [newVariant,setNewVariant]=useState(false)
  const [notice,setNotice]=useState('')
  const selectedGroups=useMemo(()=>selected.map(key=>groups.find(group=>group.key===key)).filter((g):g is Group=>Boolean(g)),[selected,groups])
  const group=selectedGroups.find(g=>g.key===current)||selectedGroups[0]
  const draftMap=useMemo(()=>new Map(draft.filter(item=>item.variantId).map(item=>[String(item.variantId),item])),[draft])
  const allRows=useMemo(()=>new Map(groups.flatMap(g=>g.rows.map(r=>[String(r.variantId),r] as const))),[groups])
  const entries=useMemo(()=>draft.filter(item=>item.variantId && (mode==='manual_set'?item.touched:int(item.quantity)>0))
    .map(item=>({row:allRows.get(String(item.variantId)),quantity:int(item.quantity)}))
    .filter((item):item is {row:Row;quantity:number}=>Boolean(item.row)),[draft,allRows,mode])
  const changed=entries.length + (mode==='arrival'?extraArrival.rows:0)
  const count=entries.reduce((n,e)=>n+(mode==='manual_set'?Math.abs(inventoryOperationAfter(mode,int(e.row.quantity),e.quantity)-int(e.row.quantity)):e.quantity),0)
  const filtered=groups.filter(g=>g.productName.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim())).slice(0,120)
  useEffect(()=>{if(stage==='review'&&!busy&&!changed){setStage('select');setSelected([]);setCurrent('');setNotice('')}},[stage,busy,changed])
  function changeSource(next: 'warehouse' | 'boutique') {
    if(next===source)return
    if(changed&&!window.confirm('Сменить точку? Несохранённые значения будут очищены.'))return
    p.onSource(next);setStage('select');setSelected([]);setCurrent('');setQuery('');setNotice('')
  }
  function select(key: string) {
    if (selected.includes(key)) {
      const removing = groups.find(g => g.key === key)
      const edited = removing?.rows.filter(row => inventoryOperationDisplay(mode,draftMap.get(String(row.variantId))) !== '') || []
      if (edited.length && !window.confirm('Убрать товар и очистить ' + edited.length + ' введённых значений?')) return
      for (const row of edited) p.onQuantity(row, '')
    }
    setSelected(prev=>prev.includes(key)?prev.filter(id=>id!==key):[...prev,key])
    setCurrent(key)
  }
  function review() {
    if(!changed){setNotice('Введите количество хотя бы в одной ячейке.');return}
    if(entries.length>100){setNotice('Не более 100 вариантов за одну операцию.');return}
    if(mode!=='arrival'&&!reason.trim()){setNotice('Укажите причину '+(mode==='writeoff'?'списания.':'корректировки.'));return}
    setNotice('');setStage('review')
  }
  function reset() {
    if(changed&&!window.confirm('Очистить введённые значения?'))return
    p.onClear();setSelected([]);setCurrent('');setStage('select');setQuery('');setNewVariant(false);setNotice('')
  }
  return <section className="w6-quantity" data-unified-operation={mode}>
    <header className="w6-heading"><div><span>СКЛАДСКИЕ ОПЕРАЦИИ</span><h3>{names[mode].title} товаров</h3><p>{names[mode].detail}</p></div></header>
    <div className="w6-modes" role="group" aria-label="Вид операции">
      {([['arrival','Приход','Прибавить'],['writeoff','Списание','Вычесть'],['manual_set','Корректировка','Установить'],['transfer','Перемещение','Между точками']] as const)
        .filter(([key])=>key!=='arrival'||isAdmin).map(([key,title,sub])=><button type="button" key={key}
          className={mode===key?'is-active':''} disabled={busy}
          onClick={()=>{if(key===mode)return;if(changed&&!window.confirm('Сменить операцию и очистить несохранённые значения?'))return;p.onMode(key)}}>
          <strong>{title}</strong><small>{sub}</small></button>)}
    </div>
    <div className="w6-source"><div><strong>{mode==='arrival'?'Куда поступает товар':'Где находится товар'}</strong><small>Остатки и варианты зависят от точки</small></div>
      <div>{(['warehouse','boutique'] as const).map(value=><button type="button" key={value}
        className={source===value?'is-active':''} disabled={busy} onClick={()=>changeSource(value)}>{sourceName(value)}</button>)}</div>
    </div>
    {loading&&<div className="w6-message" role="status">Загружаю остатки и варианты выбранной точки…</div>}
    {error&&<div className="w6-message is-error" role="alert">{error} <button type="button" onClick={p.onRefresh}>Повторить</button></div>}
    {!loading&&!error&&<>
      {stage==='select'&&<div className="w6-step"><header><span>ШАГ 1</span><h4>Выберите товары</h4><p>Как в выборочной ревизии: можно отметить несколько товаров за одну операцию.</p></header>
        <label className="w6-search">Поиск товара <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Введите название…"/></label>
        {!!selectedGroups.length&&<div className="w6-picked"><strong>Выбрано: {selectedGroups.length}</strong><div>{selectedGroups.map(g=><button key={g.key} type="button" onClick={()=>select(g.key)}>{g.productName} ×</button>)}</div></div>}
        <div className="w6-pick-list">{filtered.map(g=><label key={g.key}><input type="checkbox" checked={selected.includes(g.key)} onChange={()=>select(g.key)}/>
          <span><strong>{g.productName}</strong><small>{g.rows.length} вариантов</small></span></label>)}
          {!filtered.length&&<p>По поиску товаров нет.</p>}</div>
        {groups.length>filtered.length&&<p className="w6-hint">Показаны первые 120 подходящих товаров. Другие найдутся поиском.</p>}
        {mode==='arrival'&&isAdmin&&<div className="w6-new-variant"><button type="button" onClick={()=>setNewVariant(!newVariant)}>
          {newVariant?'− Скрыть новый вариант':'+ Товара или варианта ещё нет? Добавить при приходе'}</button>
          {newVariant&&<div className="w6-new-form"><p>Новая комбинация появится в каталоге после подтверждения прихода. Существующие товары удобнее выбирать из списка.</p>{newVariantWorkspace}</div>}
        </div>}
        {mode==='arrival'&&extraArrival.rows>0&&!selected.length&&<div className="w6-message">
          Заполнено новых вариантов: {extraArrival.rows} · {extraArrival.totalQuantity} шт.
          <button type="button" onClick={()=>{setNotice('');setStage('review')}}>Проверить приход новых вариантов →</button>
        </div>}
        <footer><span>{selected.length?selected.length+' товаров выбрано':'Выберите товары'}</span><button type="button" className="primary" disabled={!selected.length} onClick={()=>{setCurrent(selected[0]);setStage('quantities')}}>Перейти к вариантам →</button></footer>
      </div>}
      {stage==='quantities'&&<div className="w6-step"><header><span>ШАГ 2</span><h4>{names[mode].input}: заполните нужные варианты</h4>
        <p><b>Пустое поле не меняет остаток.</b> {mode==='manual_set'?'Ноль устанавливает фактический остаток 0.':'Ноль означает отсутствие движения.'} Изменённое количество видно сразу.</p></header>
        <div className="w6-workspace"><aside><strong>Выбранные товары</strong>{selectedGroups.map(g=>{
          const n=g.rows.filter(row=>inventoryOperationDisplay(mode,draftMap.get(String(row.variantId)))!=='').length
          return <button type="button" className={group?.key===g.key?'is-active':''} key={g.key} onClick={()=>setCurrent(g.key)}>
            <span>{g.productName}</span><small>{n?n+' заполнено':g.rows.length+' вариантов'}</small></button>
        })}<button className="w6-add-more" type="button" onClick={()=>setStage('select')}>+ Добавить другие товары</button></aside>
        <div className="w6-work-main">{group?<>
          <div className="w6-product-heading"><h4>{group.productName}</h4><strong>{group.rows.reduce((n,r)=>n+int(r.quantity),0)} шт. по системе</strong></div>
          {grouped(group.rows).map(position=><section className="w6-position" key={position.key}><h5>{position.title}</h5>
            {position.colors.map(color=><div className="w6-color" key={color.color}><strong>{color.color}</strong><div className="w6-cells">
              {color.variants.map(row=>{
                const value=inventoryOperationDisplay(mode,draftMap.get(String(row.variantId)))
                const before=int(row.quantity)
                const after=value===''?before:inventoryOperationAfter(mode,before,int(value))
                const reserved=int(row.reservedQuantity)
                return <label key={String(row.variantId)} className={'w6-cell'+(value!==''?' is-changed':'')}>
                  <b>{row.size||'Без размера'}</b><small>Сейчас: <strong>{before}</strong></small>
                  <input type="number" inputMode="numeric" min="0" max="999999" step="1"
                    aria-label={group.productName+' '+color.color+' '+(row.size||'')+': '+names[mode].input}
                    placeholder="—" value={value} disabled={busy}
                    onChange={e=>{if(e.target.value!==''&&!/^\d{1,6}$/.test(e.target.value))return;p.onQuantity(row,e.target.value)}}/>
                  <small>Будет: <strong className={before!==after?'w6-difference':''}>{after}</strong></small>
                  {value!==''&&after<reserved&&<small className="w6-warning">В заказах {reserved}. Нехватка {reserved-after}</small>}
                </label>
              })}</div></div>)}
          </section>)}
          <div className="w6-work-nav"><button type="button" disabled={selectedGroups[0]?.key===group.key}
            onClick={()=>setCurrent(selectedGroups[Math.max(0,selectedGroups.findIndex(g=>g.key===group.key)-1)].key)}>← Предыдущий</button>
            <button type="button" disabled={selectedGroups[selectedGroups.length-1]?.key===group.key}
            onClick={()=>setCurrent(selectedGroups[Math.min(selectedGroups.length-1,selectedGroups.findIndex(g=>g.key===group.key)+1)].key)}>Следующий товар →</button></div>
        </>:<p>Выберите товар слева.</p>}</div></div>
        {mode==='arrival'&&isAdmin&&<div className="w6-new-variant"><button type="button" onClick={()=>setNewVariant(!newVariant)}>
          {newVariant?'− Скрыть форму нового варианта':'+ Нет нужной комбинации? Добавить новый вариант'}</button>
          {newVariant&&<div className="w6-new-form"><p>Только для вариантов, которых ещё нет в каталоге. Для существующих используйте ячейки выше.</p>{newVariantWorkspace}</div>}</div>}
        <label className="w6-reason">{mode==='arrival'?'Комментарий к приходу (необязательно)':'Причина '+(mode==='writeoff'?'списания':'корректировки')+' (обязательно)'}
          <input type="text" value={reason} onChange={e=>p.onReason(e.target.value)}
            placeholder={mode==='arrival'?'Например, поставка':'Что произошло с товаром?'} /></label>
        {notice&&<div className="w6-message is-error" role="alert">{notice}</div>}
        <footer><span>{changed?changed+' вариантов · '+count+' шт. изменений':'Нет введённых изменений'}</span>
          <button type="button" className="primary" disabled={!changed||busy} onClick={review}>Проверить перед сохранением →</button></footer>
      </div>}
      {stage==='review'&&<div className="w6-step"><header><span>ШАГ 3</span><h4>Проверка перед сохранением</h4><p>{sourceName(source)} · {names[mode].title}. Пока вы не подтвердили, ничего не изменится.</p></header>
        <div className="w6-review-list">{entries.map(({row,quantity})=>{
          const before=int(row.quantity),after=inventoryOperationAfter(mode,before,quantity)
          return <div key={String(row.variantId)}><span><strong>{row.productName}</strong><small>{[row.gender,row.material,row.length,row.color,row.size].filter(Boolean).join(' · ')}</small></span>
            <span>Сейчас <b>{before}</b></span><span>{names[mode].input} <b>{quantity}</b></span><span>Будет <b>{after}</b></span></div>
        })}
        {mode==='arrival'&&extraArrival.rows>0&&<div><span><strong>Новые варианты</strong><small>Будут созданы в каталоге при приходе</small></span>
          <span>{extraArrival.rows} строк</span><span>+{extraArrival.totalQuantity} шт.</span></div>}</div>
        {notice&&<div className="w6-message is-error" role="alert">{notice}</div>}
        <footer><button type="button" disabled={busy} onClick={()=>setStage('quantities')}>← Исправить</button>
          <button type="button" className="primary" disabled={busy||!changed} onClick={()=>void p.onSave()}>{busy?'Сохраняю…':names[mode].action}</button></footer>
      </div>}
      {stage!=='review'&&<div className="w6-clear"><button type="button" disabled={busy} onClick={reset}>Очистить форму</button><small>Изменения сохраняются в черновике при переходах между товарами.</small></div>}
    </>}
  </section>
}
