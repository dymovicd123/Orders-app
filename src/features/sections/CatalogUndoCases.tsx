import { useEffect, useRef, useState } from 'react'
import '../../styles/reference-undo-cases.css'

type RecentMerge={
 id:number;sourceId:number;targetId:number;productName:string;
 sourceColor:string|null;targetColor:string|null;material:string|null;length:string|null;
 size:string|null;createdAt:string;createdBy:string|null
}
type Location={
 location:string;locationLabel:string;
 physical:{source:number|null;keeper:number|null;combined:number|null};
 reserved:{source:number|null;keeper:number|null;combined:number|null};
 originallyMerged:{physical:number;reserved:number}|null;
 newerMovements:number;newerStockChecks:number;requiresFreshPhysicalCheck:boolean;
 warning:string
}
type Task={
 id:string;title:string;why:string;action:string;
 scope:string;records:number;needsFullHistory:boolean;automatedWriteAllowed:false
}
type Workplan={
 ok:boolean;consolidationId:number;sourceId:number;keeperId:number;
 recommendedPath:string;places:Location[];tasks:Task[];
 caseHasUninspectedRows:boolean;canAutomaticallyUndo:false;
 canMarkResolvedFromPreview:false;noChangesApplied:true;explanation:string
}
type Report={
 ok:boolean;consolidationId:number;sourceId:number;keeperId:number;
 caseKind:string;mergedAt:string;noChangesApplied:boolean;
 originalBlockers:Array<{code:string;message:string}>;
 summary:{
  originalReservationLinks:number;changedOrMissingReservationLinks:number;
  postMergeOrderItems:number;postMergeMovements:number;
  postMergeStockChecks:number;incompleteEvidence:boolean;
 };
}
type Section='reservations'|'orders'|'movements'|'checks'
type Evidence={
 id:number;reservation_id?:number;order_id?:number;order_item_id?:number;
 inventory_source?:string|null;source_type?:string|null;
 quantity?:number|null;now_quantity?:number|null;
 variant_id?:number|null;quantity_delta?:number|null;counted_quantity?:number|null;
 reference_type?:string|null;created_at?:string|null;checked_at?:string|null;
 shipping_status?:string|null;order_status?:string|null;
 has_exchange_return?:number;time_state?:string;
 situation?:{kind:string;label:string;risk:string};
 nextStep:string
}
type EvidencePage={
 ok:boolean;consolidationId:number;section:Section;pageSize:number;
 totalCount:number;shownCount:number;hasMore:boolean;nextCursor:number|null;
 rows:Evidence[];noChangesApplied:true
}
type Props={
 apiFetch:(input:string,init?:RequestInit)=>Promise<Response>;
 isAdmin:boolean
}
const sections:Array<{id:Section;label:string;count:keyof Report['summary']}>= [
 {id:'reservations',label:'Перенесённые резервы',count:'originalReservationLinks'},
 {id:'orders',label:'Изменённые заказы',count:'postMergeOrderItems'},
 {id:'movements',label:'Движения склада',count:'postMergeMovements'},
 {id:'checks',label:'Ревизии',count:'postMergeStockChecks'},
]
const placeName=(place:string|null|undefined)=>
 place==='warehouse'?'Склад':place==='boutique'?'Бутик':place||'Не указано'
const qty=(n:number|null|undefined)=>typeof n==='number'&&Number.isFinite(n)
 ? n.toLocaleString('ru-RU')+' шт.':'Требуется проверка'
