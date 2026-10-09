import { useEffect, useState } from 'react'
import '../../styles/reference-merge-workspace.css'

type Value = { id: number; value: string; isActive: boolean }
type MergeHistoryItem={id:number;kind:string;source:string;target:string;affected:number;actor:string;createdAt:string;sourceId:number;targetId:number}
type Counts = { current:number; older:number }
type CharacteristicSummary = {
  variants:number;activeVariants:number;physical:number;reserved:number;
  currentOrderLines:number;olderOrderLines:number;activeUnsentLines:number;
  activeReservations:number;reservedUnits:number;activeWorkshopTasks:number;
}
type CatalogImpact = {
  source:CharacteristicSummary;target:CharacteristicSummary;
  sourceExecutions:number;
  byLocation:{side:'source'|'target';location:string;physical:number;reserved:number}[];
  sampleVariants:{id:number;side:'source'|'target';productName:string;category:string;
    color:string;material:string;length:string;size:string;active:boolean;
    physical:number;reserved:number}[];
  skuPairs:{sourceVariantId:number;targetVariantId:number;productName:string;description:string}[];
  skuPairsLimited:boolean;canReviewReferenceCleanup:boolean;
  sampleTruncated:boolean;indistinguishable:boolean;warnings:string[];
  status:'requires_catalog_review'|'unused_or_historical';canAutomaticallyConsolidate:boolean;
}
type PairPreview = {
  ok:boolean;source:{id:number;color:string;size:string;active:boolean};
  target:{id:number;color:string;size:string;active:boolean};
  stockBreakdown:{location:string;sourcePhysical:number;targetPhysical:number;combinedPhysical:number;sourceReserved:number;targetReserved:number}[];
  reservationCount:number;transferQuantity:number;stateToken:string;
  blockers:string[];canConsolidate:boolean;explanation:string;
}
type PairReview = {sourceVariantId:number;targetVariantId:number;preview:PairPreview}
type Impact = {
  ok:boolean;
  kind:string;
  source:{id:number;value:string};
  target:{id:number;value:string};
  month:{from:string;toExclusive:string;label:string};
  orders:Counts;
  ordersCovered:boolean;
  finance:{payments:Counts;financialEvents:Counts;cashEntries:Counts;returns:Counts;exchanges:Counts};
  activeCatalogVariants:number;
  catalogImpact?:CatalogImpact|null;
  canApply:boolean;
  stateToken:string;
  paymentSafety?:{blockers:string[];affectedOrders:number;cashRegisterRecords:number}|null;
  explanation:string;
}
const dictionaries = [
  {kind:'paymentMethods',label:'Способы оплаты'},
  {kind:'deliveryTypes',label:'Доставка'},
  {kind:'cities',label:'Города'},
  {kind:'returnReasons',label:'Причины возврата'},
  {kind:'writeoffReasons',label:'Причины списания'},
  {kind:'colors',label:'Цвета'},
  {kind:'materials',label:'Материалы'},
  {kind:'lengths',label:'Длины'},
  {kind:'sizes',label:'Размеры'},
  {kind:'childAges',label:'Детские размеры и возраст'},
] as const

