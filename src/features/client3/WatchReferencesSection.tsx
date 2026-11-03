import {useCallback,useEffect,useState,type FormEvent} from 'react'
import {WATCH_OPTIONS,WATCH_PAYMENTS,watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-references.css'

type Kind='brands'|'sources'|'genders'|'movements'|'bracelets'|'dials'|'leatherColors'|'payments'|'delivery'|'cities'
type EditableKind='movements'|'bracelets'|'dials'|'leatherColors'|'payments'|'delivery'|'cities'
type ReferenceEntry={id:number;kind:string;value:string}
type ValuesResponse={ok:boolean;rows?:ReferenceEntry[];message?:string}
const CONFIG:Record<Kind,{label:string;help:string;items:readonly string[];editable?:EditableKind}>={
  brands:{label:'Бренды',help:'Два независимых склада и заказа; характеристики общие.',items:[...WATCH_OPTIONS.brands]},
  sources:{label:'Места хранения',help:'Физические остатки учитываются отдельно.',items:WATCH_OPTIONS.sources.map(x=>x.label)},
  genders:{label:'Пол',help:'Мужские и женские часы.',items:WATCH_OPTIONS.genders.map(x=>x.label)},
  movements:{label:'Механизм',help:'Общие характеристики для обоих брендов.',items:[],editable:'movements'},
  bracelets:{label:'Материал браслета',help:'Общие материалы и новые значения с пробелами.',items:[],editable:'bracelets'},
  dials:{label:'Цвет циферблата',help:'Цвета, включая составные названия из нескольких слов.',items:[],editable:'dials'},
  leatherColors:{label:'Цвет ремешка',help:'Общий список для кожаных ремешков обоих брендов.',items:[],editable:'leatherColors'},
  payments:{label:'Способы оплаты',help:'Общий список способов оплаты для новых продаж.',items:[...WATCH_PAYMENTS],editable:'payments'},
  delivery:{label:'Доставка',help:'Общие варианты доставки для новых заказов.',items:['Казпочта','Курьер','Самовывоз','Межгород'],editable:'delivery'},
  cities:{label:'Города',help:'Города из Main для адресов доставки, без ограничения свободного ввода.',items:[],editable:'cities'},
}
const KINDS=Object.keys(CONFIG) as Kind[]
const serverKind:Record<EditableKind,string>={movements:'movements',bracelets:'bracelets',dials:'dials',leatherColors:'leatherColors',payments:'paymentMethods',delivery:'deliveryMethods',cities:'cities'}
const emptyLists=():Record<EditableKind,ReferenceEntry[]>=>({movements:[],bracelets:[],dials:[],leatherColors:[],payments:[],delivery:[],cities:[]})

/** Reference values are shared across brands; SKU identity and stock are not. */
export function WatchReferencesSection({brands,onOpenCatalog,onOpenStaff,canEdit=false}:{
  brand:WatchBrand;brands:readonly WatchBrand[];onBrandChange:(next:WatchBrand)=>void
  onOpenCatalog:()=>void;onOpenStaff?:()=>void;canEdit?:boolean
}){
  const [kind,setKind]=useState<Kind>('leatherColors')
  const [query,setQuery]=useState('')
  const [lists,setLists]=useState(emptyLists)
  const [draft,setDraft]=useState('')
  const [editId,setEditId]=useState<number|null>(null)
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
        const kind=(Object.keys(serverKind) as EditableKind[]).find(k=>serverKind[k]===row.kind)
        if(kind)values[kind].push(row)
      }
      if(!controller.signal.aborted)setLists(values)
    }).catch(cause=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка справочников')
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[])
  useEffect(()=>load(),[load,reload])
  const config=CONFIG[kind]
  const available=config.editable?lists[config.editable]:config.items.map((value,index)=>({id:-index-1,kind,value}))
  const items=available.filter(item=>
    item.value.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  const create=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!config.editable||!canEdit||saving)return
    const value=draft.trim().replace(/\s+/g,' ').toLocaleUpperCase('ru-RU')
    if(!value||value.length>80){setError('Укажите значение от 1 до 80 символов.');return}
    setSaving(true);setError('');setNotice('')
    try{
      const response=await fetch('/api/client3/watches/references',{
        method:editId?'PATCH':'POST',credentials:'include',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:serverKind[config.editable],value,id:editId}),
      })
      const data=await response.json() as ValuesResponse&{alreadyExists?:boolean}
      if(!response.ok||!data.ok)throw new Error(data.message||'Не удалось добавить значение')
      setDraft('');setEditId(null);setNotice(data.alreadyExists?'Такое значение уже существует.':editId?'Значение обновлено.':'Значение добавлено для обоих брендов.')
      setReload(x=>x+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Сохранение не выполнено')}
    finally{setSaving(false)}
  }
  const remove=async(item:ReferenceEntry)=>{
    if(!canEdit||!config.editable||item.id<1||saving)return
    if(!window.confirm('Удалить «'+item.value+'» из справочника? Связанные исторические записи сохранятся.'))return
    setSaving(true);setError('');setNotice('')
    try{
      const response=await fetch('/api/client3/watches/references/'+item.id,{
        method:'DELETE',credentials:'include',cache:'no-store',
      })
      const data=await response.json() as ValuesResponse
      if(!response.ok||!data.ok)throw new Error(data.message||'Удаление не выполнено')
      if(editId===item.id){setEditId(null);setDraft('')}
      setNotice('Значение удалено из активного списка. История сохранена.')
      setReload(x=>x+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось удалить значение')}
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
        onClick={()=>{setKind(x);setQuery('');setDraft('');setEditId(null);setError('');setNotice('')}}>
        <span className="reference-kind-card-top"><strong>{CONFIG[x].label}</strong>
          <span>{CONFIG[x].editable?lists[CONFIG[x].editable].length:CONFIG[x].items.length}</span></span>
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
          {items.map((item,index)=><div key={item.id} className="reference-row">
            <div className="reference-row-main">
              <div className="reference-row-title"><strong>{watchReferenceLabel(serverKind[config.editable||'delivery']||kind,item.value)}</strong>
                <span className="status-pill status-online">Доступно</span></div>
              <span>№ {index+1}</span>
              {canEdit&&config.editable&&<div className="reference-row-actions">
                <button type="button" className="secondary compact" disabled={saving}
                  onClick={()=>{setEditId(item.id);setDraft(item.value.toLocaleUpperCase('ru-RU'));setError('')}}>Изменить</button>
                <button type="button" className="danger compact" disabled={saving}
                  onClick={()=>void remove(item)}>Удалить</button>
              </div>}
            </div>
          </div>)}
          {!loading&&items.length===0&&<div className="empty-state">
            {query?'Ничего не найдено.':'Значений пока нет. Добавьте первое справа.'}</div>}
        </div>
      </section>
      <section className="mini-panel reference-editor-panel">
        <div className="mini-panel-head"><div><h3>{config.editable?(editId?'Изменить значение':'Добавить значение'):'Фиксированные параметры'}</h3>
          <p className="mini-panel-note">{config.editable?'Одно значение действует для обоих брендов.':'Системные коды защищены складским учётом.'}</p></div></div>
        {config.editable&&canEdit?<form className="reference-editor-preview" onSubmit={e=>void create(e)}>
          <label>Новое значение для «{config.label}»
            <input required maxLength={80} value={draft} onChange={e=>setDraft(e.target.value.toLocaleUpperCase('ru-RU'))}
              placeholder={kind==='leatherColors'?'Например: ЧЕРНЫЙ':kind==='cities'?'Например: АЛМАТЫ':'НОВОЕ ЗНАЧЕНИЕ'}/>
          </label>
          <button type="submit" className="primary" disabled={saving||!draft.trim()}>
            {saving?'Сохранение…':editId?'Сохранить изменения':'Добавить в справочник'}</button>
          {editId&&<button type="button" className="secondary compact" onClick={()=>{setEditId(null);setDraft('')}}>Отмена</button>}
          <p>Уже созданные заказы, остатки и комплектации не изменятся.</p>
        </form>:config.editable?
          <p className="watch-references-readonly">Добавление значений доступно администратору. Все сотрудники видят общий список.</p>:
          <p className="watch-references-readonly">Пол по требованию клиента ограничен мужским и женским, бренды и места хранения являются системными границами. Остальные характеристики редактируются в общих справочниках.</p>}
      </section>
    </div>
  </section>
}
