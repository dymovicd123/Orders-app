import { useEffect, useMemo, useState } from 'react'
import type { CatalogResponse, CatalogVariantRecord } from '../../app/types'
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
  const [expanded,setExpanded]=useState<number[]>([])
  const activeProducts=useMemo(()=>(catalog?.products||[]).filter(p=>p.isActive),[catalog])
  const candidates=useMemo(()=>activeProducts.filter(p=>normalize(p.name).includes(normalize(productQuery))).slice(0,45),[activeProducts,productQuery])
  const variants=useMemo(()=>(catalog?.variants||[]).filter(v=>v.isActive&&v.productId===draft.productId),[catalog,draft.productId])
  const matches=useMemo(()=>variants.filter(v=>filterKeys.every(k=>!draft.filters[k]||variantValue(v,k)===draft.filters[k])),[variants,draft.filters])
  const values=useMemo(()=>{
    const obj={} as Record<FilterKey,string[]>
    for(const key of filterKeys){
      const relevant=variants.filter(v=>filterKeys.every(other=>other===key||!draft.filters[other]||variantValue(v,other)===draft.filters[other]))
      obj[key]=[...new Set(relevant.map(v=>variantValue(v,key)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}))
    }
    return obj
  },[variants,draft.filters])
  const quotaSum=draft.participants.reduce((s,p)=>s+p.quota,0)
  const conflict=records.filter(r=>r.id!==draft.id&&r.productId===draft.productId&&overlap(r.filters,draft.filters))
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
    setDraft(initial(month));setProductQuery('');setMessage('');setEditing(true)
  }
  function edit(row:Campaign){
    setDraft({id:row.id,month:row.month,title:row.title,productId:row.productId,targetQuantity:row.targetQuantity,
      filters:{...emptyFilters(),...row.filters},
      participants:row.participants.map(p=>({managerId:p.managerId,quota:p.quota,bonusAmount:p.bonusAmount})),
      expectedUpdatedAt:row.updatedAt})
    setProductQuery(row.productName);setMessage('');setEditing(true)
  }
  function selectProduct(id:number){
    setDraft(d=>({...d,productId:id,filters:emptyFilters(),title:''}))
    setProductQuery(activeProducts.find(p=>p.id===id)?.name||'')
  }
  function toggleManager(id:number,checked:boolean){
    setDraft(d=>{
      const list=checked?[...d.participants,{managerId:id,quota:1,bonusAmount:0}]:d.participants.filter(x=>x.managerId!==id)
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
    if(variants.length&&matches.length===0){setError('Таких комбинаций в каталоге нет.');return}
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
  return <section className="pkpi">
    <header className="pkpi-header">
      <div><h3>KPI по товарам</h3><p>Несколько самостоятельных заданий на месяц. Выполнение считается по отправленным заказам, бонус показан расчётно — без начисления зарплаты или выплаты.</p></div>
      {isAdmin?<button type="button" className="primary compact" onClick={create}>+ Новое задание</button>:null}
    </header>
    <div className="pkpi-toolbar">
      <label>Месяц <input type="month" value={month} onChange={e=>{setMonth(e.target.value);setEditing(false)}} /></label>
      <button className="secondary compact" type="button" onClick={()=>void load()} disabled={busy}>Обновить</button>
      <span>{records.length} заданий</span>
    </div>
    {!isAdmin && !currentManagerId?<p className="pkpi-error">Аккаунт не привязан к сотруднику, поэтому личные KPI не отображаются. Обратитесь к администратору.</p>:null}
    {error?<p className="pkpi-error" role="alert">{error}</p>:null}
    {message?<p className="pkpi-ok" role="status">{message}</p>:null}
    {editing&&isAdmin?<div className="pkpi-editor">
      <div className="pkpi-editor-head"><h4>{draft.id?'Изменить KPI':'Новое задание KPI'}</h4><button className="secondary compact" type="button" onClick={()=>setEditing(false)}>Закрыть</button></div>
      <div className="pkpi-two">
        <label>Месяц <input type="month" value={draft.month} onChange={e=>setDraft(d=>({...d,month:e.target.value}))}/></label>
        <label>Название задания (необязательно) <input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))} placeholder="Например, продать Абай шапаны"/></label>
      </div>
      <div className="pkpi-product">
        <label>Поиск товара <input value={productQuery} placeholder="Введите модель из каталога" onChange={e=>{setProductQuery(e.target.value);setDraft(d=>({...d,productId:0,filters:emptyFilters()}))}} /></label>
        <div className="pkpi-product-choices">
          {candidates.map(p=><button key={p.id} type="button" className={draft.productId===p.id?'pkpi-picked':''} onClick={()=>selectProduct(p.id)}>{p.name}</button>)}
        </div>
        {draft.productId?<small>Выбрано: {activeProducts.find(p=>p.id===draft.productId)?.name}. Далее можно уточнить любые характеристики.</small>:<small>Сначала выберите модель. Остальные параметры необязательны.</small>}
      </div>
      {draft.productId?<div className="pkpi-filter-grid">
        {filterKeys.map(key=><label key={key}>{labels[key]}
          <select value={draft.filters[key]} onChange={e=>setDraft(d=>({...d,filters:{...d.filters,[key]:e.target.value}}))}>
            <option value="">Все</option>
            {(draft.filters[key]&&!values[key].includes(draft.filters[key])?[draft.filters[key],...values[key]]:values[key]).map(v=><option key={v} value={v}>{v}</option>)}
          </select></label>)}
        <div className="pkpi-full pkpi-hint">{variants.length?matches.length+' подходящих комбинаций в каталоге': 'У модели пока нет вариантов. Можно задать KPI на модель целиком.'}</div>
        {conflict.length?<p className="pkpi-full pkpi-warn">В этом месяце уже есть {conflict.length} KPI с пересекающимися условиями по модели. Одна продажа может учитываться в каждом таком задании.</p>:null}
      </div>:null}
      <div className="pkpi-quota-head">
        <label>Общая цель, шт. <input type="number" min={1} max={100000} value={draft.targetQuantity} onChange={e=>setDraft(d=>({...d,targetQuantity:numberValue(e.target.value)}))}/></label>
        <button className="secondary compact" type="button" onClick={()=>setDraft(d=>({...d,participants:distribute(d.participants,d.targetQuantity)}))}>Распределить поровну</button>
      </div>
      <div className="pkpi-managers">
        <strong>Менеджеры</strong><p>Выберите участников. Квоты можно изменить вручную; сумма должна равняться общей цели.</p>
        <div className="pkpi-member-picks">{managers.map(m=><label key={m.id}><input type="checkbox" checked={draft.participants.some(p=>p.managerId===m.id)} onChange={e=>toggleManager(m.id,e.target.checked)}/>{m.name}</label>)}</div>
        {draft.participants.length?<div className="pkpi-member-table">
          {draft.participants.map(p=><div key={p.managerId} className="pkpi-member-row">
            <strong>{managers.find(m=>m.id===p.managerId)?.name||'Менеджер #'+p.managerId}</strong>
            <label>Квота <input type="number" min={1} value={p.quota} onChange={e=>setDraft(d=>({...d,participants:d.participants.map(x=>x.managerId===p.managerId?{...x,quota:numberValue(e.target.value)}:x)}))}/></label>
            <label>Бонус, ₸ <input type="number" min={0} value={p.bonusAmount} onChange={e=>setDraft(d=>({...d,participants:d.participants.map(x=>x.managerId===p.managerId?{...x,bonusAmount:numberValue(e.target.value)}:x)}))}/></label>
          </div>)}
        </div>:null}
      </div>
      <div className="pkpi-editor-foot">
        <strong className={quotaSum===draft.targetQuantity?'pkpi-balanced':'pkpi-unbalanced'}>Распределено: {quotaSum} / {draft.targetQuantity} шт.</strong>
        <button className="primary" type="button" onClick={()=>void save()} disabled={saving||!draft.productId||!draft.participants.length||quotaSum!==draft.targetQuantity||draft.targetQuantity<1||draft.participants.some(p=>p.quota<1||p.bonusAmount<1)||Boolean(variants.length&&!matches.length)}>{saving?'Сохраняю…':'Сохранить KPI'}</button>
      </div>
    </div>:null}
    {busy?<p className="pkpi-muted">Загружаем KPI…</p>:null}
    {!busy&&!records.length?<p className="pkpi-empty">{isAdmin?'В этом месяце пока нет заданий KPI. Создайте первое задание.':'На этот месяц вам пока не назначали KPI.'}</p>:null}
    <div className="pkpi-list">{records.map(k=>{
      const totalSold=k.participants.reduce((s,p)=>s+p.sold,0),achieved=k.participants.filter(p=>p.achieved).length
      const expandedNow=expanded.includes(k.id)
      return <article className="pkpi-card" key={k.id}>
        <div className="pkpi-card-header">
          <div><h4>{k.title}</h4><p>{k.productName} · {describe(k.filters)}</p></div>
          <span className="pkpi-card-tag">{k.month}</span>
        </div>
        <div className="pkpi-stats">
          <div><span>Общая цель</span><strong>{k.targetQuantity} шт.</strong></div>
          <div><span>Учтено</span><strong>{totalSold} шт.</strong></div>
          <div><span>Выполнили</span><strong>{achieved} / {k.participants.length}</strong></div>
        </div>
        <div className="pkpi-progress"><div style={{width:Math.min(100,100*totalSold/Math.max(1,k.targetQuantity))+'%'}}/></div>
        <div className="pkpi-card-actions">
          <button className="secondary compact" type="button" onClick={()=>setExpanded(curr=>expandedNow?curr.filter(id=>id!==k.id):[...curr,k.id])}>{expandedNow?'Скрыть участников':'Посмотреть участников'}</button>
          {isAdmin?<><button className="secondary compact" type="button" onClick={()=>edit(k)}>Изменить</button><button className="ghost danger compact" type="button" disabled={saving} onClick={()=>void remove(k)}>Удалить</button></>:null}
        </div>
        {expandedNow?<div className="pkpi-progress-members">{k.participants.map(m=><div className="pkpi-progress-member" key={m.managerId}>
          <div className="pkpi-member-stats"><strong>{m.manager}</strong><span>{m.sold} / {m.quota} шт.</span><span className={m.achieved?'pkpi-balanced':'pkpi-muted'}>{m.achieved?'Выполнено · бонус '+formatMoney(m.earnedBonus):'Осталось '+Math.max(0,m.quota-m.sold)+' шт.'}</span></div>
          <div className="pkpi-progress"><div style={{width:Math.min(100,100*m.sold/Math.max(1,m.quota))+'%'}}/></div>
        </div>)}</div>:null}
      </article>
    })}</div>
    <p className="pkpi-disclaimer">Текущий расчёт: отправленные заказы за выбранный месяц, по действующим товарным позициям, за вычетом самостоятельных возвратов. Обмены и поздние корректировки могут менять результат задним числом. KPI не создаёт финансовых выплат.</p>
  </section>
}