const date=(value:string|null|undefined)=>{
 if(!value)return 'Дата неизвестна'
 const t=Date.parse(value)
 return Number.isFinite(t)?new Date(t).toLocaleString('ru-RU'):'Дата неизвестна'
}
function errorMessage(e:unknown){
 return e instanceof Error?e.message:'Не удалось получить сведения. Повторите попытку.'
}
async function jsonGet<T>(apiFetch:Props['apiFetch'],path:string){
 const response=await apiFetch(path,{cache:'no-store'})
 const data=await response.json() as T & {ok?:boolean;message?:string}
 if(!response.ok||data.ok!==true)throw new Error(data.message||'Сведения временно недоступны.')
 return data
}
function recordTitle(section:Section,r:Evidence){
 if(section==='reservations')return 'Резерв заказа '+(r.order_id??'—')+' · '+placeName(r.inventory_source)
 if(section==='orders')return 'Заказ '+(r.order_id??'—')+' · '+placeName(r.source_type)
 if(section==='movements')return 'Операция со складом · '+placeName(r.inventory_source)
 return 'Проверка остатка · '+placeName(r.inventory_source)
}
function recordSubtitle(section:Section,r:Evidence){
 if(section==='reservations')return (r.situation?.label||'Проверить связь с заказом')+' · '+qty(r.quantity)
 if(section==='orders')return (r.shipping_status==='sent'?'Отправлено':r.has_exchange_return?'Связано с возвратом или обменом':'Проверить заказ')
  +' · '+qty(r.quantity)
 if(section==='movements')return 'Изменение: '+(typeof r.quantity_delta==='number'&&r.quantity_delta>0?'+':'')+
  (r.quantity_delta??'неизвестно')+' шт. · '+date(r.created_at)
 return 'Посчитано '+qty(r.counted_quantity)+' · '+date(r.checked_at)
}

