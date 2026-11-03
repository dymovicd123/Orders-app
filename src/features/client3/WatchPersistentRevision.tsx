import {useEffect,useMemo,useState} from 'react'
import {StocktakeSizeCountCell} from '../inventory/views/StocktakeSharedInputs'
import {WatchOperationInlineCatalog} from './WatchOperationInlineCatalog'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'

type Source='office'|'showcase'
type WatchVariant={watchProductId:number;modelName:string;watchVariantId:number|null;catalogVariantId:number|null;gender:string|null;
 movement:string|null;braceletMaterial:string|null;dialColor:string|null;braceletColor:string|null}
type RevisionItem={
 id:number;productId:number;variantId:number;watchVariantId:number;productName:string;
 gender:string;movement:string;braceletMaterial:string;dialColor:string;braceletColor:string;
 status:string;currentQuantity:number;baselineQuantity:number;reservedQuantity:number;
 countedQuantity:number|null;countedAt:string|null;conflictQuantity:number|null;appliedQuantity:number|null
}
type Session={
 id:string;status:string;scope:'full'|'selective';source:string;startedAt:string;
 totalItems:number;countedCount:number;recountCount:number;shortageCount:number;items:RevisionItem[]
}
type Result={ok:boolean;message?:string;code?:string;blocked?:boolean;session?:Session|null;
 changed?:number;resumed?:boolean;alreadyPresent?:boolean}
async function post(action:string,data:Record<string,unknown>):Promise<Result>{
 const res=await fetch('/api/client3/watches/stock/revision/'+action,{
   method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(data),
 })
 const result=await res.json() as Result
 if(!res.ok||!result.ok)throw new Error(result.message||'Ревизия не сохранена.')
 return result
}
const itemName=(item:RevisionItem)=>[
 item.gender==='male'?'Мужские':item.gender==='female'?'Женские':'',
 watchReferenceLabel('movements',item.movement),
 watchReferenceLabel('bracelets',item.braceletMaterial),
 watchReferenceLabel('dials',item.dialColor),
 item.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',item.braceletColor):'',
].filter(Boolean).join(' · ')
const validCount=(raw:string)=>/^\d{1,7}$/.test(raw)&&Number(raw)<=1_000_000

/** Main inventory stocktake persistence in the SAME Client3 stock-operations
 * panel: existing product queue starts selective sessions; "Full" uses all
 * active variants of just this watch brand at the selected point.
 */
