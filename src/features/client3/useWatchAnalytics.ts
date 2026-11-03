import {useEffect,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'

export type AnalyticsRow=Record<string,string|number|null>
export type WatchAnalytics={
  ok:boolean;message?:string;brandId:number;from:string;to:string;
  overview:{orderCount:number;totalSales:number;receivedFromOrders:number;
    periodDebt:number;returnedOnOrders:number;avgCheck:number};
  income:{incoming:number;outgoing:number;net:number};
  currentDebt:{orderCount:number;currentDebt:number};
  customers:{customerCount:number};
  logistics:{total:number;ready:number;engraving:number;overdue:number;urgent:number};
  days:AnalyticsRow[];managers:AnalyticsRow[];products:AnalyticsRow[];
  cities:AnalyticsRow[];methods:AnalyticsRow[];reconciliation:AnalyticsRow[];eventDays:AnalyticsRow[];
  events:AnalyticsRow[];sources:AnalyticsRow[];
}
export const watchMoney=(n:unknown)=>
  Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₸'
export const watchNumber=(n:unknown)=>
  Number(n||0).toLocaleString('ru-RU')
export const localDate=()=>{
  const current=new Date()
  // Local Almaty date (UTC+05), not the browser's host timezone.
  return new Date(current.getTime()+5*3600*1000).toISOString().slice(0,10)
}
export function watchPeriod(which:'today'|'yesterday'|'month'|'year'):{
  from:string;to:string
}{
  const today=localDate()
  if(which==='today')return {from:today,to:today}
  if(which==='yesterday'){
    const day=new Date(today+'T00:00:00Z')
    day.setUTCDate(day.getUTCDate()-1)
    const previous=day.toISOString().slice(0,10)
    return {from:previous,to:previous}
  }
  if(which==='year')return {from:today.slice(0,4)+'-01-01',to:today}
  return {from:today.slice(0,7)+'-01',to:today}
}
export function useWatchAnalytics(brand:WatchBrand,from:string,to:string){
 const [data,setData]=useState<WatchAnalytics|null>(null)
 const [busy,setBusy]=useState(true)
 const [error,setError]=useState('')
 const [revision,setRevision]=useState(0)
 useEffect(()=>{
   const abort=new AbortController()
   setBusy(true);setError('');setData(null)
   const params=new URLSearchParams({brand,from,to})
   void fetch('/api/client3/watches/analytics?'+params,{
     credentials:'include',cache:'no-store',signal:abort.signal,
   }).then(async res=>{
     const value=await res.json() as WatchAnalytics
     if(!res.ok||!value.ok)throw Error(value.message||'Не удалось загрузить отчёт.')
     if(!abort.signal.aborted)setData(value)
   }).catch(e=>{if(!abort.signal.aborted)setError(
     e instanceof Error?e.message:'Не удалось загрузить данные.')})
     .finally(()=>{if(!abort.signal.aborted)setBusy(false)})
   return ()=>abort.abort()
 },[brand,from,to,revision])
 return {data,busy,error,refresh:()=>setRevision(i=>i+1)}
}