export function CatalogUndoCases({apiFetch,isAdmin}:Props){
 const [recent,setRecent]=useState<RecentMerge[]>([])
 const [recentBusy,setRecentBusy]=useState(false)
 const [recentError,setRecentError]=useState('')
 const [selectedId,setSelectedId]=useState<number>(0)
 const [manualId,setManualId]=useState('')
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [report,setReport]=useState<Report|null>(null)
 const [workplan,setWorkplan]=useState<Workplan|null>(null)
 const [section,setSection]=useState<Section>('reservations')
 const [page,setPage]=useState<EvidencePage|null>(null)
 const [detailBusy,setDetailBusy]=useState(false)
 const [detailError,setDetailError]=useState('')
 const latestLoad=useRef(0)
 const latestDetails=useRef(0)

 useEffect(()=>{
  if(!isAdmin)return
  let alive=true
  setRecentBusy(true)
  void jsonGet<{items:RecentMerge[]}>(apiFetch,'/api/catalog/variants/consolidation-history')
   .then(x=>{if(alive)setRecent(x.items||[])})
   .catch(e=>{if(alive)setRecentError(errorMessage(e))})
   .finally(()=>{if(alive)setRecentBusy(false)})
  return()=>{alive=false;latestLoad.current++;latestDetails.current++}
 },[apiFetch,isAdmin])

 function selectCase(id:number){
  latestLoad.current++;latestDetails.current++
  setSelectedId(id);setError('');setReport(null);setWorkplan(null)
  setSection('reservations');setPage(null);setDetailError('')
  setLoading(false);setDetailBusy(false)
 }
 async function inspect(){
  if(!isAdmin||!Number.isSafeInteger(selectedId)||selectedId<=0||loading)return
  const request=++latestLoad.current
  latestDetails.current++
  setError('');setReport(null);setWorkplan(null);setPage(null);setDetailError('')
  setLoading(true)
  try{
   const q='?consolidationId='+encodeURIComponent(String(selectedId))
   const [r,p]=await Promise.all([
    jsonGet<Report>(apiFetch,'/api/catalog/variants/consolidation-undo-case-review'+q),
    jsonGet<Workplan>(apiFetch,'/api/catalog/variants/consolidation-undo-case-workplan'+q)
   ])
   if(request!==latestLoad.current)return
   if(r.consolidationId!==selectedId||p.consolidationId!==selectedId
      ||r.sourceId!==p.sourceId||r.keeperId!==p.keeperId)
     throw new Error('Получены несовпадающие сведения. Повторите проверку.')
   setReport(r);setWorkplan(p)
  }catch(e){if(request===latestLoad.current)setError(errorMessage(e))}
  finally{if(request===latestLoad.current)setLoading(false)}
 }
 async function loadSection(which:Section,cursor=0,append=false){
  if(!report||detailBusy&&append)return
  const request=++latestDetails.current
  const sourceCase=report.consolidationId
  setDetailBusy(true);setDetailError('')
  if(!append){setSection(which);setPage(null)}
  try{
   const qs=new URLSearchParams({
    consolidationId:String(sourceCase),section:which,afterId:String(cursor),limit:'20'
   })
   const result=await jsonGet<EvidencePage>(apiFetch,
    '/api/catalog/variants/consolidation-undo-case-details?'+qs.toString())
   if(request!==latestDetails.current)return
   if(result.consolidationId!==sourceCase||result.section!==which)
    throw new Error('История изменилась. Обновите выбранный случай.')
   setPage(prev=>append&&prev?.section===which&&prev.consolidationId===sourceCase
     ?{...result,rows:[...prev.rows,...result.rows.filter(row=>!prev.rows.some(existing=>existing.id===row.id))]}
     :result)
  }catch(e){if(request===latestDetails.current)setDetailError(errorMessage(e))}
  finally{if(request===latestDetails.current)setDetailBusy(false)}
 }
 const chosen=recent.find(r=>r.id===selectedId)
 if(!isAdmin)return <p className="reference-undo-restricted">Разбор сложных объединений доступен администратору.</p>
 return <section className="reference-undo-cases" aria-label="Разбор прежнего объединения товаров">
  <header className="reference-undo-head">
   <div>
    <h3>Разобрать прежнее объединение</h3>
    <p>Если после объединения были продажи, возвраты или движения склада, проверьте последствия перед исправлением. Работа сотрудников при просмотре не блокируется.</p>
   </div>
   <span className="reference-undo-readonly">Только проверка</span>
  </header>
  <div className="reference-undo-picker">
   <label>
    <span>Выберите объединение товаров</span>
    <select value={recent.some(x=>x.id===selectedId)?selectedId:0}
      onChange={e=>{const n=Number(e.target.value);setManualId('');selectCase(n)}}
      disabled={recentBusy||loading}>
     <option value={0}>{recentBusy?'Загружаю историю…':'Выберите из последних объединений'}</option>
     {recent.map(x=><option key={x.id} value={x.id}>
      {x.productName} · {x.sourceColor||'Без цвета'} → {x.targetColor||'Без цвета'} · {date(x.createdAt)}
     </option>)}
    </select>
   </label>
   <button className="primary" type="button" disabled={loading||selectedId<=0}
     onClick={()=>void inspect()}>{loading?'Проверяю…':'Проверить объединение'}</button>
  </div>
  {recentError?<p role="alert" className="reference-undo-error">{recentError}</p>:null}
  {recent.length===0&&!recentBusy&&!recentError?
   <p className="reference-undo-note">В последних записях нет объединений. Можно указать номер более старого объединения.</p>:null}
  <details className="reference-undo-older">
   <summary>Нужного объединения нет в списке?</summary>
   <label>Номер из истории объединений
    <input type="number" min={1} step={1} inputMode="numeric"
     placeholder="Номер объединения" value={manualId}
     onChange={e=>{setManualId(e.target.value);selectCase(Number(e.target.value))}}/>
   </label>
  </details>
  {chosen?<p className="reference-undo-chosen">
   <strong>{chosen.productName}</strong> · {chosen.material||'Материал не указан'} · {chosen.size||'Без размера'}
   <span>Объединено: {date(chosen.createdAt)}</span>
  </p>:null}
  {error?<p role="alert" className="reference-undo-error">{error}</p>:null}
  {report&&workplan?<>
   <div className="reference-undo-result" role="status">
    <strong>Автоматически отменять нельзя — сначала проверьте связанные операции</strong>
    <p>Это план восстановления порядка в учёте. Исторические заказы и суммы оплаты не изменяются.</p>
   </div>
   <div className="reference-undo-metrics" aria-label="Связанные операции">
    <div><span>Перенесённые резервы</span><strong>{report.summary.originalReservationLinks}</strong></div>
    <div><span>Заказы после объединения</span><strong>{report.summary.postMergeOrderItems}</strong></div>
    <div><span>Движения склада</span><strong>{report.summary.postMergeMovements}</strong></div>
    <div><span>Ревизии</span><strong>{report.summary.postMergeStockChecks}</strong></div>
   </div>
   {report.summary.incompleteEvidence||workplan.caseHasUninspectedRows?
    <p className="reference-undo-note">Есть длинные списки или неполные сведения. Откройте все нужные страницы истории ниже. Между проверками данные могут измениться.</p>:null}
   {report.originalBlockers.length>0?<details className="reference-undo-blockers">
    <summary>Что мешает простой отмене · {report.originalBlockers.length}</summary>
    <ul>{report.originalBlockers.map((b,i)=><li key={b.code+':'+i}>{b.message}</li>)}</ul>
   </details>:null}
   <section className="reference-undo-locations" aria-label="Остатки по точкам">
    <h4>Текущие остатки по местам хранения</h4>
    <div className="reference-undo-location-grid">
     {workplan.places.map(p=><div className="reference-undo-location" key={p.location}>
      <div className="reference-undo-location-top">
       <strong>{p.locationLabel}</strong>
       <span>{p.requiresFreshPhysicalCheck?'Нужна сверка':'Проверить перед исправлением'}</span>
      </div>
      <div className="reference-undo-location-numbers">
       <div><small>Общий остаток</small><strong>{qty(p.physical.combined)}</strong></div>
       <div><small>В резерве</small><strong>{qty(p.reserved.combined)}</strong></div>
      </div>
      <p>Исходный вариант: {qty(p.physical.source)}, основной: {qty(p.physical.keeper)}</p>
      <p>Движений после объединения: {p.newerMovements} · ревизий: {p.newerStockChecks}</p>
      <small>{p.warning}</small>
     </div>)}
     {!workplan.places.length?<p className="reference-undo-note">Складские строки не обнаружены. Необходимо проверить исходную историю.</p>:null}
    </div>
   </section>
   <section className="reference-undo-plan" aria-label="Последовательность действий">
    <div className="reference-undo-section-head">
     <h4>Что делать дальше</h4>
     <span>По результатам проверки</span>
    </div>
    {workplan.tasks.length? <ol>
     {workplan.tasks.map(t=><li key={t.id}>
      <strong>{t.title}</strong>
      <p>{t.why}</p>
      <p>{t.action}</p>
      {t.needsFullHistory?<small>Нужно изучить все связанные записи в истории ниже.</small>:null}
     </li>)}
    </ol>:<p>Дополнительные операции не найдены. Обновите проверку обычной отмены, прежде чем принимать решение.</p>}
    <div className="reference-undo-navigation">
     <a className="secondary compact" href="#orders">Перейти к заказам, возвратам и обменам</a>
     <a className="secondary compact" href="#inventory">Перейти к складу и ревизии</a>
    </div>
   </section>
   <section className="reference-undo-evidence" aria-label="Связанная история">
    <div className="reference-undo-section-head">
     <h4>Связанная история</h4>
     <p>Просмотрите нужные записи. Ничего не изменится, пока вы работаете здесь.</p>
    </div>
    <div className="reference-undo-tabs" role="group" aria-label="Тип связанных записей">
     {sections.map(tab=><button type="button" key={tab.id}
      className={section===tab.id?'secondary compact is-active':'secondary compact'}
      aria-pressed={section===tab.id}
      disabled={detailBusy}
      onClick={()=>void loadSection(tab.id)}>
      {tab.label} ({report.summary[tab.count]})
     </button>)}
    </div>
    {page===null&&!detailBusy?
     <button type="button" className="secondary compact"
      onClick={()=>void loadSection(section)}>Показать записи</button>:null}
    {detailBusy?<p role="status">Загружаю записи…</p>:null}
    {detailError?<p role="alert" className="reference-undo-error">{detailError}</p>:null}
    {page&&page.section===section?<>
     <p className="reference-undo-page-meta">Показано {page.rows.length} из {page.totalCount} записей</p>
     <div className="reference-undo-records">
      {page.rows.map((r,i)=><article className="reference-undo-record" key={section+':'+r.id+':'+i}>
       <div><strong>{recordTitle(section,r)}</strong>
        <span>{recordSubtitle(section,r)}</span></div>
       <p>{r.nextStep}</p>
      </article>)}
      {page.rows.length===0?<p className="reference-undo-note">Записей этого типа не найдено.</p>:null}
     </div>
     {page.hasMore&&page.nextCursor!==null?
      <button className="secondary compact" type="button" disabled={detailBusy}
       onClick={()=>void loadSection(section,page.nextCursor!,true)}>
       {detailBusy?'Загружаю…':'Показать ещё 20'}
      </button>:null}
    </>:null}
   </section>
   <div className="reference-undo-footer">
    <strong>После любых исправлений повторите проверку.</strong>
    <span>Просмотр истории не подтверждает безопасность отмены и не блокирует работу сотрудников.</span>
    <button className="secondary compact" type="button" disabled={loading}
     onClick={()=>void inspect()}>Обновить данные</button>
   </div>
  </>:null}
 </section>
}
