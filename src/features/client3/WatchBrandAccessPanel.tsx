import { useCallback, useEffect, useRef, useState } from 'react'
import { WATCH_BRANDS, type WatchBrand } from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-staff.css'

type Staff={id:number;name:string;role:string;brands:WatchBrand[]}
type StaffResponse={ok:boolean;staff:Staff[];message?:string}
type WriteResponse={ok:boolean;message?:string}
const sorted=(brands:readonly WatchBrand[])=>[...new Set(brands)].sort()
async function api<T extends {ok:boolean;message?:string}>(url:string, init?:RequestInit):Promise<T>{
  const response=await fetch(url,{credentials:'include',cache:'no-store',...init})
  const result=await response.json() as T
  if(!response.ok||!result.ok)throw new Error(result.message||'Ошибка изменения доступа ('+response.status+')')
  return result
}

/** Only shown to authenticated administrators. The server independently enforces this. */
export function WatchBrandAccessPanel() {
  const [staff,setStaff]=useState<Staff[]>([])
  const [drafts,setDrafts]=useState<Record<number,WatchBrand[]>>({})
  const [busyId,setBusyId]=useState<number|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [refresh,setRefresh]=useState(0)
  const requests=useRef<Record<number,{fingerprint:string;requestId:string}>>({})
  useEffect(()=>{
    const abort=new AbortController()
    setLoading(true);setError('')
    void api<StaffResponse>('/api/client3/watches/staff',{signal:abort.signal})
      .then(value=>{
        if(abort.signal.aborted)return
        setStaff(value.staff||[])
        setDrafts(Object.fromEntries((value.staff||[]).map(row=>[row.id,sorted(row.brands)])))
      }).catch(cause=>{
        if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Не удалось получить сотрудников')
      }).finally(()=>{if(!abort.signal.aborted)setLoading(false)})
    return ()=>abort.abort()
  },[refresh])

  const toggle=(id:number,brand:WatchBrand,checked:boolean)=>{
    setNotice('')
    setDrafts(current=>{
      const list=current[id]||[]
      const single=staff.some(person=>person.id===id&&person.role==='Менеджер')
       return {...current,[id]:single?(checked?[brand]:[]):sorted(checked?[...list,brand]:list.filter(x=>x!==brand))}
    })
  }
  const save=useCallback(async(row:Staff)=>{
    if(busyId!==null)return
    const before=sorted(row.brands)
    const after=sorted(drafts[row.id]||[])
    const fingerprint=JSON.stringify([row.id,before,after])
    const stored=requests.current[row.id]
    if(stored?.fingerprint!==fingerprint)
      requests.current[row.id]={fingerprint,requestId:'brand-'+crypto.randomUUID()}
    setBusyId(row.id);setError('');setNotice('')
    try {
      await api<WriteResponse>('/api/client3/watches/staff/'+row.id+'/brands',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({brands:after,expectedBrands:before,requestId:requests.current[row.id].requestId}),
      })
      delete requests.current[row.id]
      setStaff(previous=>previous.map(person=>person.id===row.id?{...person,brands:after}:person))
      setNotice('Доступ сотрудника '+row.name+' обновлён.')
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить назначение')}
    finally{setBusyId(null)}
  },[busyId,drafts])

  return <section className="watch-staff">
    <header><div><h2>Бренды сотрудников</h2>
      <p>Менеджеры видят продажи только назначенных брендов. Для каждого изменения сохраняется аудит.</p>
    </div><button type="button" disabled={loading||busyId!==null}
      onClick={()=>setRefresh(n=>n+1)}>Обновить</button></header>
    {error&&<p role="alert" className="watch-staff-error">{error}</p>}
    {notice&&<p role="status" className="watch-staff-notice">{notice}</p>}
    {loading?<p>Загрузка сотрудников…</p>:
      staff.length===0?<p>Активных менеджеров нет.</p>:
      <div className="watch-staff-list">
        {staff.map(person=>{
          const after=sorted(drafts[person.id]||[])
          const dirty=JSON.stringify(after)!==JSON.stringify(sorted(person.brands))
          return <article key={person.id}>
            <strong>{person.name}</strong>
            <div className="watch-staff-choices">
              {WATCH_BRANDS.map(brand=><label key={brand}>
                <input type={person.role==='Менеджер'?'radio':'checkbox'}
                   name={person.role==='Менеджер'?'manager-brand-'+person.id:undefined}
                   checked={after.includes(brand)}
                  disabled={busyId!==null}
                  onChange={event=>toggle(person.id,brand,event.target.checked)}/>
                {brand}
              </label>)}
            </div>
            <button type="button" disabled={!dirty||busyId!==null}
              onClick={()=>void save(person)}>{busyId===person.id?'Сохраняю…':'Сохранить доступ'}</button>
          </article>
        })}
      </div>}
  </section>
}
