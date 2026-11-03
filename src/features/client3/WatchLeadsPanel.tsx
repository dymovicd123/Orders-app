import {useCallback,useEffect,useState,type InputHTMLAttributes} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LeadsSection} from '../sections/LeadsSection'
import {watchPeriod} from './useWatchAnalytics'

type Manager={id:number;name:string}
type Lead={id:number;date:string;managerId:number;manager:string;comment:string;
 acceptedCount:number;badCount:number;qualifiedCount:number;salesCount:number;conversionRate:number;
 callsMade:number;callsAccepted:number;fakeCount:number;refusalCount:number;potentialCount:number;
 callAcceptanceRate:number}
type Kind='leads'|'callCentre'
type Filter={dateFrom:string;dateTo:string}
type Response={ok:boolean;message?:string;rows:Lead[]}
type LeadDraft={id:number;date:string;managerId:number;managerName:string;acceptedCount:number;badCount:number;comment:string}
type CallDraft={id:number;date:string;managerId:number;managerName:string;
 acceptedLeads:number;callsMade:number;callsAccepted:number;fakeCount:number;refusalCount:number;potentialCount:number;comment:string}
const emptyLead=():LeadDraft=>({id:0,date:watchPeriod('today').from,managerId:0,
 managerName:'',acceptedCount:0,badCount:0,comment:''})
const emptyCall=():CallDraft=>({id:0,date:watchPeriod('today').from,managerId:0,
 managerName:'',acceptedLeads:0,callsMade:0,callsAccepted:0,fakeCount:0,
 refusalCount:0,potentialCount:0,comment:''})
