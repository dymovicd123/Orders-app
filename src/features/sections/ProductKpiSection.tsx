import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogResponse, CatalogVariantRecord } from '../../app/types'
import { KpiCharacteristicPicker } from './KpiCharacteristicPicker'
import '../../styles/product-kpi.css'

type FilterKey = 'category' | 'gender' | 'color' | 'material' | 'length' | 'size'
type Filters = Record<FilterKey,string>
type Member = { managerId:number; manager:string; quota:number; bonusAmount:number; sold:number; achieved:boolean; earnedBonus:number }
type Campaign = {
  id:number; month:string; title:string; productId:number; productName:string;
  filters:Filters; targetQuantity:number; updatedAt:string; participants:Member[]
}
type Manager = {id:number;name:string}
type DraftMember = {managerId:number;quota:number;bonusAmount:number}
type Draft = {
  id:number;month:string;title:string;productId:number; targetQuantity:number;
  filters:Filters;participants:DraftMember[];expectedUpdatedAt:string
}
const filterKeys:FilterKey[]=['category','gender','color','material','length','size']
const labels:Record<FilterKey,string>={category:'Категория',gender:'Пол',color:'Цвет',material:'Материал',length:'Длина',size:'Размер / возраст'}
const emptyFilters=():Filters=>({category:'',gender:'',color:'',material:'',length:'',size:''})
const thisMonth=()=>new Date().toISOString().slice(0,7)
const initial=(month:string):Draft=>({id:0,month,title:'',productId:0,targetQuantity:90,filters:emptyFilters(),participants:[],expectedUpdatedAt:''})
const normalize=(s:string)=>String(s||'').trim().toUpperCase()
function variantValue(v:CatalogVariantRecord,key:FilterKey):string{
  if(key==='category')return v.productCategory==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ'
  if(key==='size')return normalize(v.sizeLabel)
  return normalize(v[key])
}
function distribute(members:DraftMember[],target:number){
  if(!members.length)return members
  const base=Math.floor(target/members.length),rem=target%members.length
  return members.map((p,i)=>({...p,quota:base+(i<rem?1:0)}))
}
const numberValue=(raw:string)=>Math.max(0,Math.floor(Number(raw)||0))
const describe=(filters:Filters)=>filterKeys.filter(k=>filters[k]).map(k=>labels[k]+': '+filters[k]).join(' · ')||'Все варианты модели'
function overlap(a:Filters,b:Filters){
  return filterKeys.every(k=>!a[k]||!b[k]||normalize(a[k])===normalize(b[k]))
}
export function ProductKpiSection({apiFetch,isAdmin,currentManagerId,formatMoney}:{
  apiFetch:(url:string,options?:RequestInit)=>Promise<Response>;
  isAdmin:boolean;currentManagerId:number;formatMoney:(value:number)=>string
}){
  const [month,setMonth]=useState(thisMonth)
  const [records,setRecords]=useState<Campaign[]>([])
  const [catalog,setCatalog]=useState<CatalogResponse|null>(null)
  const [managers,setManagers]=useState<Manager[]>([])
  const [busy,setBusy]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState<Draft>(()=>initial(thisMonth()))
  const [productQuery,setProductQuery]=useState('')
  const [searchOpen,setSearchOpen]=useState(false)
  const [detailsOpen,setDetailsOpen]=useState(false)
  const [referenceOptions,setReferenceOptions]=useState<Record<string,string[]>>({})
  const [referenceStatus,setReferenceStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle')
  const [sharedBonus,setSharedBonus]=useState('')
  const productInputRef=useRef<HTMLInputElement|null>(null)
  const editorRef=useRef<HTMLDivElement|null>(null)
  const [highlighted,setHighlighted]=useState(0)
  const [expanded,setExpanded]=useState<number[]>([])
  const activeProducts=useMemo(()=>(catalog?.products||[]).filter(p=>p.isActive),[catalog])
  const candidates=useMemo(()=>{
    const query=normalize(productQuery)
    if(query.length<2)return []
    return activeProducts.filter(p=>normalize(p.name).includes(query))
      .sort((a,b)=>Number(normalize(b.name).startsWith(query))-Number(normalize(a.name).startsWith(query)) || a.name.localeCompare(b.name,'ru'))
      .slice(0,8)
  },[activeProducts,productQuery])
  const variants=useMemo(()=>(catalog?.variants||[]).filter(v=>v.isActive&&v.productId===draft.productId),[catalog,draft.productId])
  const matches=useMemo(()=>variants.filter(v=>filterKeys.every(k=>!draft.filters[k]||variantValue(v,k)===draft.filters[k])),[variants,draft.filters])
  const values=useMemo(()=>{
    const obj={} as Record<FilterKey,string[]>
    for(const key of filterKeys){
      const relevant=variants.filter(v=>filterKeys.every(other=>other===key||!draft.filters[other]||variantValue(v,other)===draft.filters[other]))
      const suggestions=[...new Set([...relevant,...(relevant.length?[]:variants)].map(v=>variantValue(v,key)).filter(Boolean))]
      if(key==='category')suggestions.push('ВЗРОСЛЫЙ','ДЕТСКИЙ')
      if(key==='gender')suggestions.push('ЖЕН','МУЖ','УНИСЕКС')
      obj[key]=[...new Set(suggestions)].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}))
    }
    return obj
  },[variants,draft.filters])
  useEffect(()=>{
    if(!isAdmin||!editing||!detailsOpen||referenceStatus!=='idle')return
    let cancelled=false
    setReferenceStatus('loading')
    async function loadCharacteristics(){
      const kinds=['colors','materials','lengths','sizes','childAges']
      try{
        const responses=await Promise.all(kinds.map(kind=>apiFetch('/api/reference-values?kind='+kind)))
        const parsed=await Promise.all(responses.map(response=>response.json()))
        if(responses.some(response=>!response.ok)||parsed.some(item=>!item.ok))throw new Error('Не удалось загрузить справочники')
        if(cancelled)return
        const options:Record<string,string[]>={}
        for(let i=0;i<kinds.length;i++){
          options[kinds[i]]=(parsed[i].items||[])
            .filter((item:{isActive:boolean})=>item.isActive)
            .map((item:{value:string})=>normalize(item.value))
            .filter(Boolean)
        }
        setReferenceOptions({
          color:options.colors||[],
          material:options.materials||[],
          length:options.lengths||[],
          size:[...new Set([...(options.sizes||[]),...(options.childAges||[])])],
        })
        setReferenceStatus('ready')
      }catch{
        if(!cancelled)setReferenceStatus('error')
      }
    }
    void loadCharacteristics()
    return ()=>{cancelled=true}
  },[editing,detailsOpen,isAdmin,referenceStatus,apiFetch])
  const quotaSum=draft.participants.reduce((s,p)=>s+p.quota,0)
  const conflict=records.filter(r=>r.id!==draft.id&&r.productId===draft.productId&&overlap(r.filters,draft.filters))
  useEffect(()=>{
    if(!editing)return
    const frame=window.requestAnimationFrame(()=>editorRef.current?.scrollIntoView({behavior:'smooth',block:'start'}))
    return ()=>window.cancelAnimationFrame(frame)
  },[editing,draft.id])

  function handleProductKey(event:KeyboardEvent<HTMLInputElement>){
    if(event.key==='Escape'){setSearchOpen(false);return}
    if(!searchOpen||!candidates.length)return
    if(event.key==='ArrowDown'){event.preventDefault();setHighlighted(i=>(i+1)%candidates.length)}
    if(event.key==='ArrowUp'){event.preventDefault();setHighlighted(i=>(i-1+candidates.length)%candidates.length)}
    if(event.key==='Enter'){
      event.preventDefault()
      selectProduct(candidates[Math.min(highlighted,candidates.length-1)].id)
    }
  }

  function changeProduct(){
    setDraft(d=>({...d,productId:0,filters:emptyFilters()}))
    setProductQuery('')
    setDetailsOpen(false)
    setSearchOpen(true)
    setHighlighted(0)
    window.requestAnimationFrame(()=>productInputRef.current?.focus())
  }

  async function load(targetMonth=month){
    setBusy(true);setError('')
    try{
      const response=await apiFetch('/api/product-kpis?month='+encodeURIComponent(targetMonth))
      const json=await response.json()
      if(!response.ok||!json.ok)throw new Error(json.message||'Не удалось загрузить KPI.')
      setRecords(json.records||[])
    }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить KPI.')}
    finally{setBusy(false)}
  }
  useEffect(()=>{void load(month)},[month])
  useEffect(()=>{
    if(!isAdmin)return
    async function initialData(){
      try{
        const [c,m]=await Promise.all([apiFetch('/api/catalog'),apiFetch('/api/product-kpis/eligible-managers')])
        const [cd,md]=await Promise.all([c.json(),m.json()])
        if(!c.ok||!cd.ok||!m.ok||!md.ok)throw new Error(cd.message||md.message||'Не удалось получить каталог и менеджеров.')
        setCatalog(cd)
        setManagers((md.managers||[]).map((row:any)=>({id:Number(row.id),name:String(row.name)})))
      }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить справочники KPI.')}
    }
    void initialData()
  },[isAdmin])
  function create(){
    setDraft(initial(month));setProductQuery('');setSearchOpen(false);setDetailsOpen(false);setSharedBonus('');setMessage('');setError('');setEditing(true)
  }
  function edit(row:Campaign){
    setDraft({id:row.id,month:row.month,title:row.title,productId:row.productId,targetQuantity:row.targetQuantity,
      filters:{...emptyFilters(),...row.filters},
      participants:row.participants.map(p=>({managerId:p.managerId,quota:p.quota,bonusAmount:p.bonusAmount})),
      expectedUpdatedAt:row.updatedAt})
    setProductQuery(row.productName);setSearchOpen(false);setDetailsOpen(filterKeys.some(k=>Boolean(row.filters[k])));setSharedBonus('');setMessage('');setError('');setEditing(true)
  }
  function selectProduct(id:number){
    setDraft(d=>({...d,productId:id,filters:emptyFilters(),title:''}))
    setProductQuery(activeProducts.find(p=>p.id===id)?.name||'')
    setSearchOpen(false)
    setHighlighted(0)
    setDetailsOpen(false)
  }
  function toggleManager(id:number,checked:boolean){
    setDraft(d=>{
      const list=checked?[...d.participants,{managerId:id,quota:1,bonusAmount:numberValue(sharedBonus)}]:d.participants.filter(x=>x.managerId!==id)
      return {...d,participants:distribute(list,d.targetQuantity)}
    })
  }
  async function save(){
    setError('');setMessage('')
    if(!draft.productId){setError('Выберите товар из каталога.');return}
    if(!draft.participants.length){setError('Добавьте менеджеров.');return}
    if(draft.participants.some(p=>p.quota<=0)){setError('У каждого менеджера должна быть положительная квота.');return}
    if(draft.participants.some(p=>p.bonusAmount<=0)){setError('Укажите бонус каждому менеджеру.');return}
    if(quotaSum!==draft.targetQuantity){setError('Распределите всю общую цель между менеджерами.');return}
    setSaving(true)
    try{
      const response=await apiFetch('/api/product-kpis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)})
      const json=await response.json()
      if(!response.ok||!json.ok)throw new Error(json.message||'Не удалось сохранить KPI.')
      setEditing(false);setMessage(draft.id?'KPI обновлён.':'KPI создан.')
      if(draft.month!==month)setMonth(draft.month)
      else await load(month)
    }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить KPI.')}
    finally{setSaving(false)}
  }
  async function remove(row:Campaign){
    if(!window.confirm('Удалить KPI «'+row.title+'» за '+row.month+'?'))return
    setError('');setSaving(true)
    try{
      const r=await apiFetch('/api/product-kpis/'+row.id,{method:'DELETE'})
      const x=await r.json()
      if(!r.ok||!x.ok)throw new Error(x.message||'Не удалось удалить KPI.')
      setMessage('Задание удалено.');await load(month)
    }catch(e){setError(e instanceof Error?e.message:'Не удалось удалить KPI.')}
    finally{setSaving(false)}
  }
  const selectedProduct=activeProducts.find(p=>p.id===draft.productId)
  const activeDetails=filterKeys.filter(k=>Boolean(draft.filters[k])).length
  const canSave=!saving&&Boolean(draft.productId)&&draft.targetQuantity>0&&Boolean(draft.participants.length)
    &&quotaSum===draft.targetQuantity&&draft.participants.every(p=>p.quota>0&&p.bonusAmount>0)

  return <section className="pkpi">
    <div className="pkpi-toolbar">
      <label className="pkpi-month">Месяц <input type="month" value={month} onChange={e=>{setMonth(e.target.value);setEditing(false)}}/></label>
      <div className="pkpi-toolbar-actions">
        <span className="pkpi-count">{records.length===1?'1 задание':records.length+' заданий'}</span>
        <button type="button" className="pkpi-refresh" onClick={()=>void load()} disabled={busy} title="Обновить KPI" aria-label="Обновить KPI"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.2 5.5"/><path d="M20 4v7h-7"/></svg></button>
        {isAdmin?<button type="button" className="primary pkpi-create-button" onClick={create}>+ Создать KPI</button>:null}
      </div>
    </div>
    {!isAdmin&&!currentManagerId?<p className="pkpi-error">Учётная запись не привязана к сотруднику. Обратитесь к администратору.</p>:null}
    {error?<p className="pkpi-error" role="alert">{error}</p>:null}
    {message?<p className="pkpi-ok" role="status">{message}</p>:null}

    {editing&&isAdmin?<div className="pkpi-editor" ref={editorRef}>
      <div className="pkpi-editor-head">
        <div><h3>{draft.id?'Редактирование KPI':'Новый KPI'}</h3><span>На {new Date(draft.month+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</span></div>
        <button type="button" className="pkpi-close" onClick={()=>setEditing(false)} aria-label="Закрыть форму"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg></button>
      </div>

      <div className="pkpi-fields">
        <div className="pkpi-form-group">
          <label className="pkpi-field-title" htmlFor="pkpi-product-search">Какой товар нужно продать?</label>
          {selectedProduct?
            <div className="pkpi-product-selected">
              <span className="pkpi-product-name">{selectedProduct.name}</span>
              <button type="button" onClick={changeProduct}>Сменить</button>
            </div>
            :
            <div className="pkpi-product-search" onBlur={e=>{
              if(!e.currentTarget.contains(e.relatedTarget as Node))setSearchOpen(false)
            }}>
              <input id="pkpi-product-search" ref={productInputRef} type="search" autoComplete="off"
                role="combobox" aria-autocomplete="list" aria-expanded={searchOpen&&productQuery.trim().length>=2&&candidates.length>0}
                aria-controls="pkpi-search-options"
                placeholder="Начните вводить название модели…"
                value={productQuery}
                onFocus={()=>setSearchOpen(true)}
                onChange={e=>{setProductQuery(e.target.value);setSearchOpen(true);setHighlighted(0)}}
                onKeyDown={handleProductKey}/>
              {searchOpen&&productQuery.trim().length>=2?
                <div id="pkpi-search-options" className="pkpi-search-results" role="listbox" aria-label="Подходящие товары">
                  {candidates.map((p,i)=><button key={p.id} type="button" role="option" aria-selected={i===highlighted}
                    className={i===highlighted?'is-highlighted':''}
                    onMouseEnter={()=>setHighlighted(i)} onClick={()=>selectProduct(p.id)}>{p.name}</button>)}
                  {!candidates.length?<div className="pkpi-no-results">Ничего не найдено. Попробуйте другое название.</div>:null}
                </div>:null}
            </div>}
          {draft.productId?<div className="pkpi-attributes">
            <button type="button" className="pkpi-attributes-toggle" aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(v=>!v)}>
              <span>{activeDetails?'Характеристики: '+activeDetails+' выбрано':'Уточнить характеристики'}</span>
              <span>{activeDetails?describe(draft.filters):'Все цвета, материалы и размеры'}</span>
              <span className="pkpi-chevron">{detailsOpen?'⌃':'⌄'}</span>
            </button>
            {detailsOpen?<div className="pkpi-filter-grid">
              {filterKeys.map(key=><KpiCharacteristicPicker key={key}
                label={labels[key]} value={draft.filters[key]}
                modelOptions={values[key]}
                referenceOptions={key==='category'?['ВЗРОСЛЫЙ','ДЕТСКИЙ']:key==='gender'?['ЖЕН','МУЖ','УНИСЕКС']:(referenceOptions[key]||[])}
                referenceStatus={key==='category'||key==='gender'?'ready':referenceStatus==='idle'?'loading':referenceStatus}
                onChange={value=>setDraft(d=>({...d,filters:{...d.filters,[key]:value}}))}/>)}
              <span className="pkpi-filter-note">
                {matches.length>0?matches.length+' сочетаний есть у модели': 'Выбранных сочетаний пока нет у модели — KPI всё равно можно создать'}
              </span>
              {activeDetails?<button type="button" className="pkpi-filter-reset" onClick={()=>setDraft(d=>({...d,filters:emptyFilters()}))}>Сбросить уточнения</button>:null}
            </div>:null}
          </div>:null}
          {conflict.length?<p className="pkpi-warn">Есть похожий KPI в этом месяце. Одна продажа может пойти в зачёт сразу нескольких заданий.</p>:null}
        </div>

        <div className="pkpi-target-row">
          <label className="pkpi-field-title">Цель на месяц, шт.
            <input className="pkpi-target-input" type="number" min={1} max={100000} value={draft.targetQuantity}
              onChange={e=>setDraft(d=>({...d,targetQuantity:numberValue(e.target.value)}))}/>
          </label>
          <label className="pkpi-field-title pkpi-optional-name">Название (необязательно)
            <input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}
              placeholder={selectedProduct?.name||'Например, осенняя акция'}/>
          </label>
        </div>

        <div className="pkpi-participants">
          <div className="pkpi-section-title">
            <h4>Кто участвует</h4>
            <span>{draft.participants.length?draft.participants.length+' выбрано':'Выберите менеджеров'}</span>
          </div>
          <div className="pkpi-member-picks">
            {managers.map(m=>{
              const chosen=draft.participants.some(p=>p.managerId===m.id)
              return <button key={m.id} type="button" className={chosen?'is-selected':''}
                aria-pressed={chosen} onClick={()=>toggleManager(m.id,!chosen)}>
                {m.name}
              </button>
            })}
          </div>

          {draft.participants.length>0?<div className="pkpi-allocation">
            <div className="pkpi-allocation-head">
              <div><strong>Распределение плана</strong><span>Можно скорректировать долю каждого</span></div>
              <button type="button" className="secondary compact"
                onClick={()=>setDraft(d=>({...d,participants:distribute(d.participants,d.targetQuantity)}))}>Разделить поровну</button>
            </div>
            <div className="pkpi-member-table">
              <div className="pkpi-member-table-head"><span>Менеджер</span><span>Штук</span><span>Бонус, ₸</span></div>
              {draft.participants.map(p=><div className="pkpi-member-row" key={p.managerId}>
                <strong>{managers.find(m=>m.id===p.managerId)?.name||'Менеджер #'+p.managerId}</strong>
                <label aria-label="Квота"><span className="pkpi-mobile-label">Штук</span>
                  <input type="number" min={1} value={p.quota}
                    onChange={e=>setDraft(d=>({...d,participants:d.participants.map(x=>x.managerId===p.managerId?{...x,quota:numberValue(e.target.value)}:x)}))}/></label>
                <label aria-label="Бонус"><span className="pkpi-mobile-label">Бонус, ₸</span>
                  <input type="number" min={1} value={p.bonusAmount||''} placeholder="—"
                    onChange={e=>setDraft(d=>({...d,participants:d.participants.map(x=>x.managerId===p.managerId?{...x,bonusAmount:numberValue(e.target.value)}:x)}))}/></label>
              </div>)}
            </div>
            <div className="pkpi-bonus-common">
              <label>Одинаковый бонус всем, ₸
                <input type="number" min={1} value={sharedBonus} placeholder="Сумма" onChange={e=>setSharedBonus(e.target.value)}/>
              </label>
              <button type="button" className="secondary compact" disabled={!numberValue(sharedBonus)}
                onClick={()=>setDraft(d=>({...d,participants:d.participants.map(p=>({...p,bonusAmount:numberValue(sharedBonus)}))}))}>Применить</button>
            </div>
          </div>:null}
        </div>
      </div>

      <div className="pkpi-editor-foot">
        <div>
          <strong className={draft.participants.length&&quotaSum===draft.targetQuantity?'pkpi-balanced':'pkpi-unbalanced'}>
            {quotaSum} из {draft.targetQuantity} шт. распределено
          </strong>
          {quotaSum!==draft.targetQuantity&&draft.participants.length>0?
            <small>{quotaSum<draft.targetQuantity?'Осталось '+(draft.targetQuantity-quotaSum)+' шт.':'Превышение на '+(quotaSum-draft.targetQuantity)+' шт.'}</small>:null}
        </div>
        <div className="pkpi-editor-buttons">
          <button type="button" className="secondary compact" onClick={()=>setEditing(false)}>Отмена</button>
          <button type="button" className="primary" onClick={()=>void save()} disabled={!canSave}>
            {saving?'Сохраняем…':draft.id?'Сохранить изменения':'Создать KPI'}
          </button>
        </div>
      </div>
    </div>:null}
    {!editing&&!busy&&records.length===0?
      <div className="pkpi-empty">
        <strong>{isAdmin?'Заданий на этот месяц ещё нет':'На этот месяц KPI пока не назначены'}</strong>
        {isAdmin?<><p>Создайте первое задание: выберите товар, участников и цель.</p>
          <button type="button" className="secondary compact" onClick={create}>+ Создать KPI</button></>:null}
      </div>:null}
    {busy?<p className="pkpi-loading" role="status">Загружаем KPI…</p>:null}
    <div className="pkpi-list">{records.map(k=>{
      const totalSold=k.participants.reduce((sum,p)=>sum+p.sold,0)
      const achieved=k.participants.filter(p=>p.achieved).length
      const expandedNow=expanded.includes(k.id)
      return <article className="pkpi-card" key={k.id}>
        <div className="pkpi-card-header">
          <div><h4>{k.title}</h4><p>{k.productName}{describe(k.filters)==='Все варианты модели'?' · Все варианты':' · '+describe(k.filters)}</p></div>
          <span className="pkpi-summary">{achieved} из {k.participants.length} выполнили</span>
        </div>
        <div className="pkpi-summary-row">
          <strong>{totalSold} <span>/ {k.targetQuantity} шт.</span></strong>
          <span>{Math.round(100*totalSold/Math.max(1,k.targetQuantity))}%</span>
        </div>
        <div className="pkpi-progress"><div style={{width:Math.min(100,100*totalSold/Math.max(1,k.targetQuantity))+'%'}}/></div>
        <div className="pkpi-card-actions">
          <button className="secondary compact" type="button"
            onClick={()=>setExpanded(curr=>expandedNow?curr.filter(id=>id!==k.id):[...curr,k.id])}>
            {expandedNow?'Скрыть участников':'Участники и прогресс'}
          </button>
          {isAdmin?<><button className="secondary compact" type="button" onClick={()=>edit(k)}>Изменить</button>
            <button className="ghost danger compact" type="button" disabled={saving} onClick={()=>void remove(k)}>Удалить</button></>:null}
        </div>
        {expandedNow?<div className="pkpi-progress-members">{k.participants.map(m=><div className="pkpi-progress-member" key={m.managerId}>
          <div className="pkpi-member-stats"><strong>{m.manager}</strong><span>{m.sold} / {m.quota} шт.</span>
            <span className={m.achieved?'pkpi-balanced':'pkpi-muted'}>
              {m.achieved?'Выполнено · бонус '+formatMoney(m.earnedBonus):'Осталось '+Math.max(0,m.quota-m.sold)+' шт.'}
            </span></div>
          <div className="pkpi-progress"><div style={{width:Math.min(100,100*m.sold/Math.max(1,m.quota))+'%'}}/></div>
        </div>)}</div>:null}
      </article>
    })}</div>
    {records.length>0?<p className="pkpi-disclaimer">В зачёт идут отправленные заказы с учётом возвратов. Бонусы здесь рассчитываются, но не выплачиваются.</p>:null}
  </section>
}