export function ReferenceMergeWorkspace({
  apiFetch,isAdmin,onMerged,initialKind='paymentMethods',
}: {
  apiFetch:(input:string,init?:RequestInit)=>Promise<Response>;
  isAdmin:boolean;
  onMerged:()=>Promise<void>;
  initialKind?:string;
}) {
  const [kind,setKind]=useState(() => dictionaries.some(x => x.kind === initialKind) ? initialKind : 'paymentMethods')
  useEffect(() => {
    if (dictionaries.some(x => x.kind === initialKind)) setKind(initialKind)
  }, [initialKind])
  const [values,setValues]=useState<Value[]>([])
  const [loading,setLoading]=useState(false)
  const [sourceId,setSourceId]=useState(0)
  const [targetId,setTargetId]=useState(0)
  const [impact,setImpact]=useState<Impact|null>(null)
  const [checking,setChecking]=useState(false)
  const [saving,setSaving]=useState(false)
  const [notice,setNotice]=useState('')
  const [error,setError]=useState('')
  const [history,setHistory]=useState<MergeHistoryItem[]|null>(null)
  const [historyBusy,setHistoryBusy]=useState(false)
  const [pairReview,setPairReview]=useState<PairReview|null>(null)
  const [pairBusy,setPairBusy]=useState(false)
  const [cleanup,setCleanup]=useState<{safeToHideSource:boolean;explanation:string}|null>(null)
  const [historyError,setHistoryError]=useState('')
  useEffect(()=>{
    let valid=true
    setValues([]);setSourceId(0);setTargetId(0);setImpact(null);setError('')
    if (!isAdmin) return
    setLoading(true)
    void apiFetch('/api/reference-values?kind='+encodeURIComponent(kind))
      .then(async res=>{
        const data=await res.json() as {ok?:boolean;items?:Value[];message?:string}
        if (!res.ok||!data.ok) throw new Error(data.message||'Не удалось загрузить значения.')
        if (valid) setValues((data.items||[]).filter(v=>v.isActive))
      })
      .catch(err=>{if(valid)setError(err instanceof Error?err.message:'Не удалось загрузить справочник.')})
      .finally(()=>{if(valid)setLoading(false)})
    return ()=>{valid=false}
  },[kind,isAdmin,apiFetch])

  const chooseSource=(id:number)=>{setSourceId(id);setImpact(null);setPairReview(null);setCleanup(null);setError('');setNotice('')}
  const chooseTarget=(id:number)=>{setTargetId(id);setImpact(null);setPairReview(null);setCleanup(null);setError('');setNotice('')}
  const canInspect=sourceId>0&&targetId>0&&sourceId!==targetId&&!loading&&!checking
  const source=values.find(v=>v.id===sourceId)
  const target=values.find(v=>v.id===targetId)
  async function inspect(){
    if(!canInspect)return
    setChecking(true);setError('');setImpact(null);setPairReview(null);setCleanup(null)
    try{
      const query=new URLSearchParams({sourceId:String(sourceId),targetId:String(targetId)})
      const res=await apiFetch('/api/reference-values/merge-preview?'+query.toString())
      const data=await res.json() as Impact & {message?:string}
      if(!res.ok||!data.ok)throw new Error(data.message||'Не удалось проверить связанные записи.')
      setImpact(data)
    }catch(err){setError(err instanceof Error?err.message:'Не удалось проверить изменения.')}
    finally{setChecking(false)}
  }


  async function inspectSkuPair(sourceVariantId:number,targetVariantId:number) {
    if (pairBusy || saving) return
    setPairBusy(true);setPairReview(null);setError('')
    try {
      const query=new URLSearchParams({sourceId:String(sourceVariantId),targetId:String(targetVariantId)})
      const response=await apiFetch('/api/catalog/variants/consolidation-preview?'+query.toString())
      const body=await response.json() as PairPreview & {message?:string}
      if(!response.ok||!body.ok)throw new Error(body.message||'Не удалось проверить варианты товара.')
      setPairReview({sourceVariantId,targetVariantId,preview:body})
    } catch(e) { setError(e instanceof Error?e.message:'Не удалось проверить варианты.') }
    finally {setPairBusy(false)}
  }

  async function applySkuPair() {
    if(!pairReview?.preview.canConsolidate || !pairReview.preview.stateToken || pairBusy || saving) return
    const {sourceVariantId,targetVariantId,preview}=pairReview
    const stillShown=impact?.catalogImpact?.skuPairs.some(p=>
      p.sourceVariantId===sourceVariantId && p.targetVariantId===targetVariantId)
    if(!stillShown) {setError('Список изменился. Повторите проверку характеристик.');return}
    if(!window.confirm(
      'Объединить выбранные варианты товара? Склад и бутик сохранят свои количества, '
      +'действующие резервы будут согласованы с заказами. Исторические документы останутся без изменений.'
    ))return
    setPairBusy(true);setError('')
    try {
      const response=await apiFetch('/api/catalog/variants/consolidate-unused',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sourceId:sourceVariantId,targetId:targetVariantId,expectedToken:preview.stateToken}),
      })
      const result=await response.json() as {ok?:boolean;message?:string;transferredQuantity?:number}
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось объединить варианты.')
      setPairReview(null)
      setNotice('Варианты объединены. Остатки перенесены внутри каждого места хранения; исторические заказы сохранены. Другие варианты пока не менялись.')
      try { await onMerged() } catch {
        setNotice('Варианты объединены, но обновление списков не удалось. Обновите страницу для просмотра результата.')
      }
      await inspect()
    }catch(e) {
      setError(e instanceof Error?e.message:'Не удалось объединить варианты.')
    }finally {setPairBusy(false)}
  }


  async function inspectReferenceCleanup() {
    if(!impact?.catalogImpact?.canReviewReferenceCleanup || pairBusy || saving) return
    setPairBusy(true);setCleanup(null);setError('')
    try {
      const query=new URLSearchParams({sourceId:String(impact.source.id),targetId:String(impact.target.id)})
      const response=await apiFetch('/api/reference-values/consolidation-preview?'+query.toString())
      const result=await response.json() as {ok?:boolean;safeToHideSource:boolean;explanation:string;message?:string}
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось проверить связи названия.')
      setCleanup({safeToHideSource:result.safeToHideSource,explanation:result.explanation})
    }catch(e){setError(e instanceof Error?e.message:'Не удалось проверить название.')}
    finally{setPairBusy(false)}
  }

  async function hideReferenceAlias() {
    if(!cleanup?.safeToHideSource || !impact?.catalogImpact?.canReviewReferenceCleanup || pairBusy || saving) return
    const oldId=impact.source.id, keptId=impact.target.id
    if(!window.confirm('Убрать лишнее название из новых списков выбора? Исторические товары и заказы останутся без изменений.'))return
    setPairBusy(true);setError('')
    try {
      const response=await apiFetch('/api/reference-values/hide-unused-duplicate',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sourceId:oldId,targetId:keptId}),
      })
      const result=await response.json() as {ok?:boolean;message?:string}
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось убрать лишнее название.')
      setValues(old=>old.filter(v=>v.id!==oldId))
      setSourceId(0);setTargetId(0);setImpact(null);setCleanup(null);setPairReview(null)
      setNotice('Лишнее название отключено для новых операций. Старые заказы и варианты не удалены.')
      try{await onMerged()}catch{
        setNotice('Лишнее название отключено. Если список не обновился, перезагрузите страницу.')
      }
    }catch(e){setError(e instanceof Error?e.message:'Не удалось обновить справочник.')}
    finally{setPairBusy(false)}
  }

  async function loadHistory(){
    if (!isAdmin || historyBusy) return
    setHistoryBusy(true);setHistoryError('')
    try {
      const res=await apiFetch('/api/reference-values/merge-history')
      const body=await res.json() as {ok?:boolean;items?:MergeHistoryItem[];message?:string}
      if (!res.ok||!body.ok) throw new Error(body.message||'Не удалось загрузить историю.')
      setHistory(body.items||[])
    }catch(err){setHistoryError(err instanceof Error?err.message:'Не удалось загрузить историю.')}
    finally{setHistoryBusy(false)}
  }

  async function apply(){
    if (!impact?.canApply || !impact.stateToken || saving) return
    const confirmed=window.confirm(
      'Объединить «'+impact.source.value+'» с «'+impact.target.value+'»? '
      +'Будут обновлены '+impact.orders.current+' заказов за '+impact.month.label+'. '
      +'Заказы предыдущих месяцев и история останутся без изменений.'
    )
    if (!confirmed)return
    setSaving(true);setError('')
    try{
      const response=await apiFetch('/api/reference-values/merge',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sourceId:impact.source.id,targetId:impact.target.id,expectedToken:impact.stateToken}),
      })
      const result=await response.json() as {ok?:boolean;message?:string;ordersUpdated?:number}
      if (!response.ok||!result.ok)throw new Error(result.message||'Не удалось сохранить объединение.')
      await onMerged()
      setValues(old=>old.filter(v=>v.id!==impact.source.id))
      setSourceId(0);setTargetId(0);setImpact(null)
      setNotice('Готово. Обновлено заказов: '+Number(result.ordersUpdated||0)+'. Старые заказы сохранены.')
      if (history!==null) void loadHistory()
    }catch(err){setError(err instanceof Error?err.message:'Не удалось сохранить изменения.')}
    finally{setSaving(false)}
  }

  return <section className="reference-merge-workspace" aria-label="Объединить значения справочников">
    <div className="reference-merge-heading">
      <div>
        <span className="reference-merge-eyebrow">Порядок в справочниках</span>
        <h3>Объединить значения</h3>
        <p>Вы сами решаете, какое название оставить. Остальное система проверит перед сохранением.</p>
      </div>
    </div>
    {notice?<p className="reference-merge-success" role="status">{notice}</p>:null}
    {!isAdmin ? (
      <p className="reference-merge-notice">Для объединения или удаления значений войдите как администратор.</p>
    ) : (
      <>
        <label className="reference-merge-kind">
          <span>Какой список приводим в порядок?</span>
          <select value={kind} onChange={e=>setKind(e.target.value)} disabled={loading||checking||pairBusy}>
            {dictionaries.map(x=><option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </label>
        <div className="reference-merge-pair">
          <label className="reference-merge-choice">
            <span className="reference-merge-step">1. Убираем лишнее название</span>
            <select value={sourceId} onChange={e=>chooseSource(Number(e.target.value))} disabled={loading||checking||pairBusy}>
              <option value={0}>Выберите значение</option>
              {values.filter(v=>v.id!==targetId).map(v=><option key={v.id} value={v.id}>{v.value}</option>)}
            </select>
            <small>Это название исчезнет из дальнейшего выбора после объединения.</small>
          </label>
          <span className="reference-merge-arrow" aria-hidden="true">→</span>
          <label className="reference-merge-choice reference-merge-primary">
            <span className="reference-merge-step">2. Оставляем правильное название</span>
            <select value={targetId} onChange={e=>chooseTarget(Number(e.target.value))} disabled={loading||checking||pairBusy}>
              <option value={0}>Выберите значение</option>
              {values.filter(v=>v.id!==sourceId).map(v=><option key={v.id} value={v.id}>{v.value}</option>)}
            </select>
            <small>Его будут использовать сотрудники в новых заказах.</small>
          </label>
        </div>
        <div className="reference-merge-action-row">
          <button type="button" className="primary" disabled={!canInspect||pairBusy} onClick={()=>void inspect()}>
            {checking?'Проверяю записи…':'Посмотреть, что изменится'}
          </button>
          {loading?<span>Загружаю значения…</span>:!values.length?<span>В этом списке нет действующих значений.</span>:null}
        </div>
        {sourceId&&targetId&&sourceId===targetId? <p className="reference-merge-notice">Выберите разные значения.</p>:null}
        {error?<p className="reference-merge-error" role="alert">{error}</p>:null}
        <div className="reference-merge-history">
          <button type="button" className="secondary compact" disabled={historyBusy}
            onClick={()=>void loadHistory()}>
            {historyBusy?'Загружаю…':history===null?'Посмотреть историю объединений':'Обновить историю'}
          </button>
          {historyError?<p className="reference-merge-error" role="alert">{historyError}</p>:null}
          {history!==null?(
            <div className="reference-merge-history-items">
              {history.length===0?<p>Пока ничего не объединяли.</p>:history.map((item,index)=>(
                <div className="reference-merge-history-item" key={item.kind+':'+item.id+':'+index}>
                  <div><strong><s>{item.source}</s> → {item.target}</strong>
                    <small>{dictionaries.find(d=>d.kind===(item.kind==='payment_method'?'paymentMethods':item.kind==='city'?'cities':'deliveryTypes'))?.label||'Справочник'}</small>
                  </div>
                  <span>{item.actor} · {new Date(item.createdAt).toLocaleString('ru-RU')} · записей {item.affected}</span>
                </div>
              ))}
            </div>
          ):null}
        </div>
        {impact&&source?.id===impact.source.id&&target?.id===impact.target.id?(
          <div className="reference-merge-impact">
            <h4>Что произойдёт с записями?</h4>
            <p className="reference-merge-transform"><s>{impact.source.value}</s><span aria-hidden="true">→</span><strong>{impact.target.value}</strong></p>
            {impact.ordersCovered ? (
              <div className="reference-merge-stats">
                <div><span>Заказы за {impact.month.label}</span><strong>{impact.orders.current}</strong><small>Требуют обновления</small></div>
                <div><span>Заказы за предыдущие месяцы</span><strong>{impact.orders.older}</strong><small>Останутся в истории без изменений</small></div>
              </div>
            ) : impact.catalogImpact
              ? <p className="reference-merge-next">Ниже показаны связи с товарными вариантами и заказами. Исторические документы остаются без изменений.</p>
              : <p className="reference-merge-notice">Связи этого списка с документами ещё проверяются. Количество затронутых записей пока не определено.</p>}
            {impact.catalogImpact ? (
              <div className="reference-merge-catalog-impact" aria-label="Связанные товары и склад">
                <h4>Товары, остатки и заказы</h4>
                <p className="mini-panel-note">
                  Считаются связанные варианты товаров, а не сами названия в справочнике.
                  Исторические снимки остаются на своих местах.
                </p>
                <div className="reference-merge-stats">
                  <div>
                    <span>С названием, которое убираем</span>
                    <strong>{impact.catalogImpact.source.variants}</strong>
                    <small>Действующих вариантов: {impact.catalogImpact.source.activeVariants}</small>
                  </div>
                  <div>
                    <span>С названием, которое оставляем</span>
                    <strong>{impact.catalogImpact.target.variants}</strong>
                    <small>Действующих вариантов: {impact.catalogImpact.target.activeVariants}</small>
                  </div>
                </div>
                <div className="reference-merge-catalog-metrics">
                  <div><strong>Лишнее значение</strong>
                    <span>На месте: {impact.catalogImpact.source.physical} шт. · В резервах: {impact.catalogImpact.source.reserved} шт.</span>
                    <span>Строки заказов этого месяца: {impact.catalogImpact.source.currentOrderLines}</span>
                    <span>Строки прошлых заказов: {impact.catalogImpact.source.olderOrderLines}</span>
                    <span>Неотправленные активные позиции: {impact.catalogImpact.source.activeUnsentLines}</span>
                    <span>Активные резервы: {impact.catalogImpact.source.activeReservations} ({impact.catalogImpact.source.reservedUnits} шт.)</span>
                    <span>Активные задачи цеха: {impact.catalogImpact.source.activeWorkshopTasks}</span>
                    {impact.catalogImpact.sourceExecutions>0 ? (
                      <span>Действующие исполнения: {impact.catalogImpact.sourceExecutions}</span>
                    ) : null}
                  </div>
                  <div><strong>Основное значение</strong>
                    <span>На месте: {impact.catalogImpact.target.physical} шт. · В резервах: {impact.catalogImpact.target.reserved} шт.</span>
                    <span>Строки заказов этого месяца: {impact.catalogImpact.target.currentOrderLines}</span>
                    <span>Строки прошлых заказов: {impact.catalogImpact.target.olderOrderLines}</span>
                    <span>Неотправленные активные позиции: {impact.catalogImpact.target.activeUnsentLines}</span>
                    <span>Активные резервы: {impact.catalogImpact.target.activeReservations} ({impact.catalogImpact.target.reservedUnits} шт.)</span>
                    <span>Активные задачи цеха: {impact.catalogImpact.target.activeWorkshopTasks}</span>
                  </div>
                </div>
                {impact.catalogImpact.byLocation.length ? (
                  <div className="reference-merge-linked">
                    <strong>Где находятся вещи</strong>
                    <div className="reference-merge-linked-grid">
                      {impact.catalogImpact.byLocation.map((x,index)=>(
                        <span key={x.side+':'+x.location+':'+index}>
                          {x.side==='source'?'Лишнее':'Основное'} · {x.location==='warehouse'?'Склад':x.location==='boutique'?'Бутик':x.location}:
                          {' '}{x.physical} шт. · резерв {x.reserved}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {impact.catalogImpact.warnings.length ? (
                  <div className="reference-merge-notice" role="status">
                    <strong>Что нужно учесть перед объединением</strong>
                    <ul>{impact.catalogImpact.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
                  </div>
                ) : null}
                {impact.catalogImpact.sampleVariants.length ? (
                  <details className="reference-merge-catalog-samples">
                    <summary>Посмотреть связанные варианты ({impact.catalogImpact.sampleVariants.length}{impact.catalogImpact.sampleTruncated?'+':''})</summary>
                    <div>
                      {impact.catalogImpact.sampleVariants.map(v=>(
                        <div className="reference-merge-catalog-sample" key={v.id}>
                          <strong>{v.productName}</strong>
                          <span>{v.material||'Без материала'} · {v.length||'Стандарт'} · {v.color||'Без цвета'} · {v.size||'Без размера'}</span>
                          <small>{v.side==='source'?'Лишнее значение':'Основное значение'} · {v.active?'Действует':'Архив'} · На месте {v.physical} шт. · Резерв {v.reserved}</small>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
                {impact.catalogImpact.sampleTruncated ? (
                  <p className="reference-merge-next">Показаны первые 12 вариантов. Общие показатели выше рассчитаны для всех совпадений.</p>
                ) : null}
                {impact.catalogImpact.skuPairsLimited && !impact.catalogImpact.skuPairs?.length ? (
                  <p className="reference-merge-notice">Вариантов слишком много для полного безопасного поиска совпадений за один проход. Ни одно объединение автоматически не выполняется.</p>
                ) : null}
                {impact.catalogImpact.skuPairs?.length ? (
                  <div className="reference-merge-sku-guidance">
                    <h4>Найдены одинаковые варианты товаров</h4>
                    <p className="mini-panel-note">Система нашла точные совпадения по товару, исполнению, полу, цвету и размеру. Можно проверить и объединить каждую пару отдельно. Выбранное основное значение сохранится.</p>
                    {impact.catalogImpact.skuPairs.map(pair=>(
                      <div className="reference-merge-sku-pair" key={pair.sourceVariantId+':'+pair.targetVariantId}>
                        <div>
                          <strong>{pair.productName}</strong>
                          <small>{pair.description}</small>
                        </div>
                        <button className="secondary compact" type="button" disabled={pairBusy||checking||saving}
                          onClick={()=>void inspectSkuPair(pair.sourceVariantId,pair.targetVariantId)}>
                          {pairBusy ? 'Проверяю…':'Проверить пару'}
                        </button>
                      </div>
                    ))}
                    {impact.catalogImpact.skuPairsLimited ? (
                      <p className="reference-merge-notice">Показана только часть возможных совпадений. Не выполняйте массовую замену: после каждой операции проверяйте список заново.</p>
                    ):null}
                    {pairReview ? (
                      <div className="reference-merge-sku-review">
                        <strong>Проверка выбранной пары</strong>
                        <p>{pairReview.preview.explanation}</p>
                        <p>Резервов действующих заказов: {pairReview.preview.reservationCount}.</p>
                        {pairReview.preview.stockBreakdown.map(place=>(
                          <p key={place.location}>
                            {place.location==='warehouse'?'Склад':'Бутик'}:
                            {' '}{place.sourcePhysical} + {place.targetPhysical} = {place.combinedPhysical} шт.;
                            резерв {place.sourceReserved} + {place.targetReserved}
                          </p>
                        ))}
                        {pairReview.preview.blockers.length ? (
                          <div className="reference-merge-notice" role="status">
                            <strong>Объединение пока невозможно:</strong>
                            <ul>{pairReview.preview.blockers.map((reason,i)=><li key={i}>{reason}</li>)}</ul>
                          </div>
                        ):null}
                        {pairReview.preview.canConsolidate ? (
                          <button className="primary compact" type="button" disabled={pairBusy||checking||saving}
                            onClick={()=>void applySkuPair()}>
                            {pairBusy?'Сохраняю…':'Объединить выбранную пару'}
                          </button>
                        ):null}
                      </div>
                    ):null}
                  </div>
                ) : null}
                {impact.catalogImpact.canReviewReferenceCleanup ? (
                  <div className="reference-merge-sku-guidance">
                    <strong>Закончить очистку справочника</strong>
                    <p className="mini-panel-note">Когда все действующие дубли разобраны, лишнее название можно убрать из новых форм без удаления старых документов.</p>
                    <button type="button" className="secondary compact" disabled={pairBusy||checking||saving}
                      onClick={()=>void inspectReferenceCleanup()}>
                      {pairBusy?'Проверяю…':'Проверить, можно ли убрать лишнее название'}
                    </button>
                    {cleanup ? (
                      <div className="reference-merge-sku-review">
                        <p>{cleanup.explanation}</p>
                        {cleanup.safeToHideSource ? (
                          <button type="button" className="primary compact" disabled={pairBusy||checking||saving}
                            onClick={()=>void hideReferenceAlias()}>
                            Убрать лишнее название из выбора
                          </button>
                        ) : <p className="reference-merge-notice">Пока остаются связанные действующие товары, складские остатки или исполнения.</p>}
                      </div>
                    ):null}
                  </div>
                ):null}
                <p className="reference-merge-next">
                  Доступно только безопасное объединение точных дублей SKU, по одному после проверки.
                  Другие цвета, размеры и исполнения автоматически не приравниваются.
                  Полное объединение значения справочника пока недоступно, пока существуют связанные варианты.
                </p>
              </div>
            ) : null}
            {impact.kind==='payment_method'?(
              <div className="reference-merge-linked">
                <strong>Дополнительно связаны с оплатами</strong>
                <p>В заказах выбранного месяца найдены следующие записи с прежним названием:</p>
                <div className="reference-merge-linked-grid">
                  <span>Оплаты: <b>{impact.finance.payments.current}</b></span>
                  <span>История денежных операций: <b>{impact.finance.financialEvents.current}</b></span>
                  <span>Наличные: <b>{impact.finance.cashEntries.current}</b></span>
                  <span>Возвраты: <b>{impact.finance.returns.current}</b></span>
                  <span>Обмены: <b>{impact.finance.exchanges.current}</b></span>
                </div>
              </div>
            ):null}
            {impact.paymentSafety?.blockers?.length ? (
              <div className="reference-merge-notice" role="status">
                <strong>Почему сейчас нельзя объединить:</strong>
                <ul>{impact.paymentSafety.blockers.map(x=><li key={x}>{x}</li>)}</ul>
              </div>
            ) : null}
            {impact.kind==='payment_method' && impact.canApply ? (
              <p className="reference-merge-notice">Платежи этого месяца получат выбранное название. Суммы, даты и наличные не изменятся. История прежнего названия будет сохранена.</p>
            ) : null}
            {impact.activeCatalogVariants>0?(
              <p className="reference-merge-notice">Название используется в {impact.activeCatalogVariants} вариантах товаров. Их нельзя менять без проверки.</p>
            ):null}
            <p className="reference-merge-notice">{impact.explanation}</p>
            {impact.canApply?(
              <div className="reference-merge-action-row">
                <button type="button" className="primary" disabled={saving} onClick={()=>void apply()}>
                  {saving?'Сохраняю…':'Объединить значения'}
                </button>
                <span>Предыдущие месяцы останутся без изменений.</span>
              </div>
            ):<p className="reference-merge-next">{impact.catalogImpact
              ? 'Полное объединение значения пока недоступно. Проверенные пары вариантов можно обработать отдельно выше; остальные связи требуют дополнительной проверки.'
              : 'Сохранение пока недоступно: сначала нужно проверить все связанные записи, чтобы не нарушить историю заказов и отчёты.'}</p>}
          </div>
        ):null}
      </>
    )}
  </section>
}