function ManagerPicker({valueId,options,onChange}:{
 valueId:number;valueName?:string;options:Manager[];
 onChange:(manager:Manager|null)=>void
}){
 return <select value={valueId||0} onChange={e=>onChange(
   options.find(o=>o.id===Number(e.target.value))||null
 )}>
   <option value={0}>Выберите менеджера</option>
   {options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
 </select>
}
function ManagerBadge({name}: {name:string;colorKey?:string;compact?:boolean}){
 return <span className="manager-badge">{name||'Не указан'}</span>
}
function FriendlyNumberInput(props:InputHTMLAttributes<HTMLInputElement>){
 return <input {...props}/>
}
export function WatchLeadsPanel({brands,isAdmin}:{brands:readonly WatchBrand[];isAdmin:boolean}){
 const [brand,setBrand]=useState<WatchBrand>(brands[0]||'TAUWACH')
 const [leadMode,setLeadMode]=useState<Kind>('leads')
 const [leadFilters,setLeadFilters]=useState<Filter>(()=>({
  dateFrom:watchPeriod('month').from,dateTo:watchPeriod('month').to,
 }))
 const [managers,setManagers]=useState<Manager[]>([])
 const [leadRecords,setLeadRecords]=useState<Lead[]>([])
 const [callCentreRecords,setCallCentreRecords]=useState<Lead[]>([])
 const [leadDraft,setLeadDraft]=useState<LeadDraft>(emptyLead)
 const [callCentreDraft,setCallCentreDraft]=useState<CallDraft>(emptyCall)
 const [leadBusy,setLeadBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [version,setVersion]=useState(0)
 const load=useCallback(async(kind:Kind)=>{
   setLeadBusy(true);setError('')
   try{
    const q=new URLSearchParams({brand,kind,from:leadFilters.dateFrom,to:leadFilters.dateTo})
    const response=await fetch('/api/client3/watches/leads?'+q,{
      credentials:'include',cache:'no-store',
    })
    const data=await response.json() as Response
    if(!response.ok||!data.ok)throw Error(data.message||'Не удалось открыть журнал.')
    if(kind==='leads')setLeadRecords(data.rows||[]);else setCallCentreRecords(data.rows||[])
   }catch(e){setError(e instanceof Error?e.message:'Ошибка загрузки.')}
   finally{setLeadBusy(false)}
 },[brand,leadFilters.dateFrom,leadFilters.dateTo])
 useEffect(()=>{void load(leadMode)},[leadMode,load,version])
 useEffect(()=>{
   const abort=new AbortController()
   setManagers([])
   void fetch('/api/client3/watches/managers?'+new URLSearchParams({brand}),{
    credentials:'include',cache:'no-store',signal:abort.signal,
   }).then(async r=>{
    const d=await r.json() as {ok:boolean;managers?:Manager[]}
    if(r.ok&&d.ok&&!abort.signal.aborted)setManagers(d.managers||[])
   }).catch(()=>{})
   return ()=>abort.abort()
 },[brand])
 const request=async(kind:Kind,method:'POST'|'DELETE',body:Record<string,unknown>)=>{
   const response=await fetch('/api/client3/watches/leads',{
     method,credentials:'include',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({brand,kind,...body}),
   })
   const data=await response.json() as {ok:boolean;message?:string}
   if(!response.ok||!data.ok)throw Error(data.message||'Не удалось сохранить запись.')
 }
 const save=async(kind:Kind)=>{
   if(leadBusy)return
   setLeadBusy(true);setError('');setNotice('')
   try{
    if(kind==='leads'){
     const d=leadDraft
     await request(kind,'POST',{id:d.id,date:d.date,managerId:d.managerId,
      accepted_count:d.acceptedCount,bad_count:d.badCount,comment:d.comment})
     setLeadDraft(emptyLead())
    }else{
     const d=callCentreDraft
     await request(kind,'POST',{id:d.id,date:d.date,managerId:d.managerId,
      accepted_leads:d.acceptedLeads,calls_made:d.callsMade,calls_accepted:d.callsAccepted,
      fake_count:d.fakeCount,refusal_count:d.refusalCount,potential_count:d.potentialCount,comment:d.comment})
     setCallCentreDraft(emptyCall())
    }
    setNotice('Запись сохранена для бренда '+brand)
    setVersion(v=>v+1)
   }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить запись.')}
   finally{setLeadBusy(false)}
 }
 const remove=async(kind:Kind,id:number)=>{
   if(!window.confirm('Удалить запись? Созданные заказы не изменятся.'))return
   setLeadBusy(true);setError('')
   try{await request(kind,'DELETE',{id});setVersion(v=>v+1)}
   catch(e){setError(e instanceof Error?e.message:'Удаление не удалось.')}
   finally{setLeadBusy(false)}
 }
 const formatDateShort=(s:string)=>s.split('-').reverse().join('.')
 const ctx={
  callCentreDraft,callCentreRecords,deleteCallCentreRecord:(id:number)=>remove('callCentre',id),
  deleteLeadRecord:(id:number)=>remove('leads',id),
  editCallCentreRecord:(row:Lead)=>setCallCentreDraft({
   id:row.id,date:row.date,managerId:row.managerId,managerName:row.manager,
   acceptedLeads:row.acceptedCount,callsMade:row.callsMade,callsAccepted:row.callsAccepted,
   fakeCount:row.fakeCount,refusalCount:row.refusalCount,potentialCount:row.potentialCount,
   comment:row.comment,
  }),
  editLeadRecord:(row:Lead)=>setLeadDraft({
   id:row.id,date:row.date,managerId:row.managerId,managerName:row.manager,
   acceptedCount:row.acceptedCount,badCount:row.badCount,comment:row.comment,
  }),
  formatDateShort,formatLocalDateInput:()=>watchPeriod('today').from,
  formatPercent:(v:number)=>(v*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%',
  FriendlyNumberInput,getPeriodRange:(period:'month'|'year')=>({
   dateFrom:watchPeriod(period).from,dateTo:watchPeriod(period).to,
  }),
  leadBusy,leadDraft,leadFilters,leadMode,isAdmin,leadRecords,
  loadCallCentreRecords:()=>load('callCentre'),loadLeadRecords:()=>load('leads'),
  ManagerBadge,ManagerPicker,references:{managerOptions:managers},
  saveCallCentreRecord:()=>save('callCentre'),saveLeadRecord:()=>save('leads'),
  sectorStyle:()=>undefined,setCallCentreDraft,setLeadDraft,setLeadFilters,setLeadMode,
 }
 return <>
   <div className="card wide client3-leads-brand-bar">
     <div className="report-filter-row"><label>Бренд
       <select value={brand} onChange={e=>{
         setBrand(e.target.value as WatchBrand);setLeadDraft(emptyLead());setCallCentreDraft(emptyCall())
       }}>{brands.map(b=><option key={b} value={b}>{b}</option>)}</select>
     </label></div>
     <div className="muted-note">Журналы разделены по брендам. Продажи считаются из реальных заказов менеджера за день.</div>
   </div>
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   <LeadsSection ctx={ctx}/>
 </>
}
