import {useEffect,useRef,useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-returns.css'
type Pending={operationType:'return'|'exchange';returnItemId:number;returnId:number;orderId:number;externalOrderId:string;quantity:number;returnDate:string;modelName:string;gender:string;movement:string;braceletMaterial:string;dialColor:string;braceletColor:string}
type Result={ok:boolean;rows:Pending[];message?:string}
type Destination='warehouse'|'boutique'|'no_stock'
export function WatchReturnsPanel({brands,initialBrand}:{brands:readonly WatchBrand[];initialBrand?:WatchBrand}){
 const [brand,setBrand]=useState<WatchBrand>(
   initialBrand&&brands.includes(initialBrand)?initialBrand:brands[0]||'TAUWACH')
 const [rows,setRows]=useState<Pending[]>([])
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [reload,setReload]=useState(0)
 const [selected,setSelected]=useState<string|null>(null)
 const [destination,setDestination]=useState<Destination>('warehouse')
 const [confirmed,setConfirmed]=useState(false)
 const requests=useRef<Record<string,{fingerprint:string;requestId:string}>>({})
 useEffect(()=>{
   const abort=new AbortController()
   setBusy(true);setError('');setRows([])
   void fetch('/api/client3/watches/returns/pending?brand='+encodeURIComponent(brand),{
     credentials:'include',cache:'no-store',signal:abort.signal,
   }).then(async resp=>{
     const result=await resp.json() as Result
     if(!resp.ok||!result.ok)throw new Error(result.message||'Не удалось загрузить возвраты')
     if(!abort.signal.aborted)setRows(result.rows||[])
   }).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка возвратов')})
     .finally(()=>{if(!abort.signal.aborted)setBusy(false)})
   return ()=>abort.abort()
 },[brand,reload])
 const receive=async(row:Pending)=>{
   const itemKey=row.operationType+':'+row.returnItemId
   if(busy||selected!==itemKey||!confirmed)return
   const fingerprint=JSON.stringify([brand,row.operationType,row.orderId,row.returnId,row.returnItemId,destination])
   if(requests.current[itemKey]?.fingerprint!==fingerprint)
     requests.current[itemKey]={fingerprint,requestId:'watch-intake-'+crypto.randomUUID()}
   setBusy(true);setError('');setNotice('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+row.orderId+'/return/receive',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({
         brand,returnId:row.returnId,returnItemId:row.returnItemId,destination,
         operationType:row.operationType,requestId:requests.current[itemKey].requestId,
       }),
     })
     const result=await response.json() as {ok:boolean;message?:string;code?:string}
     if(!response.ok||!result.ok)throw new Error(result.message||'Приём не подтверждён')
     delete requests.current[itemKey]
     setSelected(null);setConfirmed(false)
     setNotice('Физический приём часов подтверждён. Складская история обновлена.')
     setReload(x=>x+1)
   }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось принять часы')}
   finally{setBusy(false)}
 }
 return <section className="watch-returns">
   <header><div><h2>Ожидают физической приёмки</h2>
     <p>Только часы, по которым оформлен возврат, но ещё не подтверждено физическое поступление.</p>
   </div><button disabled={busy} onClick={()=>setReload(x=>x+1)}>Обновить</button></header>
   <label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);setSelected(null);setConfirmed(false)}}>
     {brands.map(x=><option key={x}>{x}</option>)}
   </select></label>
   {error&&<p role="alert" className="watch-returns-error">{error}</p>}
   {notice&&<p role="status" className="watch-returns-notice">{notice}</p>}
   {busy&&<p>Обработка…</p>}
   {!busy&&rows.length===0&&<p>Ожидающих физической приёмки нет.</p>}
   <div className="watch-returns-list">{rows.map(row=><article key={row.operationType+':'+row.returnItemId}>
     <strong>{row.externalOrderId} · {row.quantity} шт. · {row.operationType==='exchange'?'После обмена':'Возврат'}</strong>
     <p>{row.modelName} · {row.gender==='male'?'Мужские':'Женские'} · {watchReferenceLabel('movements',row.movement)} · {watchReferenceLabel('bracelets',row.braceletMaterial)} · {watchReferenceLabel('dials',row.dialColor)}
       {row.braceletColor?' · Ремешок '+watchReferenceLabel('leatherColors',row.braceletColor):''}</p>
     <small>Возврат оформлен: {row.returnDate}</small>
     {selected===row.operationType+':'+row.returnItemId?<>
       <label>Физическое состояние<select value={destination} onChange={e=>{setDestination(e.target.value as Destination);setConfirmed(false)}}>
         <option value="warehouse">Фактически получено в офис</option>
         <option value="boutique">Фактически получено на витрину</option>
         <option value="no_stock">Получено, но нельзя возвращать в остаток</option>
       </select></label>
       <label className="watch-returns-confirm"><input type="checkbox" checked={confirmed}
         onChange={e=>setConfirmed(e.target.checked)}/>
         Подтверждаю, что указанные часы действительно получены
       </label>
       <div className="watch-returns-actions"><button disabled={busy||!confirmed}
         onClick={()=>void receive(row)}>Подтвердить приём</button>
         <button disabled={busy} onClick={()=>{setSelected(null);setConfirmed(false)}}>Отмена</button></div>
     </>:<button disabled={busy} onClick={()=>{setSelected(row.operationType+':'+row.returnItemId);setConfirmed(false)}}>Принять часы</button>}
   </article>)}</div>
 </section>
}
