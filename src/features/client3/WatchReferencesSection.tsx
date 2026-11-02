import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react'
import {WATCH_OPTIONS,WATCH_PAYMENTS,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-references.css'

type Kind='brands'|'sources'|'genders'|'movements'|'bracelets'|'dials'|'leatherColors'|'payments'|'delivery'
type EditableKind='leatherColors'|'payments'|'delivery'
type ValuesResponse={ok:boolean;rows?:Array<{kind:string;value:string}>;message?:string}
const CONFIG:Record<Kind,{label:string;help:string;items:readonly string[];editable?:EditableKind}>={
  brands:{label:'Бренды',help:'Два независимых склада и заказа; характеристики общие.',items:[...WATCH_OPTIONS.brands]},
  sources:{label:'Места хранения',help:'Физические остатки учитываются отдельно.',items:WATCH_OPTIONS.sources.map(x=>x.label)},
  genders:{label:'Пол',help:'Мужские и женские часы.',items:WATCH_OPTIONS.genders.map(x=>x.label)},
  movements:{label:'Механизм',help:'Системные характеристики складского SKU.',items:WATCH_OPTIONS.movements.map(x=>x.label)},
  bracelets:{label:'Браслет',help:'Сталь, кожа и каучук.',items:WATCH_OPTIONS.braceletMaterials.map(x=>x.label)},
  dials:{label:'Цвет циферблата',help:'Системные цвета складского SKU.',items:WATCH_OPTIONS.dialColors.map(x=>x.label)},
  leatherColors:{label:'Цвет ремешка',help:'Общий список для кожаных ремешков обоих брендов.',items:[],editable:'leatherColors'},
  payments:{label:'Способы оплаты',help:'Общий список способов оплаты для новых продаж.',items:[...WATCH_PAYMENTS],editable:'payments'},
  delivery:{label:'Доставка',help:'Общие варианты доставки для новых заказов.',items:['Казпочта','Курьер','Самовывоз','Межгород'],editable:'delivery'},
}
const KINDS=Object.keys(CONFIG) as Kind[]
const serverKind:Record<EditableKind,string>={leatherColors:'leatherColors',payments:'paymentMethods',delivery:'deliveryMethods'}
const emptyLists=():Record<EditableKind,string[]>=>({leatherColors:[],payments:[],delivery:[]})

/** Reference values are shared across brands; SKU identity and stock are not. */
export function WatchReferencesSection({brands,onOpenCatalog,onOpenStaff,canEdit=false}:{
  brand:WatchBrand;brands:readonly WatchBrand[];onBrandChange:(next:WatchBrand)=>void
  onOpenCatalog:()=>void;onOpenStaff?:()=>void;canEdit?:boolean
}){
  const [kind,setKind]=useState<Kind>('leatherColors')
  const [query,setQuery]=useState('')
  const [lists,setLists]=useState(emptyLists)
  const [draft,setDraft]=useState('')
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [reload,setReload]=useState(0)
  const load=useCallback(()=>{
    const controller=new AbortController()
    setLoading(true);setError('')
    void fetch('/api/client3/watches/references',{
      credentials:'include',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const data=await response.json() as ValuesResponse
      if(!response.ok||!data.ok)throw new Error(data.message||'Не удалось загрузить справочники')
      const values=emptyLists()
      for(const row of data.rows||[]){
        if(row.kind==='leatherColors')values.leatherColors.push(row.value)
        if(row.kind==='paymentMethods')values.payments.push(row.value)
        if(row.kind==='deliveryMethods')values.delivery.push(row.value)
      }
      if(!controller.signal.aborted)setLists(values)
    }).catch(cause=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка справочников')
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[])
  useEffect(()=>load(),[load,reload])
  const config=CONFIG[kind]
  const available=kind==='leatherColors'?lists.leatherColors:
    kind==='payments'?lists.payments:kind==='delivery'?lists.delivery:[...config.items]
  const items=useMemo(()=>available.filter(value=>
    value.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))),[available.join('\u0000'),query])
  const create=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!config.editable||!canEdit||saving)return
    const value=draft.trim().replace(/\s+/g,' ')
    if(!value||value.length>80){setError('Укажите значение от 1 до 80 символов.');return}
    setSaving(true);setError('');setNotice('')
    try{
      const response=await fetch('/api/client3/watches/references',{
        method:'POST',credentials:'include',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:serverKind[config.editable],value}),
      })
      const data=await response.json() as ValuesResponse&{alreadyExists?:boolean}
      if(!response.ok||!data.ok)throw new Error(data.message||'Не удалось добавить значение')
      setDraft('');setNotice(data.alreadyExists?'Такое значение уже существует.':'Значение добавлено для обоих брендов.')
      setReload(x=>x+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Сохранение не выполнено')}
    finally{setSaving(false)}
  }
  return <section className="card wide sector-references watch-references-main" id="references">
    <div className="references-hero"><div className="references-hero-main">
      <div className="card-label">Справочники</div>
      <h2>Характеристики и настройки</h2>
      <p>Единые значения для TAUWACH и WACHIZEN. Бренд выбирается при работе с товаром и складом — здесь отдельный выбор не требуется.</p>
      <div className="reference-hero-badges">
        <span className="status-pill status-online">Общие для {brands.length} брендов</span>
        <span className="status-pill">{KINDS.length} разделов</span>
      </div>
    </div><div className="references-hero-aside">
      <div className="references-hero-aside-title">Открытый список</div>
      <strong>{config.label}</strong><span>{config.help}</span>
    </div></div>
    <div className="reference-routing-note">
      <span><strong>Здесь</strong> добавляются доступные значения. <strong>На складе</strong> из них собираются конкретные модели часов.</span>
      <button type="button" className="secondary compact" onClick={onOpenCatalog}>Открыть товары</button>
      {onOpenStaff&&<button type="button" className="secondary compact" onClick={onOpenStaff}>Сотрудники и бренды</button>}
    </div>
    <div className="reference-kind-grid">
      {KINDS.map(x=><button type="button" key={x}
        className={'reference-kind-card '+(kind===x?'is-active':'')}
        onClick={()=>{setKind(x);setQuery('');setDraft('');setError('');setNotice('')}}>
        <span className="reference-kind-card-top"><strong>{CONFIG[x].label}</strong>
          <span>{x==='leatherColors'?lists.leatherColors.length:x==='payments'?lists.payments.length:
            x==='delivery'?lists.delivery.length:CONFIG[x].items.length}</span></span>
        <small>{CONFIG[x].help}</small>
      </button>)}
    </div>
    <div className="references-toolbar">
      <label className="inventory-search"><span>Поиск значений</span>
        <div className="references-search-shell">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название характеристики…"/>
          {query&&<button type="button" className="secondary compact reference-clear-btn"
            onClick={()=>setQuery('')}>Очистить</button>}
        </div>
      </label>
    </div>
    {error&&<p role="alert" className="watch-catalog-editor-error">{error}</p>}
    {notice&&<p role="status" className="watch-catalog-editor-notice">{notice}</p>}
    <div className="references-layout">
      <section className="mini-panel reference-list-panel">
        <div className="mini-panel-head"><div><h3>{config.label}</h3>
          <p className="mini-panel-note">{loading?'Загрузка…':'Всего значений: '+items.length}</p></div></div>
        <div className="reference-list">
          {items.map((value,index)=><div key={value} className="reference-row">
            <div className="reference-row-main">
              <div className="reference-row-title"><strong>{value}</strong>
                <span className="status-pill status-online">Доступно</span></div>
              <span>№ {index+1}</span>
            </div>
          </div>)}
          {!loading&&items.length===0&&<div className="empty-state">
            {query?'Ничего не найдено.':'Значений пока нет. Добавьте первое справа.'}</div>}
        </div>
      </section>
      <section className="mini-panel reference-editor-panel">
        <div className="mini-panel-head"><div><h3>{config.editable?'Добавить значение':'Системный справочник'}</h3>
          <p className="mini-panel-note">{config.editable?'Одно значение действует для обоих брендов.':'Системные коды защищены складским учётом.'}</p></div></div>
        {config.editable&&canEdit?<form className="reference-editor-preview" onSubmit={e=>void create(e)}>
          <label>Новое значение для «{config.label}»
            <input required maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)}
              placeholder={kind==='leatherColors'?'Например: Тёмно-синий':'Название нового значения'}/>
          </label>
          <button type="submit" className="primary" disabled={saving||!draft.trim()}>
            {saving?'Сохранение…':'Добавить в справочник'}</button>
          <p>Уже созданные заказы, остатки и комплектации не изменятся.</p>
        </form>:config.editable?
          <p className="watch-references-readonly">Добавление значений доступно администратору. Все сотрудники видят общий список.</p>:
          <p className="watch-references-readonly">Эти характеристики пока ограничены действующими кодами складской идентичности. Нельзя создавать неработающие варианты, которые склад не сможет сохранить.</p>}
      </section>
    </div>
  </section>
}
