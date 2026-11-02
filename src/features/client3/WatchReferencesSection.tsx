import {useEffect,useMemo,useState} from 'react'
import {WATCH_OPTIONS,WATCH_PAYMENTS,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-references.css'

type Item={key:string;label:string}
type Kind='brands'|'sources'|'genders'|'movements'|'bracelets'|'dials'|'leatherColors'|'payments'|'delivery'
const CONFIG:Record<Kind,{label:string;help:string;items:readonly Item[];locked:boolean}>={
  brands:{label:'Бренды',help:'TAUWACH и WACHIZEN: отдельные товары, менеджеры и финансы.',
    items:WATCH_OPTIONS.brands.map(x=>({key:x,label:x})),locked:true},
  sources:{label:'Места хранения',help:'Учитываются отдельно в каждом бренде.',
    items:WATCH_OPTIONS.sources.map(x=>({key:x.value,label:x.label})),locked:true},
  genders:{label:'Пол',help:'Только мужские и женские часы.',
    items:WATCH_OPTIONS.genders.map(x=>({key:x.value,label:x.label})),locked:true},
  movements:{label:'Механизм',help:'Характеристика конкретной комплектации часов.',
    items:WATCH_OPTIONS.movements.map(x=>({key:x.value,label:x.label})),locked:true},
  bracelets:{label:'Браслет',help:'Стальной, кожаный или каучуковый.',
    items:WATCH_OPTIONS.braceletMaterials.map(x=>({key:x.value,label:x.label})),locked:true},
  dials:{label:'Цвет циферблата',help:'Рабочие значения для комплектаций.',
    items:WATCH_OPTIONS.dialColors.map(x=>({key:x.value,label:x.label})),locked:true},
  leatherColors:{label:'Цвет кожаного ремешка',help:'Используемые цвета текущего бренда; новые вводятся при добавлении комплектации.',
    items:[],locked:false},
  payments:{label:'Способы оплаты',help:'Фиксированные варианты продажи часов.',
    items:WATCH_PAYMENTS.map(x=>({key:x,label:x})),locked:true},
  delivery:{label:'Доставка',help:'Способы доставки в форме заказа.',
    items:['Казпочта','Курьер','Самовывоз','Межгород'].map(x=>({key:x,label:x})),locked:true},
}
const KINDS=Object.keys(CONFIG) as Kind[]
type Catalog={ok:boolean;rows?:Array<{braceletColor?:string|null;braceletMaterial?:string|null}>;message?:string}
export function WatchReferencesSection({brand,brands,onBrandChange,onOpenCatalog,onOpenStaff}:{
  brand:WatchBrand;brands:readonly WatchBrand[];onBrandChange:(next:WatchBrand)=>void;
  onOpenCatalog:()=>void;onOpenStaff:()=>void
}){
  const [kind,setKind]=useState<Kind>('brands')
  const [query,setQuery]=useState('')
  const [strapColors,setStrapColors]=useState<string[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    setLoading(true);setError('');setStrapColors([])
    void fetch('/api/client3/watches/catalog?brand='+encodeURIComponent(brand),{
      credentials:'include',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const data=await response.json() as Catalog
      if(!response.ok||!data.ok)throw new Error(data.message||'Не удалось получить цвета ремешков')
      const colors=(data.rows||[]).filter(x=>x.braceletMaterial==='leather'&&x.braceletColor)
        .map(x=>x.braceletColor!.trim()).filter(Boolean)
      if(!controller.signal.aborted)setStrapColors([...new Set(colors)].sort((a,b)=>a.localeCompare(b,'ru')))
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Не удалось прочитать цвета ремешков')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[brand])
  const config=CONFIG[kind]
  const items=useMemo(()=>{
    const source=kind==='leatherColors'?strapColors.map(x=>({key:x,label:x})):config.items
    const needle=query.trim().toLocaleLowerCase('ru')
    return source.filter(x=>!needle||x.label.toLocaleLowerCase('ru').includes(needle))
  },[kind,query,strapColors,config.items])
  return <section className="card wide sector-references watch-references-main" id="references">
    <div className="references-hero">
      <div className="references-hero-main">
        <div className="card-label">Справочники</div>
        <h2>Все рабочие справочники</h2>
        <p>Параметры часов, источники, бренды, способы оплаты и доставки.
          Значения берутся из реальных правил Client3, а не из справочников одежды Main.</p>
        <div className="reference-hero-badges">
          <span className="status-pill status-online">Брендов: {brands.length}</span>
          <span className="status-pill">Списков: {KINDS.length}</span>
          <span className="status-pill">Раздел: {config.label}</span>
        </div>
      </div>
      <div className="references-hero-aside">
        <div className="references-hero-aside-title">Текущий список</div>
        <strong>{config.label}</strong>
        <span>{config.help}</span>
      </div>
    </div>
    <div className="reference-routing-note">
      <span><strong>Справочники</strong> — значения, доступные при работе с часами.</span>
      <span><strong>Склад → Товары</strong> — создание комплектаций и цен.</span>
      <button type="button" className="secondary compact" onClick={onOpenCatalog}>Открыть товары</button>
      <button type="button" className="secondary compact" onClick={onOpenStaff}>Доступ к брендам</button>
    </div>
    <div className="watch-references-brand-scope">
      <strong>Данные бренда:</strong>
      <div role="group" aria-label="Выбранный бренд справочников">
        {brands.map(value=><button key={value} type="button"
          aria-pressed={brand===value} className={brand===value?'is-active':''}
          onClick={()=>onBrandChange(value)}>{value}</button>)}
      </div>
      <small>Общие значения действуют для обоих брендов; цвета ремешков читаются отдельно.</small>
    </div>
    <div className="reference-kind-grid">
      {KINDS.map(x=><button type="button" key={x}
        className={'reference-kind-card '+(kind===x?'is-active':'')}
        onClick={()=>{setKind(x);setQuery('')}}>
        <span className="reference-kind-card-top"><strong>{CONFIG[x].label}</strong>
          <span>{x==='leatherColors'?strapColors.length:CONFIG[x].items.length}</span></span>
        <small>{CONFIG[x].help}</small>
      </button>)}
    </div>
    <div className="references-toolbar">
      <label className="inventory-search"><span>Поиск</span>
        <div className="references-search-shell">
          <input value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="Найти значение…"/>
          {query&&<button type="button" className="secondary compact reference-clear-btn"
            onClick={()=>setQuery('')}>Очистить</button>}
        </div>
      </label>
    </div>
    <div className="references-layout">
      <section className="mini-panel reference-list-panel">
        <div className="mini-panel-head"><div><h3>{config.label}</h3>
          <p className="mini-panel-note">Показано {items.length} значений.</p></div></div>
        {kind==='leatherColors'&&error&&<p role="alert">{error}</p>}
        {kind==='leatherColors'&&loading&&<p role="status">Загрузка цветов ремешков…</p>}
        <div className="reference-list">
          {items.map((item,index)=><div key={item.key} className="reference-row">
            <div className="reference-row-main">
              <div className="reference-row-title"><strong>{item.label}</strong>
                <span className="status-pill status-online">Используется</span></div>
              <span>Порядок: {index+1}</span>
            </div>
          </div>)}
          {!items.length&&!loading&&<div className="empty-state">
            {query?'Совпадений нет.':'Значения ещё не добавлены в комплектации этого бренда.'}</div>}
        </div>
      </section>
      <section className="mini-panel reference-editor-panel">
        <div className="mini-panel-head"><div><h3>Как изменить значения</h3>
          <p className="mini-panel-note">Безопасный порядок работы с характеристиками часов.</p></div></div>
        <div className="reference-editor-preview">
          <span className="status-pill status-online">{config.locked?'Системный набор':'Из каталога '+brand}</span>
          <strong>{config.label}</strong>
          <p>{config.help}</p>
        </div>
        {config.locked?<p className="watch-references-readonly">
          Это фиксированный набор, который проверяется сервером при создании заказа и комплектации.
          Изменять его без согласованного изменения правил и базы нельзя.</p>:
        <p className="watch-references-readonly">Новые цвета кожаного ремешка указываются в комплектации
          часов выбранного бренда, а затем появляются здесь автоматически.</p>}
        <button type="button" className="primary" onClick={onOpenCatalog}>
          Перейти к товарам</button>
      </section>
    </div>
  </section>
}
