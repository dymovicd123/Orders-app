import {useEffect,useMemo,useState} from 'react'
import {WATCH_OPTIONS,type WatchBrand} from '../../../shared/client3/watch-domain'
import type {WatchOrderChoice} from './WatchOrderForm'
import '../../styles/w8-1-stock-overview.css'
import '../../styles/w8-2-stock-workspace.css'
import '../../styles/w13-stock-catalog-browse.css'
import '../../styles/w14-simple-stock-controls.css'
import '../../styles/w16-stock-source-attention.css'
import '../../styles/client3-watch-stock-browser.css'

type Source='office'|'showcase'
type Group={key:string;modelName:string;rows:WatchOrderChoice[]}
type ModelApi={ok:boolean;models?:WatchOrderChoice[];message?:string}
const amount=(n:number)=>(Number(n)||0).toLocaleString('ru-RU')
const sourceLabel=(source:Source)=>source==='office'?'Офис':'Витрина'
const stats=(row:WatchOrderChoice,source:Source)=>{
  const physical=Math.max(0,Number(source==='office'?row.officePhysical:row.showcasePhysical)||0)
  const reserved=Math.max(0,Number(source==='office'?row.officeReserved:row.showcaseReserved)||0)
  return {physical,reserved,free:physical-reserved}
}
const label=(values:readonly {value:string;label:string}[],code:string)=>values.find(x=>x.value===code)?.label||code
function characteristics(row:WatchOrderChoice) {
  return [label(WATCH_OPTIONS.genders,row.gender),label(WATCH_OPTIONS.movements,row.movement),
    label(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial),
    label(WATCH_OPTIONS.dialColors,row.dialColor),
    row.braceletColor?'Ремешок: '+row.braceletColor:''].filter(Boolean).join(' · ')
}
/**
 * Exact Main stock v13 master/detail information architecture and existing
 * Main CSS layers. Only variant detail labels map to watches (no fake sizes).
 * Read-only overview; mutations remain behind brand-scoped watch endpoints.
 */
