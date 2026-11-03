import {useEffect,useState} from 'react'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-stage5-warehouse.css'

type Source='office'|'showcase'
type HistoryRow={
 id:number;source:Source;movementType:string;quantityDelta:number;quantityAfter:number;
 comment:string;createdAt:string;modelName:string;watchVariantId:number;
 gender:string;movement:string;braceletMaterial:string;dialColor:string;braceletColor:string;
 referenceType:string;referenceId:string
}
const sourceLabel=(source:Source)=>source==='office'?'Офис':'Витрина'
const description=(row:Pick<HistoryRow,'gender'|'movement'|'braceletMaterial'|'dialColor'|'braceletColor'>)=>
 [row.gender==='male'?'Мужские':row.gender==='female'?'Женские':'',
  watchReferenceLabel('movements',row.movement),watchReferenceLabel('bracelets',row.braceletMaterial),watchReferenceLabel('dials',row.dialColor),row.braceletColor?('Ремешок: '+watchReferenceLabel('leatherColors',row.braceletColor)):'']
 .filter(Boolean).join(' · ')
const moveLabels:Record<string,string>={
 arrival:'Приход',writeoff:'Списание',manual_set:'Корректировка',
 transfer_in:'Перемещение (приход)',transfer_out:'Перемещение (расход)',
 revision:'Ревизия',sale:'Отправка',return:'Возврат',
}

/** Small, bounded, read-only warehouse history. No Problems queue or management actions. */
export function WatchWarehouseHistory({brand,revision=0}:{brand:WatchBrand;revision?:number}){
 const [source,setSource]=useState<'all'|Source>('all')
 const [rows,setRows]=useState<HistoryRow[]>([])
 const [before,setBefore]=useState<number|null>(null)
 const [hasMore,setHasMore]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [page,setPage]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   setBusy(true);setError('')
   const q=new URLSearchParams({brand,source})
   if(before)q.set('beforeId',String(before))
   void fetch('/api/client3/watches/stock/history?'+q,{
     credentials:'include',cache:'no-store',signal:controller.signal,
   }).then(async response=>{
     const result=await response.json() as {
       ok?:boolean;message?:string;rows?:HistoryRow[];hasMore?:boolean;nextBeforeId?:number|null}
     if(!response.ok||!result.ok)throw Error(result.message||'Не удалось загрузить историю.')
     if(!controller.signal.aborted){
       setRows(old=>page===0?(result.rows||[]):[...old,...(result.rows||[])])
       setHasMore(Boolean(result.hasMore))
       setBefore(result.nextBeforeId||null)
     }
   }).catch(cause=>{if(!controller.signal.aborted)setError(String(cause))})
     .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
   return ()=>controller.abort()
 },[brand,source,revision,page])
 const reset=(s:'all'|Source)=>{setRows([]);setBefore(null);setPage(0);setSource(s)}
 return <section className="client3-stage5-history">
   <header className="client3-stage5-section-head"><div>
     <h3>История склада</h3><p>Только реальные операции часов выбранного бренда. Без очереди проблем.</p>
   </div><label>Точка<select value={source} onChange={e=>reset(e.target.value as 'all'|Source)}>
     <option value="all">Обе точки</option><option value="office">Офис</option>
     <option value="showcase">Витрина</option>
   </select></label></header>
   {error&&<p role="alert" className="client3-stage5-error">{error}</p>}
   <LinkedTableScroll><table className="client3-stage5-table"><thead><tr>
     <th>Дата</th><th>Товар</th><th>Операция</th><th>Точка</th><th>Изменение</th><th>После</th><th>Комментарий</th>
   </tr></thead><tbody>{rows.map(row=><tr key={row.id}>
     <td>{row.createdAt?new Date(row.createdAt).toLocaleString('ru-RU'):'—'}</td>
     <td><strong>{row.modelName}</strong><small>{description(row)}</small></td>
     <td>{moveLabels[row.movementType]||row.movementType}</td>
     <td>{sourceLabel(row.source)}</td>
     <td className={row.quantityDelta<0?'is-negative':'is-positive'}>
       {row.quantityDelta>0?'+':''}{row.quantityDelta}</td>
     <td>{row.quantityAfter}</td><td>{row.comment||'—'}</td>
   </tr>)}</tbody></table></LinkedTableScroll>
   {!rows.length&&!busy&&<p>Движений часов в выбранной точке пока нет.</p>}
   {hasMore&&<button type="button" className="secondary compact" disabled={busy}
     onClick={()=>setPage(x=>x+1)}>{busy?'Загрузка…':'Показать ещё'}</button>}
 </section>
}