export function WatchPersistentRevision({brand,source,models,variants,selectedModelIds,
 preferredScope,onActiveChange,onStockChanged}:{
 brand:WatchBrand;source:Source;models:readonly (readonly [number,string])[];
 variants:readonly WatchVariant[];selectedModelIds:readonly number[];
 preferredScope?:'selective'|'full';
 onActiveChange:(active:boolean)=>void;onStockChanged:()=>void
}){
 const [session,setSession]=useState<Session|null>(null)
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(true)
 const [blocked,setBlocked]=useState('')
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [draft,setDraft]=useState<Record<number,string>>({})
 const [saved,setSaved]=useState<Record<number,string>>({})
 const [group,setGroup]=useState<number|null>(null)
 const [confirmed,setConfirmed]=useState(false)
 const [adding,setAdding]=useState(false)
 const [newVariant,setNewVariant]=useState('')
 const [showOutcome,setShowOutcome]=useState(false)
 const [reviewOpen,setReviewOpen]=useState(false)
 const hydrate=(data:Session|null)=>{
   setSession(data)
   onActiveChange(Boolean(data&&data.status==='active'))
   const values:Record<number,string>={}
   for(const item of data?.items||[])values[item.id]=item.countedQuantity===null?'':String(item.countedQuantity)
   setDraft(values);setSaved(values)
   setGroup(current=>data?.items.some(x=>x.productId===current)?current:
     data?.items[0]?.productId||null)
 }
 useEffect(()=>{
   const controller=new AbortController()
   setError('');setNotice('');setBlocked('');setLoading(true);setShowOutcome(false);setReviewOpen(false)
   hydrate(null)
   const q=new URLSearchParams({brand,source})
   void fetch('/api/client3/watches/stock/revision?'+q,{
     credentials:'include',cache:'no-store',signal:controller.signal,
   }).then(async response=>{
     const result=await response.json() as Result
     if(!response.ok||!result.ok)throw Error(result.message||'Ревизия недоступна.')
     if(!controller.signal.aborted){setBlocked(result.blocked?result.message||'Точка занята другой ревизией.':'');hydrate(result.session||null)}
   }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Ошибка загрузки ревизии.')})
     .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand,source])
 const productIds=useMemo(()=>[...new Set((session?.items||[]).map(x=>x.productId))],[session])
 const currentItems=(session?.items||[]).filter(x=>x.productId===group)
 const invalid=Object.keys(draft).some(id=>draft[Number(id)]!==''&&!validCount(draft[Number(id)]))
 const dirty=Object.keys(draft).some(id=>draft[Number(id)]!==(saved[Number(id)]||''))
 const saveOne=async(id:number,value:string)=>{
   if(!session||session.status!=='active'||busy||!(!value||validCount(value)))return false
   setBusy(true);setError('')
   try{
     const result=await post('count',{brand,sessionId:session.id,itemId:id,
       countedQuantity:value===''?null:Number(value)})
     if(result.session)hydrate(result.session)
     setNotice('Количество сохранено. Проверку можно закрыть и продолжить позже.')
     return true
   }catch(e){
     setError(e instanceof Error?e.message:'Не удалось сохранить результат.')
     // Refresh after a movement conflict; Main retains previous counted result.
     const q=new URLSearchParams({brand,source})
     try{
       const result=await (await fetch('/api/client3/watches/stock/revision?'+q,{credentials:'include'})).json() as Result
       if(result.ok&&result.session)hydrate(result.session)
     }catch{/* Keep visible server error; no silent retry. */}
     return false
   }finally{setBusy(false)}
 }
 const saveDirty=async()=>{
   if(!session||busy||invalid)return
   // Saving single Main count writes is deliberate: each gets its own stale
   // baseline and durable counted-at timestamp, identical to Main.
   let pending=Object.entries(draft).filter(([id,v])=>v!==(saved[Number(id)]||''))
   if(!pending.length)return
   setBusy(true);setError('')
   let latest:Session=session
   try{
     for(const [id,value] of pending){
       const result=await post('count',{brand,sessionId:latest.id,itemId:Number(id),
         countedQuantity:value===''?null:Number(value)})
       if(result.session)latest=result.session
     }
     hydrate(latest);setNotice('Все введённые количества сохранены. Можно вернуться позже.')
   }catch(e){
     setError(e instanceof Error?e.message:'Сохранение не завершено.')
     // Any successful prior item saves are persisted. Fetch their real state.
     try{
       const q=new URLSearchParams({brand,source})
       const result=await (await fetch('/api/client3/watches/stock/revision?'+q,
         {credentials:'include',cache:'no-store'})).json() as Result
       if(result.ok&&result.session)hydrate(result.session)
     }catch{/* preserve visible error */}
   }finally{setBusy(false)}
 }
 const start=async(full:boolean)=>{
   if(busy||loading||blocked||(!full&&!selectedModelIds.length))return
   setBusy(true);setError('');setNotice('')
   try{
     const result=await post('start',{brand,source,full,modelIds:full?[]:selectedModelIds})
     hydrate(result.session||null)
     setReviewOpen(false)
     setNotice(result.resumed?'Незавершённая ревизия открыта.':
       'Проверка начата. Вводите фактические количества — они сохраняются до завершения.')
   }catch(e){setError(e instanceof Error?e.message:'Не удалось начать проверку.')}
   finally{setBusy(false)}
 }
 const add=async(id:number)=>{
   if(!session||busy)return
   setBusy(true);setError('')
   try{
     const result=await post('add',{brand,sessionId:session.id,watchVariantId:id})
     if(result.session)hydrate(result.session)
     setNewVariant('');setAdding(false)
     setNotice(result.alreadyPresent?'Комплектация уже в ревизии.':'Комплектация добавлена к ревизии.')
   }catch(e){setError(e instanceof Error?e.message:'Не удалось добавить часы.')}
   finally{setBusy(false)}
 }
 const finish=async()=>{
   if(!session||busy||dirty||invalid||!confirmed||session.recountCount)return
   setBusy(true);setError('')
   try{
     const result=await post('complete',{brand,sessionId:session.id})
     if(result.session)hydrate(result.session)
     // Keep the completed result visible inside the same Main correction panel.
     // A completed session is no longer "active" on the server, but the parent
     // must not unmount this component before the user acknowledges the outcome.
     setShowOutcome(true)
     onActiveChange(true)
     onStockChanged()
     setNotice(result.message||'Ревизия завершена. Фактические остатки обновлены.')
   }catch(e){setError(e instanceof Error?e.message:'Ревизия не завершена.')}
   finally{setBusy(false)}
 }
 const cancel=async()=>{
   if(!session||busy||!window.confirm('Отменить ревизию? Сохранённые подсчёты не будут применены к остаткам.'))return
   setBusy(true);setError('')
   try{
     await post('cancel',{brand,sessionId:session.id})
     hydrate(null);setNotice('Ревизия отменена без применения подсчётов.')
   }catch(e){setError(e instanceof Error?e.message:'Не удалось отменить ревизию.')}
   finally{setBusy(false)}
 }
 const known=variants.filter(x=>x.watchVariantId!==null&&!session?.items.some(y=>y.watchVariantId===x.watchVariantId))
 return <div className="client3-watch-persistent-revision">
   {loading&&<p>Проверяем незавершённую ревизию…</p>}
   {blocked&&<p role="status" className="stocktake-inline-notice w6-notice-error">{blocked}</p>}
   {error&&<p role="alert" className="stocktake-inline-notice w6-notice-error">{error}</p>}
   {notice&&<p role="status" className="stocktake-inline-notice">{notice}</p>}
   {!loading&&!blocked&&!session&&<div className="stocktake-start-submit">
     <div>{preferredScope==='full'
       ?'Полная проверка · '+variants.length+' комплектаций бренда '+brand
       :selectedModelIds.length
         ?'Готово к проверке · '+selectedModelIds.length+' моделей'
         :'Выберите хотя бы одну модель для выборочной проверки'}</div>
     <div className="client3-revision-start-buttons">
       {(preferredScope===undefined||preferredScope==='selective')&&
         <button type="button" className={preferredScope==='selective'?'primary stocktake-e-start-button':'secondary'}
           disabled={!selectedModelIds.length||busy}
           onClick={()=>void start(false)}>{busy?'Подготавливаем…':'Начать проверку выбранных товаров'}</button>}
       {(preferredScope===undefined||preferredScope==='full')&&
         <button type="button" className="primary stocktake-e-start-button" disabled={busy||loading}
           onClick={()=>void start(true)}>{busy?'Подготавливаем…':'Начать полную проверку'}</button>}
     </div>
   </div>}
   {session&&<div className="stocktake-session-workspace client3-revision-workspace">
     <div className="stocktake-e-product-nav stocktake-e-product-nav-v5">
       <div><span>{session.scope==='full'?'Полная ревизия':'Выборочная ревизия'} · {source==='office'?'Офис':'Витрина'}</span>
         <h4>{session.status==='completed'?'Ревизия завершена':'Проверка уже идёт'}</h4>
         <small>Начата: {new Date(session.startedAt).toLocaleString('ru-RU')} ·
           Сохранено {session.countedCount} из {session.totalItems} позиций</small></div>
       {session.status==='active'&&<button type="button" className="secondary compact" disabled={busy}
         onClick={()=>void cancel()}>Отменить проверку</button>}
     </div>
     <div className="client3-revision-progress" aria-label="Прогресс ревизии">
       <div style={{width:session.totalItems?
         Math.round(100*session.countedCount/session.totalItems)+'%':'0%'}}/>
     </div>
     {session.recountCount>0&&<p className="stocktake-inline-notice w6-notice-error">
       Нужно повторно пересчитать {session.recountCount} позиций после движений склада.
       Предыдущие результаты сохранены.</p>}
     {session.status==='active'&&<>
       <div className="client3-main-stock-model-navigation">
         <div className="client3-main-stock-model-navigation-head">
           <strong>Товары в проверке</strong><span>{productIds.length} моделей</span>
         </div>
         <div className="client3-main-stock-model-navigation-list">
           {productIds.map(id=><button type="button" key={id} disabled={busy}
             className={group===id?'is-active':''}
             onClick={()=>setGroup(id)}>
             {session.items.find(x=>x.productId===id)?.productName||'Модель'}
             <small>{session.items.filter(x=>x.productId===id&&x.countedQuantity!==null).length}/
               {session.items.filter(x=>x.productId===id).length}</small>
           </button>)}
         </div>
       </div>
       <div className="client3-main-stock-skus client3-main-stock-skus-multi">
         {currentItems.map(item=><div key={item.id}
           className={'client3-main-stock-sku client3-main-stock-sku-edit'+
             (item.status==='recount_required'?' is-conflict':'')}>
           <strong>{itemName(item)}</strong>
           <span>По системе: {item.currentQuantity} · Резерв: {item.reservedQuantity}
             {item.status==='recount_required'?' · Пересчитать заново':''}</span>
           <StocktakeSizeCountCell cellId={item.id} size="Фактически"
             currentQuantity={item.currentQuantity} value={draft[item.id]||''}
             ariaLabel={item.productName+' '+itemName(item)+' фактическое количество'}
             disabled={busy} onChange={v=>{
               if(v!==''&&!/^\d{0,7}$/.test(v))return
               setDraft(old=>({...old,[item.id]:v}));setConfirmed(false);setReviewOpen(false)
             }} onBlur={()=>{if(draft[item.id]!==saved[item.id])
               void saveOne(item.id,draft[item.id]||'')}} onClear={()=>{
               setDraft(old=>({...old,[item.id]:''}));setConfirmed(false);setReviewOpen(false)
             }}/>
           {item.countedAt&&<small>Сохранено: {new Date(item.countedAt).toLocaleString('ru-RU')}</small>}
         </div>)}
       </div>
       <div className="client3-revision-add">
         <button className="secondary compact" disabled={busy} type="button"
           onClick={()=>setAdding(x=>!x)}>+ Нашли ещё комплектацию</button>
         {adding&&<>
           <div className="client3-revision-add-form">
             <select value={newVariant} onChange={e=>setNewVariant(e.target.value)} disabled={busy}>
               <option value="">Выберите существующую комплектацию</option>
               {known.map(row=><option key={row.watchVariantId} value={String(row.watchVariantId)}>
                 {row.modelName} · {watchReferenceLabel('movements',row.movement||'')} · {watchReferenceLabel('bracelets',row.braceletMaterial||'')} · {watchReferenceLabel('dials',row.dialColor||'')}
               </option>)}
             </select>
             <button type="button" disabled={busy||!Number(newVariant)}
               onClick={()=>void add(Number(newVariant))}>Добавить к ревизии</button>
           </div>
           <WatchOperationInlineCatalog brand={brand} models={models} selectedModelId={null}
             onCancel={()=>setAdding(false)}
             onCreated={(_modelId,watchId)=>{onStockChanged();void add(watchId)}}/>
         </>}
       </div>
       <div className="client3-revision-save-actions">
         <button type="button" className="secondary" disabled={busy||invalid||!dirty}
           onClick={()=>void saveDirty()}>{busy?'Сохраняем…':'Сохранить введённые количества'}</button>
         <small>Можно закрыть страницу и вернуться позже. Сохранённые количества не изменяют остатки до завершения.</small>
       </div>
       {!reviewOpen?<div className="stocktake-e-review-actions">
         <button type="button" className="primary"
           disabled={busy||dirty||invalid||session.recountCount>0||!session.countedCount}
           onClick={()=>{setReviewOpen(true);setConfirmed(false)}}>
           Проверить результат ревизии
         </button>
       </div>:<div className="stocktake-e-review-list client3-revision-review">
         <div className="stocktake-e-review-head">
           <div><span className="stocktake-step-kicker">Шаг 3 · Проверка</span>
             <h4>Перед завершением</h4>
             <p>Незаполненные позиции не изменят системный остаток. Проверьте каждое введённое число.</p>
           </div>
           <button type="button" className="secondary compact" onClick={()=>{setReviewOpen(false);setConfirmed(false)}}>← Вернуться</button>
         </div>
         {session.items.filter(x=>x.countedQuantity!==null).map(item=>
           <div className="stocktake-e-review-row" key={item.id}>
             <div className="stocktake-e-review-name"><strong>{item.productName}</strong><span>{itemName(item)}</span></div>
             <div className="stocktake-e-review-quantity"><span>По системе</span><strong>{item.currentQuantity}</strong></div>
             <div className="stocktake-e-review-quantity"><span>Фактически</span><strong>{item.countedQuantity}</strong></div>
             <div className="stocktake-e-review-quantity"><span>Изменение</span>
               <strong>{Number(item.countedQuantity)-item.currentQuantity>0?'+':''}{Number(item.countedQuantity)-item.currentQuantity}</strong></div>
           </div>)}
         <p className="mini-panel-note">Проверено {session.countedCount} из {session.totalItems}. Без изменений останется {session.totalItems-session.countedCount} позиций.</p>
         <label className="client3-main-stock-confirm">
           <input type="checkbox" checked={confirmed} disabled={busy||dirty}
             onChange={e=>setConfirmed(e.target.checked)}/>
           Подтверждаю фактическое количество всех проверенных часов и применение результата к остаткам.
         </label>
         <div className="stocktake-e-review-actions">
           <button type="button" className="secondary" onClick={()=>{setReviewOpen(false);setConfirmed(false)}}>Исправить подсчёт</button>
           <button type="button" className="primary" disabled={busy||dirty||invalid||
             !confirmed||session.recountCount>0||!session.countedCount}
             onClick={()=>void finish()}>Завершить и применить ревизию</button>
         </div>
       </div>}
     </>}
     {session.status==='completed'&&showOutcome&&<div className="stocktake-outcome-card">
       <span className="stocktake-step-kicker">Проверка завершена</span>
       <h4>{source==='office'?'Офис':'Витрина'} · проверено {session.countedCount} позиций</h4>
       <p>Фактические количества применены; резервы заказов не переписывались.</p>
       <div className="stocktake-outcome-metrics">
         <div><span>Изменено позиций</span><strong>{session.items.filter(x=>x.appliedQuantity!==null&&x.appliedQuantity!==x.baselineQuantity).length}</strong></div>
         <div><span>Стало больше</span><strong>+{session.items.reduce((n,x)=>n+Math.max(0,Number(x.appliedQuantity??x.baselineQuantity)-x.baselineQuantity),0)}</strong></div>
         <div><span>Стало меньше</span><strong>−{session.items.reduce((n,x)=>n+Math.max(0,x.baselineQuantity-Number(x.appliedQuantity??x.baselineQuantity)),0)}</strong></div>
       </div>
       <button className="secondary compact" type="button"
         onClick={()=>{hydrate(null);setShowOutcome(false);onActiveChange(false)}}>
         Закрыть результат
       </button>
     </div>}
   </div>}
 </div>
}