export function WatchStockMainBrowse({brand,canCorrect,onCorrect,initialModelName=''}:{
  brand:WatchBrand;canCorrect:boolean;initialModelName?:string;
  onCorrect:(selection:{source:Source;watchProductId:number;watchVariantId:number;operation?:'arrival'|'count'})=>void
}){
  const [rows,setRows]=useState<WatchOrderChoice[]>([])
  const [source,setSource]=useState<Source>('office')
  const [search,setSearch]=useState(initialModelName)
  const [availableOnly,setAvailableOnly]=useState(false)
  const [selectedKey,setSelectedKey]=useState(initialModelName.trim().toLocaleLowerCase('ru'))
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refresh,setRefresh]=useState(0)
  useEffect(()=>{
    const abort=new AbortController()
    setLoading(true);setError('')
    void fetch('/api/client3/watches/models?brand='+encodeURIComponent(brand),{
      credentials:'include',cache:'no-store',signal:abort.signal,
    }).then(async response=>{
      const data=await response.json() as ModelApi
      if(!response.ok||!data.ok)throw new Error(data.message||'Остатки недоступны')
      if(!abort.signal.aborted)setRows(data.models||[])
    }).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка остатков')})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false)})
    return ()=>abort.abort()
  },[brand,refresh])
  const total=rows.reduce((a,row)=>{
    const s=stats(row,source)
    return {physical:a.physical+s.physical,reserved:a.reserved+s.reserved,free:a.free+s.free}
  },{physical:0,reserved:0,free:0})
  const groups=useMemo(()=>{
    const mapped=new Map<string,Group>()
    for(const row of rows){
      const key=row.modelName.trim().toLocaleLowerCase('ru')
      if(!mapped.has(key))mapped.set(key,{key,modelName:row.modelName,rows:[]})
      mapped.get(key)!.rows.push(row)
    }
    return Array.from(mapped.values()).sort((a,b)=>a.modelName.localeCompare(b.modelName,'ru'))
  },[rows])
  const filtered=groups.filter(group=>
    group.modelName.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))&&
    (!availableOnly||group.rows.some(row=>{
      const s=stats(row,source);return s.physical!==0||s.reserved!==0
    }))
  )
  const selected=filtered.find(g=>g.key===selectedKey)||filtered[0]
  const detail=selected?.rows.reduce((a,row)=>{
    const s=stats(row,source)
    return {physical:a.physical+s.physical,reserved:a.reserved+s.reserved,free:a.free+s.free}
  },{physical:0,reserved:0,free:0})
  // Main warehouse: group active watch variants by execution and dial color.
  // Keep zero-stock SKUs available under a separate disclosure for arrivals.
  const grouped=(list:WatchOrderChoice[])=>{
    const groups=new Map<string,{key:string;movement:string;bracelet:string;rows:WatchOrderChoice[]}>()
    for(const row of list){
      const key=JSON.stringify([row.movement,row.braceletMaterial])
      const group=groups.get(key)||{key,movement:row.movement,bracelet:row.braceletMaterial,rows:[]}
      group.rows.push(row);groups.set(key,group)
    }
    return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key,'ru'))
  }
  const available=selected?.rows.filter(row=>{
    const n=stats(row,source);return n.physical!==0||n.reserved!==0
  })||[]
  const empty=selected?.rows.filter(row=>{
    const n=stats(row,source);return n.physical===0&&n.reserved===0
  })||[]
  const stockTile=(row:WatchOrderChoice)=>{
    const n=stats(row,source)
    return <article key={row.watchVariantId} className={'stock-v13-size-card client3-stock-tile '+(n.free<0?'is-shortage':'')}>
      <div className="stock-v13-size-main">
        <span className="stock-v13-size-label"><strong>{label(WATCH_OPTIONS.genders,row.gender)}</strong></span>
        <small className="client3-stock-tile-detail">
          {row.braceletMaterial==='leather'?'Ремешок: '+(row.braceletColor||'—'):
            label(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial)}
        </small>
        <div className="stock-v13-size-values">
          <span><small>На месте</small><b>{amount(n.physical)}</b></span>
          <span><small>Резерв</small><b>{amount(n.reserved)}</b></span>
          <span className="stock-v13-size-free"><small>Свободно</small><b>{amount(n.free)}</b></span>
        </div>
      </div>
      {canCorrect&&<div className="client3-stock-tile-actions">
        <button type="button" className="secondary compact"
          onClick={()=>onCorrect({source,watchProductId:row.watchProductId,watchVariantId:row.watchVariantId,operation:'arrival'})}>Приход</button>
        <button type="button" className="secondary compact"
          onClick={()=>onCorrect({source,watchProductId:row.watchProductId,watchVariantId:row.watchVariantId,operation:'count'})}>Исправить количество</button>
      </div>}
    </article>
  }
  return <div className="inventory-overview-panel inventory-calm-stock stock-v13-page stock-v14-page client3-main-stock-v13" data-stock-browser="catalog-master-detail">
    <div className="inventory-calm-head warehouse-clean-stock-head stock-v14-heading">
      <div><h3>Остатки</h3><p>Выберите модель и комплектацию часов. Количество показано по одной точке.</p></div>
      <div className="stock-v14-location-tools">
        <div className="stock-v16-source-control"><strong className="stock-v16-source-label">Остатки какой точки?</strong>
          <div className="inventory-calm-source stock-v16-source-switch" role="group" aria-label="Точка остатков">
            {(['office','showcase'] as const).map(x=><button key={x} type="button"
              aria-pressed={source===x} className={source===x?'is-active':''}
              onClick={()=>setSource(x)}>{source===x?'✓ ':''}{sourceLabel(x)}</button>)}
          </div>
        </div>
        <button className="secondary compact stock-v14-refresh" type="button" disabled={loading}
          onClick={()=>setRefresh(v=>v+1)}>↻ Обновить</button>
      </div>
    </div>
    <div className="stock-v14-summary-label"><strong>{sourceLabel(source)}</strong>
      <span>Вся точка · поиск и выбор модели не меняют эти числа</span></div>
    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">
      <div className="is-primary"><span>Свободно</span><strong>{amount(total.free)}</strong><small>можно использовать сейчас</small></div>
      <div><span>На месте</span><strong>{amount(total.physical)}</strong><small>фактическое наличие в точке</small></div>
      <div><span>В заказах</span><strong>{amount(total.reserved)}</strong><small>уже отложено клиентам</small></div>
      <details><summary>Что означают эти числа?</summary>
        <p><b>На месте</b> включает свободные часы и ещё не отправленные заказы.
          <b> В заказах</b> — подтверждённый резерв. Свободно = на месте минус резерв.</p>
      </details>
    </div>
    {error&&<p className="client3-stock-error" role="alert">{error}
      <button type="button" onClick={()=>setRefresh(v=>v+1)}>Повторить</button></p>}
    {loading&&<p role="status">Загружаем остатки…</p>}
    {!loading&&!error&&<div className="stock-v13-browse catalog-master-detail">
      <aside className="stock-v13-master" aria-label="Каталог моделей с остатками">
        <div className="stock-v13-master-head"><strong>{filtered.length} моделей</strong>
          <small>Каталог выбранного бренда</small></div>
        <div className="stock-v14-master-controls">
          <div className="stock-v14-model-search"><input value={search} placeholder="Найти модель…"
            aria-label="Поиск модели по названию" onChange={e=>setSearch(e.target.value)}/>
            {search&&<button type="button" onClick={()=>setSearch('')} aria-label="Очистить поиск">×</button>}
          </div>
          <div className="stock-v14-simple-filters" role="group" aria-label="Какие модели показывать">
            <button type="button" className={availableOnly?'is-active':''} aria-pressed={availableOnly}
              onClick={()=>setAvailableOnly(true)}>С остатком</button>
            <button type="button" className={!availableOnly?'is-active':''} aria-pressed={!availableOnly}
              onClick={()=>setAvailableOnly(false)}>Все модели</button>
          </div>
        </div>
        <div className="stock-v13-master-list" role="list">
          {filtered.map(group=>{
            const t=group.rows.reduce((a,row)=>{
              const s=stats(row,source)
              return {physical:a.physical+s.physical,reserved:a.reserved+s.reserved,free:a.free+s.free}
            },{physical:0,reserved:0,free:0})
            const current=selected?.key===group.key
            return <button type="button" role="listitem" key={group.key}
              className={'stock-v13-master-item '+(current?'is-selected':'')+(t.free<0?' has-shortage':'')}
              aria-current={current?'true':undefined} onClick={()=>setSelectedKey(group.key)}>
              <span className="stock-v13-master-identity"><strong>{group.modelName}</strong>
                <small>{group.rows.length} комплектаций</small></span>
              <span className="stock-v13-master-quantity"><b>{amount(t.free)}</b><small>свободно</small></span>
              <span className="stock-v13-master-subtotals">На месте {amount(t.physical)} · Резерв {amount(t.reserved)}</span>
            </button>
          })}
          {!filtered.length&&<div className="stock-v13-empty">Ничего не найдено. Измените поиск или фильтр.</div>}
        </div>
      </aside>
      <div className="stock-v13-detail-pane">
        {selected?<section className="stock-v13-detail" aria-label={'Остатки модели '+selected.modelName}>
          <header className="stock-v13-detail-header">
            <div className="stock-v13-title"><span>Остатки · {sourceLabel(source)}</span>
              <h3>{selected.modelName}</h3><p>{selected.rows.length} комплектаций часов</p></div>
            <div className="stock-v13-product-balances" aria-label="Итоги модели">
              <div><span>На месте</span><strong>{amount(detail?.physical||0)}</strong></div>
              <div><span>Резерв</span><strong>{amount(detail?.reserved||0)}</strong></div>
              <div className={(detail?.free||0)<0?'is-shortage':'is-free'}><span>Свободно</span>
                <strong>{amount(detail?.free||0)}</strong></div>
            </div>
          </header>
          <div className="stock-v13-execution-list client3-stock-execution-list" data-main-stock-groups="true">
            {grouped(available).map(group=><section className="stock-v13-execution" key={group.key}>
              <div className="stock-v13-execution-title">
                <strong>{label(WATCH_OPTIONS.movements,group.movement)} · {label(WATCH_OPTIONS.braceletMaterials,group.bracelet)}</strong>
                <span>{group.rows.length} комплектаций</span>
              </div>
              <div className="stock-v13-colors">
                {Array.from(new Set(group.rows.map(row=>row.dialColor))).sort((a,b)=>a.localeCompare(b,'ru'))
                  .map(color=><section className="stock-v13-color" key={color}>
                    <div className="stock-v13-color-head">
                      <strong>{label(WATCH_OPTIONS.dialColors,color)}</strong><small>Циферблат</small>
                    </div>
                    <div className="stock-v13-size-grid">{group.rows.filter(row=>row.dialColor===color).map(stockTile)}</div>
                  </section>)}
              </div>
            </section>)}
            {!available.length&&<div className="stock-v13-no-active">
              <strong>Нет часов с остатком или резервом</strong>
              <span>Нулевые комплектации доступны ниже для оформления прихода.</span>
            </div>}
          </div>
          {empty.length>0&&<details className="stock-v13-zero-disclosure">
            <summary>Без остатка и резерва <strong>{empty.length}</strong><span>Показать комплектации</span></summary>
            <div className="client3-stock-zero-content">
              {grouped(empty).map(group=><section key={group.key}>
                <strong>{label(WATCH_OPTIONS.movements,group.movement)} · {label(WATCH_OPTIONS.braceletMaterials,group.bracelet)}</strong>
                <div className="stock-v13-size-grid">{group.rows.map(stockTile)}</div>
              </section>)}
            </div>
          </details>}
        </section>:<div className="stock-v13-empty">Выберите модель слева.</div>}
      </div>
    </div>}
  </div>
}
