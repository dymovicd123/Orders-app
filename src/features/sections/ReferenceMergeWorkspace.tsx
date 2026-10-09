import { useEffect, useState } from 'react'
import '../../styles/reference-merge-workspace.css'

type Value = { id: number; value: string; isActive: boolean }
type Counts = { current:number; older:number }
type Impact = {
  ok:boolean;
  kind:string;
  source:{id:number;value:string};
  target:{id:number;value:string};
  month:{from:string;toExclusive:string;label:string};
  orders:Counts;
  finance:{payments:Counts;financialEvents:Counts;cashEntries:Counts;returns:Counts;exchanges:Counts};
  activeCatalogVariants:number;
  canApply:boolean;
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
  apiFetch,isAdmin,
}: {
  apiFetch:(input:string,init?:RequestInit)=>Promise<Response>;
  isAdmin:boolean;
}) {
  const [kind,setKind]=useState('paymentMethods')
  const [values,setValues]=useState<Value[]>([])
  const [loading,setLoading]=useState(false)
  const [sourceId,setSourceId]=useState(0)
  const [targetId,setTargetId]=useState(0)
  const [impact,setImpact]=useState<Impact|null>(null)
  const [checking,setChecking]=useState(false)
  const [error,setError]=useState('')
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

  const chooseSource=(id:number)=>{setSourceId(id);setImpact(null);setError('')}
  const chooseTarget=(id:number)=>{setTargetId(id);setImpact(null);setError('')}
  const canInspect=sourceId>0&&targetId>0&&sourceId!==targetId&&!loading&&!checking
  const source=values.find(v=>v.id===sourceId)
  const target=values.find(v=>v.id===targetId)
  async function inspect(){
    if(!canInspect)return
    setChecking(true);setError('');setImpact(null)
    try{
      const query=new URLSearchParams({sourceId:String(sourceId),targetId:String(targetId)})
      const res=await apiFetch('/api/reference-values/merge-preview?'+query.toString())
      const data=await res.json() as Impact & {message?:string}
      if(!res.ok||!data.ok)throw new Error(data.message||'Не удалось проверить связанные записи.')
      setImpact(data)
    }catch(err){setError(err instanceof Error?err.message:'Не удалось проверить изменения.')}
    finally{setChecking(false)}
  }

  return <section className="reference-merge-workspace" aria-label="Объединить значения справочников">
    <div className="reference-merge-heading">
      <div>
        <span className="reference-merge-eyebrow">Порядок в справочниках</span>
        <h3>Объединить значения</h3>
        <p>Вы сами решаете, какое название оставить. Остальное система проверит перед сохранением.</p>
      </div>
    </div>
    {!isAdmin ? (
      <p className="reference-merge-notice">Для объединения или удаления значений войдите как администратор.</p>
    ) : (
      <>
        <label className="reference-merge-kind">
          <span>Какой список приводим в порядок?</span>
          <select value={kind} onChange={e=>setKind(e.target.value)} disabled={loading||checking}>
            {dictionaries.map(x=><option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </label>
        <div className="reference-merge-pair">
          <label className="reference-merge-choice">
            <span className="reference-merge-step">1. Убираем лишнее название</span>
            <select value={sourceId} onChange={e=>chooseSource(Number(e.target.value))} disabled={loading||checking}>
              <option value={0}>Выберите значение</option>
              {values.filter(v=>v.id!==targetId).map(v=><option key={v.id} value={v.id}>{v.value}</option>)}
            </select>
            <small>Это название исчезнет из дальнейшего выбора после объединения.</small>
          </label>
          <span className="reference-merge-arrow" aria-hidden="true">→</span>
          <label className="reference-merge-choice reference-merge-primary">
            <span className="reference-merge-step">2. Оставляем правильное название</span>
            <select value={targetId} onChange={e=>chooseTarget(Number(e.target.value))} disabled={loading||checking}>
              <option value={0}>Выберите значение</option>
              {values.filter(v=>v.id!==sourceId).map(v=><option key={v.id} value={v.id}>{v.value}</option>)}
            </select>
            <small>Его будут использовать сотрудники в новых заказах.</small>
          </label>
        </div>
        <div className="reference-merge-action-row">
          <button type="button" className="primary" disabled={!canInspect} onClick={()=>void inspect()}>
            {checking?'Проверяю записи…':'Посмотреть, что изменится'}
          </button>
          {loading?<span>Загружаю значения…</span>:!values.length?<span>В этом списке нет действующих значений.</span>:null}
        </div>
        {sourceId&&targetId&&sourceId===targetId? <p className="reference-merge-notice">Выберите разные значения.</p>:null}
        {error?<p className="reference-merge-error" role="alert">{error}</p>:null}
        {impact&&source?.id===impact.source.id&&target?.id===impact.target.id?(
          <div className="reference-merge-impact">
            <h4>Что произойдёт с записями?</h4>
            <p className="reference-merge-transform"><s>{impact.source.value}</s><span aria-hidden="true">→</span><strong>{impact.target.value}</strong></p>
            <div className="reference-merge-stats">
              <div><span>Заказы за {impact.month.label}</span><strong>{impact.orders.current}</strong><small>Требуют обновления</small></div>
              <div><span>Заказы за предыдущие месяцы</span><strong>{impact.orders.older}</strong><small>Останутся в истории без изменений</small></div>
            </div>
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
            {impact.activeCatalogVariants>0?(
              <p className="reference-merge-notice">Название используется в {impact.activeCatalogVariants} вариантах товаров. Их нельзя менять без проверки.</p>
            ):null}
            <p className="reference-merge-notice">{impact.explanation}</p>
            {!impact.canApply?<p className="reference-merge-next">Объединение пока не подтверждается: сначала необходимо согласовать изменение связанных записей, чтобы не нарушить историю заказов и отчёты.</p>:null}
          </div>
        ):null}
      </>
    )}
  </section>
}
