import {useCallback,useEffect,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {watchMoney,watchPeriod} from './useWatchAnalytics'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
type Manager={id:number;name:string}
type Plan={id:number;periodStart:string;periodEnd:string;managerId?:number;manager?:string;
 plannedAmount:number;factAmount:number;completionRate:number;salaryBase?:number;
 bonusHitPercent?:number;bonusMissPercent?:number;bonusAmount?:number;totalSalary?:number;
 comment:string;updatedAt:string}
type Response={ok:boolean;message?:string;managerPlans:Plan[];departmentPlans:Plan[]}
function monthDates(){const p=watchPeriod('month');const date=new Date(p.from+'T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(0);return {from:p.from,to:date.toISOString().slice(0,10)}}
const percent=(n:number)=>(n*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%'
type Draft={id:number;periodStart:string;periodEnd:string;plannedAmount:number;comment:string;
 managerId:number;salaryBase:number;bonusHitPercent:number;bonusMissPercent:number}
function blank():Draft{const p=monthDates();return {id:0,periodStart:p.from,periodEnd:p.to,
 plannedAmount:0,comment:'',managerId:0,salaryBase:0,bonusHitPercent:5,bonusMissPercent:3}}
function exportWord(name:string,element:HTMLElement|null){
 if(!element)return
 const blob=new Blob(['<html><meta charset="utf-8"><body>'+element.outerHTML+'</body></html>'],{type:'application/msword'})
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url
 link.download=name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9- ]/g,'')+'.doc'
 link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function WatchPlansPanel({brands,isAdmin}:{brands:readonly WatchBrand[];isAdmin:boolean}){
 const [brand,setBrand]=useState<WatchBrand>(brands[0]||'TAUWACH')
 const [period,setPeriod]=useState(monthDates)
 const [managerDraft,setManagerDraft]=useState<Draft>(blank)
 const [departmentDraft,setDepartmentDraft]=useState<Draft>(blank)
 const [managers,setManagers]=useState<Manager[]>([])
 const [report,setReport]=useState<Response|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [version,setVersion]=useState(0)
 const refresh=()=>setVersion(v=>v+1)
 const data=useCallback(async(path:string,init?:RequestInit)=>{
  const result=await fetch(path,{credentials:'include',cache:'no-store',...init})
  const value=await result.json() as {ok:boolean;message?:string}
  if(!result.ok||!value.ok)throw Error(value.message||'Ошибка загрузки.')
  return value
 },[])
 useEffect(()=>{
  const ac=new AbortController()
  setBusy(true);setError('');setReport(null)
  const q=new URLSearchParams({brand,from:period.from,to:period.to})
  void fetch('/api/client3/watches/plans?'+q,{credentials:'include',cache:'no-store',signal:ac.signal})
   .then(async r=>{const v=await r.json() as Response
     if(!r.ok||!v.ok)throw Error(v.message||'Планы недоступны.')
     if(!ac.signal.aborted)setReport(v)
   }).catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:'Ошибка загрузки.')})
   .finally(()=>{if(!ac.signal.aborted)setBusy(false)})
  return ()=>ac.abort()
 },[brand,period.from,period.to,version])
 useEffect(()=>{
  const ac=new AbortController()
  void fetch('/api/client3/watches/managers?'+new URLSearchParams({brand}),{
    credentials:'include',signal:ac.signal,cache:'no-store',
  }).then(async r=>{
   const v=await r.json() as {ok:boolean;managers?:Manager[]}
   if(r.ok&&v.ok&&!ac.signal.aborted)setManagers(v.managers||[])
  }).catch(()=>{if(!ac.signal.aborted)setManagers([])})
  return ()=>ac.abort()
 },[brand])
 const save=async(kind:'manager'|'department',draft:Draft)=>{
  if(busy)return
  setBusy(true);setError('');setNotice('')
  try{
   await data('/api/client3/watches/plans',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({brand,kind,...draft})})
   if(kind==='manager')setManagerDraft(blank());else setDepartmentDraft(blank())
   setNotice('Денежный план сохранён. Факт рассчитывается по реальным оплатам и возвратам.')
   refresh()
  }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить план.')}finally{setBusy(false)}
 }
 const remove=async(kind:'manager'|'department',id:number)=>{
  if(!window.confirm('Удалить запись плана? История заказов и денег не изменится.'))return
  setBusy(true);setError('')
  try{
   await data('/api/client3/watches/plans',{method:'DELETE',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({brand,kind,id})})
   refresh()
  }catch(e){setError(e instanceof Error?e.message:'Удаление не удалось.')}
  finally{setBusy(false)}
 }
 const edit=(row:Plan,kind:'manager'|'department')=>{
  const draft={id:row.id,periodStart:row.periodStart,periodEnd:row.periodEnd,
    managerId:Number(row.managerId||0),plannedAmount:row.plannedAmount,
    salaryBase:Number(row.salaryBase||0),bonusHitPercent:Number(row.bonusHitPercent||5),
    bonusMissPercent:Number(row.bonusMissPercent||3),comment:row.comment||''}
  if(kind==='manager')setManagerDraft(draft);else setDepartmentDraft(draft)
  window.scrollTo({top:0,behavior:'smooth'})
 }
 const fields=(draft:Draft,set:(next:Draft)=>void,manager:boolean)=>
   <div className={'form-grid compact-form '+(!manager?'department-plan-box':'')}>
     <label>Начало<input type="date" required value={draft.periodStart}
       onChange={e=>set({...draft,periodStart:e.target.value})}/></label>
     <label>Конец<input type="date" required value={draft.periodEnd}
       onChange={e=>set({...draft,periodEnd:e.target.value})}/></label>
     {manager&&<label>Менеджер<select required value={draft.managerId}
       onChange={e=>set({...draft,managerId:Number(e.target.value)})}>
       <option value={0}>Выберите менеджера</option>
       {managers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
     </select></label>}
     <label>{manager?'План менеджера':'План отдела'}<input type="number" min={0}
       required value={draft.plannedAmount} onChange={e=>set({...draft,plannedAmount:Number(e.target.value)})}/></label>
     {manager&&<>
       <label>Оклад<input type="number" min={0} value={draft.salaryBase}
         onChange={e=>set({...draft,salaryBase:Number(e.target.value)})}/></label>
       <div className="wide-field fixed-bonus-note">Бонус от фактического поступления: выполнен план — 5%, не выполнен — 3%. Деньги учитываются по дате операции.</div>
     </>}
     <label className="span-2">Комментарий<input value={draft.comment}
       onChange={e=>set({...draft,comment:e.target.value})}/></label>
   </div>
 return <article className="card wide sector-plan" id="plan">
   <div className="card-label">План</div>
   <div className="card-meta">Денежный план отдела и менеджеров по образцу Main. Без KPI. Каждый бренд считается отдельно.</div>
   <div className="report-filter-row">
     <label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);
       setManagerDraft(blank());setDepartmentDraft(blank())}}>
       {brands.map(x=><option value={x} key={x}>{x}</option>)}</select></label>
   </div>
   {error&&<p className="app-alert error" role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   {isAdmin&&<>
     <h3>План менеджера</h3>{fields(managerDraft,setManagerDraft,true)}
     <div className="button-row"><button className="primary" type="button" disabled={busy||!managerDraft.managerId}
       onClick={()=>void save('manager',managerDraft)}>{managerDraft.id?'Обновить':'Сохранить'} план менеджера</button>
       {managerDraft.id>0&&<button className="secondary" onClick={()=>setManagerDraft(blank())}>Новая запись</button>}
     </div>
     <h3>План отдела</h3>{fields(departmentDraft,setDepartmentDraft,false)}
     <div className="button-row"><button className="secondary" type="button" disabled={busy}
       onClick={()=>void save('department',departmentDraft)}>{departmentDraft.id?'Обновить':'Сохранить'} план отдела</button>
       {departmentDraft.id>0&&<button className="secondary" onClick={()=>setDepartmentDraft(blank())}>Новая запись</button>}
     </div>
   </>}
   <div className="report-filter-row">
     <label>Начало отчёта<input type="date" value={period.from}
       onChange={e=>setPeriod(x=>({...x,from:e.target.value}))}/></label>
     <label>Конец отчёта<input type="date" value={period.to}
       onChange={e=>setPeriod(x=>({...x,to:e.target.value}))}/></label>
     <button className="secondary compact" onClick={()=>setPeriod(monthDates())}>Месяц</button>
     <button className="secondary compact" onClick={()=>setPeriod({from:watchPeriod('year').from,to:watchPeriod('year').to})}>Год</button>
     <button className="primary compact" disabled={busy} onClick={refresh}>{busy?'Загружаю…':'Показать выполнение'}</button>
     <button className="secondary compact" type="button"
       onClick={()=>exportWord(brand+'-План',document.getElementById('client3-plan-report'))}>Скачать Word</button>
     <button className="secondary compact" type="button" onClick={()=>window.print()}>PDF / печать</button>
   </div>
   <div className="fixed-bonus-note plan-calculation-note"><strong>Факт:</strong> поступления минус возвраты по реальным денежным событиям выбранного периода. Расчёт независим от даты создания плана.</div>
   <div id="client3-plan-report" className="report-grid two-columns">
     <section className="report-block"><h3>Планы менеджеров</h3>
       <LinkedTableScroll ariaLabel="Денежные планы менеджеров"><table className="data-table">
         <thead><tr><th>Период</th><th>Менеджер</th><th>План</th><th>Факт</th><th>%</th><th>Оклад</th><th>Бонус</th><th>Итого</th><th className="export-hide">Действия</th></tr></thead>
         <tbody>{(report?.managerPlans||[]).map(row=><tr key={row.id}>
           <td>{row.periodStart} — {row.periodEnd}</td><td>{row.manager}</td>
           <td>{watchMoney(row.plannedAmount)}</td><td>{watchMoney(row.factAmount)}</td>
           <td>{percent(row.completionRate)}</td><td>{watchMoney(row.salaryBase)}</td>
           <td>{watchMoney(row.bonusAmount)}</td><td>{watchMoney(row.totalSalary)}</td>
           <td className="export-hide">{isAdmin&&<div className="row-actions compact-actions">
             <button className="secondary compact" onClick={()=>edit(row,'manager')}>Редактировать</button>
             <button className="ghost danger compact" onClick={()=>void remove('manager',row.id)}>Удалить</button>
           </div>}</td>
         </tr>)}
         {!report?.managerPlans.length&&<tr><td colSpan={9} className="empty-state">Планов менеджеров пока нет.</td></tr>}
         </tbody>
       </table></LinkedTableScroll>
     </section>
     <section className="report-block"><h3>План отдела</h3>
       <LinkedTableScroll ariaLabel="План отдела"><table className="data-table">
         <thead><tr><th>Период</th><th>План</th><th>Факт</th><th>%</th><th className="export-hide">Действия</th></tr></thead>
         <tbody>{(report?.departmentPlans||[]).map(row=><tr key={row.id}>
           <td>{row.periodStart} — {row.periodEnd}</td>
           <td>{watchMoney(row.plannedAmount)}</td><td>{watchMoney(row.factAmount)}</td>
           <td>{percent(row.completionRate)}</td>
           <td className="export-hide">{isAdmin&&<div className="row-actions compact-actions">
             <button className="secondary compact" onClick={()=>edit(row,'department')}>Редактировать</button>
             <button className="ghost danger compact" onClick={()=>void remove('department',row.id)}>Удалить</button>
           </div>}</td></tr>)}
           {!report?.departmentPlans.length&&<tr><td colSpan={5} className="empty-state">Плана отдела пока нет.</td></tr>}
         </tbody>
       </table></LinkedTableScroll>
     </section>
   </div>
 </article>
}
