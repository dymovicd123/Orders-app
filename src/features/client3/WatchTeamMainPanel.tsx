import {useEffect,useRef,useState,type FormEvent} from 'react'
import {WATCH_BRANDS,type WatchBrand} from '../../../shared/client3/watch-domain'
import {watchMoney,watchPeriod} from './useWatchAnalytics'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {WatchUserAccessPanel} from './WatchUserAccessPanel'
import {WatchTimesheetWorkspace} from './WatchTimesheetWorkspace'
import '../../styles/client3-watch-staff.css'
import '../../styles/client3-main-team.css'

type Account={id:number;login:string;role:string;isActive:number;mustChangePassword:number}
type Employee={id:number;name:string;role:string;phone:string;comment:string;
 colorKey:string;hiredAt:string;birthDate?:string;dismissedAt?:string;
 isActive:boolean;brands:WatchBrand[];allBrandsLogistics?:boolean;access:Account|null;referenceCount:number}
type TeamData={ok:boolean;message?:string;employees:Employee[];stats:{active:number;inactive:number}}
type Draft={id:number;name:string;role:string;phone:string;comment:string;
 colorKey:string;hiredAt:string;birthDate:string;brands:WatchBrand[];
 createAccount:boolean;login:string;password:string;mustChangePassword:boolean}
type View='employees'|'timesheet'|'plan'|'salary'|'activity'|'accounts'
type Timesheet={ok:boolean;message?:string;month:string;employees:Array<{id:number;name:string}>;
 entries:Array<{id:number;date:string;managerId:number;workUntil:string;comment:string}>}
type MoneyRow={id:number;periodStart:string;periodEnd:string;plannedAmount:number;factAmount:number;
 completionRate:number;manager?:string;managerId?:number;bonusAmount?:number}
type Plans={ok:boolean;departmentPlans:MoneyRow[];managerPlans:MoneyRow[];message?:string}
type SalaryRow={managerId:number;manager:string;role:string;workDays:number;plannedAmount:number;
 factAmount:number;salaryBase:number;bonusAmount:number;totalSalary:number;completionRate:number|null}
type ActivityRow={managerId:number;manager:string;role:string;ordersCount:number;salesTotal:number;sentOrders:number}
const palette=['#2563EB','#7C3AED','#0F766E','#C2410C','#A21CAF','#0369A1','#4338CA','#B45309','#BE185D','#475569','#0891B2','#6D28D9']
const month=()=>watchPeriod('month')
const empty=():Draft=>({id:0,name:'',role:'Менеджер',phone:'',comment:'',
 colorKey:palette[0],hiredAt:watchPeriod('today').from,birthDate:'',brands:[],
 createAccount:true,login:'',password:'',mustChangePassword:true})
const suggestLogin=(name:string,employees:Employee[])=>{
 const chars:Record<string,string>={
  А:'a',Б:'b',В:'v',Г:'g',Д:'d',Е:'e',Ё:'e',Ж:'zh',З:'z',И:'i',Й:'i',
  К:'k',Л:'l',М:'m',Н:'n',О:'o',П:'p',Р:'r',С:'s',Т:'t',У:'u',Ф:'f',
  Х:'h',Ц:'ts',Ч:'ch',Ш:'sh',Щ:'sh',Ы:'y',Э:'e',Ю:'yu',Я:'ya',
  Ә:'a',Ғ:'g',Қ:'q',Ң:'n',Ө:'o',Ұ:'u',Ү:'u',Һ:'h',І:'i'}
 const base=[...name.trim().toUpperCase()].map(ch=>/[A-Z0-9]/.test(ch)?ch.toLowerCase():
  chars[ch]||(/[-_.\s]/.test(ch)?'.':'')).join('')
  .replace(/\.+/g,'.').replace(/^\.|\.$/g,'').slice(0,24)||'manager'
 const used=new Set(employees.map(x=>String(x.access?.login||'').toLowerCase()))
 if(!used.has(base))return base
 let suffix=2;while(used.has(base+suffix))suffix++
 return base+suffix
}
const fmt=(s:string)=>s?s.slice(0,10).split('-').reverse().join('.'):'—'
const percent=(value:number|null)=>value===null?'—':(value*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%'
async function api<T extends {ok:boolean;message?:string}>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(path,{credentials:'include',cache:'no-store',...init})
 const value=await response.json() as T
 if(!response.ok||!value.ok)throw Error(value.message||'Не удалось выполнить операцию.')
 return value
}
const json=(body:unknown)=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
export function WatchTeamMainPanel({initialMode='employees'}:{initialMode?:View}){
 const [mode,setMode]=useState<View>(initialMode)
 const [data,setData]=useState<TeamData|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [revision,setRevision]=useState(0)
 const [rosterView,setRosterView]=useState<'active'|'former'>('active')
 const [draft,setDraft]=useState<Draft|null>(null)
 const [brandEditor,setBrandEditor]=useState<number|null>(null)
 const [brandDraft,setBrandDraft]=useState<WatchBrand[]>([])
 const [accountEditor,setAccountEditor]=useState<Employee|null>(null)
 const [accountTargetId,setAccountTargetId]=useState(0)
 const [accountDraft,setAccountDraft]=useState({login:'',password:'',isActive:true,role:'manager'})
 const [saving,setSaving]=useState(false)
 const [period,setPeriod]=useState(month)
 const [reportBrand,setReportBrand]=useState<WatchBrand>('TAUWACH')
 const [plans,setPlans]=useState<Plans|null>(null)
 const [salary,setSalary]=useState<SalaryRow[]>([])
 const [activity,setActivity]=useState<ActivityRow[]>([])
 const [timesheetMonth,setTimesheetMonth]=useState(watchPeriod('month').from.slice(0,7))
 const [timesheet,setTimesheet]=useState<Timesheet|null>(null)
 const [selectedDays,setSelectedDays]=useState<string[]>([])
 const [selectedManagers,setSelectedManagers]=useState<number[]>([])
 const [workUntil,setWorkUntil]=useState('')
 const [timeComment,setTimeComment]=useState('')
 const formRef=useRef<HTMLElement|null>(null)
 const refresh=()=>setRevision(x=>x+1)
 useEffect(()=>{
  const abort=new AbortController()
  setLoading(true);setError('')
  void fetch('/api/client3/watches/team',{credentials:'include',cache:'no-store',signal:abort.signal})
   .then(async r=>{
    const d=await r.json() as TeamData
    if(!r.ok||!d.ok)throw Error(d.message||'Не удалось загрузить команду.')
    if(!abort.signal.aborted)setData(d)
   }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Ошибка команды.')})
   .finally(()=>{if(!abort.signal.aborted)setLoading(false)})
  return ()=>abort.abort()
 },[revision])
 useEffect(()=>{
  const abort=new AbortController()
  if(mode==='timesheet'){
   setTimesheet(null)
   void fetch('/api/client3/watches/team/timesheet?'+new URLSearchParams({month:timesheetMonth}),{
     credentials:'include',cache:'no-store',signal:abort.signal,
   }).then(async r=>{const d=await r.json() as Timesheet
     if(!r.ok||!d.ok)throw Error(d.message||'Не удалось загрузить табель.')
     if(!abort.signal.aborted)setTimesheet(d)
   }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Ошибка табеля.')})
  }
  if(mode==='salary'||mode==='activity'){
   const url='/api/client3/watches/team/'+(mode==='salary'?'salary':'activity')+'?'+
     new URLSearchParams({from:period.from,to:period.to})
   void fetch(url,{credentials:'include',signal:abort.signal,cache:'no-store'})
     .then(async r=>{const d=await r.json() as {ok:boolean;message?:string;rows:unknown[]}
       if(!r.ok||!d.ok)throw Error(d.message||'Ошибка отчёта.')
       if(!abort.signal.aborted){if(mode==='salary')setSalary(d.rows as SalaryRow[])
         else setActivity(d.rows as ActivityRow[])}
     }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Ошибка отчёта.')})
  }
  if(mode==='plan'){
   void fetch('/api/client3/watches/plans?'+new URLSearchParams({
     brand:reportBrand,from:period.from,to:period.to,
   }),{credentials:'include',cache:'no-store',signal:abort.signal})
     .then(async r=>{const d=await r.json() as Plans
       if(!r.ok||!d.ok)throw Error(d.message||'План недоступен.')
       if(!abort.signal.aborted)setPlans(d)
     }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Ошибка планов.')})
  }
  return ()=>abort.abort()
 },[mode,period.from,period.to,reportBrand,timesheetMonth,revision])
 const employees=data?.employees||[]
 const active=employees.filter(x=>x.isActive),former=employees.filter(x=>!x.isActive)
 const listed=rosterView==='active'?active:former
 const saveEmployee=async(e:FormEvent)=>{
   e.preventDefault();if(!draft||saving)return
   setSaving(true);setError('');setNotice('')
   try{
     const res=await api<{ok:boolean;id:number;accessCreated?:boolean}>('/api/client3/watches/team/employees',{
       method:'POST',...json(draft),
     })
     const newId=res.id
     // For new people, both the brand memberships and temporary login were
     // committed with the employee in one server transaction. Edits retain the
     // existing guarded brand-change endpoint.
     if(draft.id){
       const before=employees.find(x=>x.id===newId)?.brands||[]
       const after=draft.role==='Логист'?[]:draft.brands
       if(draft.role!=='Логист'&&JSON.stringify([...before].sort())!==JSON.stringify([...after].sort())){
         await api('/api/client3/watches/staff/'+newId+'/brands',{
           method:'POST',...json({brands:after,expectedBrands:before,
             requestId:'team-'+crypto.randomUUID()}),
         })
       }
     }
     setDraft(null)
     setNotice(draft.id?'Данные сотрудника сохранены.':
       draft.createAccount?'Сотрудник, его бренды и вход созданы за одно сохранение. Передайте временный пароль лично.':
       'Сотрудник и его бренды созданы. Вход можно добавить позже.')
     refresh()
   }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить сотрудника.');refresh()}
   finally{setSaving(false)}
 }
 const employment=async(person:Employee,activate:boolean)=>{
   if(!activate&&!window.confirm('Перенести '+person.name+' в бывшие сотрудники и отключить вход? Исторические заказы останутся.'))return
   setSaving(true);setError('');setNotice('')
   try{
    await api('/api/client3/watches/team/employees/'+person.id+'/status',{
     method:'PATCH',...json({isActive:activate}),
    })
    setNotice(activate?'Сотрудник восстановлен. Доступ к входу включается отдельно.':'Сотрудник перенесён в бывшие. История сохранена.')
    refresh()
   }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить статус.')}
   finally{setSaving(false)}
 }
 const saveBrands=async(person:Employee)=>{
  setSaving(true);setError('');setNotice('')
  try{
   await api('/api/client3/watches/staff/'+person.id+'/brands',{
     method:'POST',...json({brands:brandDraft,expectedBrands:person.brands,
       requestId:'team-brands-'+crypto.randomUUID()}),
   })
   setNotice('Бренды для '+person.name+' сохранены.');setBrandEditor(null);refresh()
  }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить бренды.')}
  finally{setSaving(false)}
 }
 const openAccount=(person:Employee)=>{
  setAccountEditor(person)
  setAccountTargetId(person.id)
  setAccountDraft({login:person.access?.login||'',password:'',
   isActive:person.access?Boolean(person.access.isActive):true,
   role:person.access?.role|| (person.role==='Админ'?'admin':'manager')})
 }
 const saveAccount=async(e:FormEvent)=>{
  e.preventDefault();if(!accountEditor||saving)return
  setSaving(true);setError('');setNotice('')
  try{
   const existing=accountEditor.access
   await api(existing?'/api/auth/users/'+existing.id:'/api/auth/users',{
    method:existing?'PATCH':'POST',
    ...json({login:accountDraft.login.trim().toLowerCase(),managerId:accountEditor.id,
     role:accountDraft.role,displayName:accountEditor.name,
     isActive:accountDraft.isActive,
     ...(accountDraft.password?{password:accountDraft.password}:{})}),
   })
   setNotice('Учётная запись сотрудника сохранена.');setAccountEditor(null);refresh()
  }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить доступ.')}
  finally{setSaving(false)}
 }
 const saveTimesheet=async(clear:boolean)=>{
  if(!selectedDays.length||(!clear&&!selectedManagers.length))return
  setSaving(true);setError('');setNotice('')
  try{
   await api('/api/client3/watches/team/timesheet',{method:'POST',...json({
    dates:selectedDays,managerIds:selectedManagers,workUntil,comment:timeComment,clear,
   })})
   setNotice(clear?'Выбранные дни очищены.':'Табель сохранён.')
   setSelectedDays([]);refresh()
  }catch(e){setError(e instanceof Error?e.message:'Ошибка сохранения табеля.')}
  finally{setSaving(false)}
 }
 return <article className="card wide sector-team client3-team-main" id="team">
   <div className="card-label">Команда</div>
   <div className="card-meta">Сотрудники и доступ как в Main: действующие, бывшие, табель, выполнение плана, зарплата и работа с заказами. Оба бренда — одна команда.</div>
   <div className="summary-grid compact-summary team-summary-clean">
     <div className="summary-card"><span>Активных</span><strong>{data?active.length:'—'}</strong></div>
     <div className="summary-card"><span>Бывших</span><strong>{data?former.length:'—'}</strong></div>
     <div className="summary-card"><span>С доступом</span><strong>{data?employees.filter(e=>Boolean(e.access?.isActive)).length:'—'}</strong></div>
   </div>
   <div className="order-panel-tabs team-mode-tabs" role="tablist" aria-label="Раздел команды">
     {([
       ['employees','Сотрудники'],['timesheet','Табель'],['plan','Выполнение плана'],
       ['salary','Зарплата'],['activity','Работа с заказами'],['accounts','Учётные записи'],
     ] as const).map(([key,label])=><button key={key} type="button"
       className={'secondary compact '+(mode===key?'is-active':'')}
       onClick={()=>{setMode(key);setError('')}}>{label}</button>)}
   </div>
   {error&&<div className="app-alert error" role="alert">
     <strong>Не удалось загрузить данные команды.</strong> {error}
     <button type="button" className="secondary compact" disabled={loading}
       onClick={refresh}>Повторить загрузку</button>
     {!data&&<p>Пока база не ответила, количество сотрудников неизвестно. Данные не удалены.</p>}
   </div>}
   {notice&&<div className="app-alert success" role="status">{notice}</div>}
   {loading&&<p role="status">Загружаю сотрудников…</p>}
   {mode==='employees'&&<>
     <div className="team-roster-toolbar">
       <div className="team-roster-tabs" role="tablist" aria-label="Состав команды">
         <button type="button" className={'secondary compact '+(rosterView==='active'?'is-active':'')}
           onClick={()=>setRosterView('active')}>Активные ({data?active.length:'—'})</button>
         <button type="button" className={'secondary compact '+(rosterView==='former'?'is-active':'')}
           onClick={()=>setRosterView('former')}>Бывшие ({data?former.length:'—'})</button>
       </div>
       <button className="primary compact" type="button" disabled={!data||loading} onClick={()=>{
         setDraft({...empty(),colorKey:palette[employees.length%palette.length]})
         window.requestAnimationFrame(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}))
       }}>+ Добавить сотрудника</button>
     </div>
     {draft&&<section className="mini-panel team-editor-panel" ref={formRef}>
       <div className="mini-panel-head"><div><h3>{draft.id?'Редактирование сотрудника':'Новый сотрудник'}</h3>
         <p className="mini-panel-note">{draft.id?
           'Измените сотрудника. Вход в систему можно изменить отдельно в его строке.':
           'Создайте сотрудника, назначьте бренды и сразу задайте логин и временный пароль.'}</p></div>
         <button className="secondary compact" onClick={()=>setDraft(null)} type="button">Закрыть</button></div>
       <form onSubmit={e=>void saveEmployee(e)}>
         <div className="form-grid compact-form team-editor-grid">
           <label>Имя сотрудника<input required value={draft.name} maxLength={80}
             onChange={e=>setDraft({...draft,name:e.target.value})}
             onBlur={()=>{if(!draft.id&&draft.createAccount&&!draft.login.trim())
               setDraft(d=>d?{...d,login:suggestLogin(d.name,employees)}:d)}}
             placeholder="Например: АСЕЛЬ"/></label>
           <label>Роль<select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value,
             brands:e.target.value==='Логист'?[]:draft.brands})}>
             {['Менеджер','Логист','Завсклад','Админ'].map(role=>
               <option value={role} key={role}>{role}</option>)}
           </select></label>
           <label>Дата начала<input type="date" value={draft.hiredAt}
             onChange={e=>setDraft({...draft,hiredAt:e.target.value})}/></label>
           <label>Дата рождения<input type="date" max={watchPeriod('today').from}
             value={draft.birthDate} onChange={e=>setDraft({...draft,birthDate:e.target.value})}/></label>
           <label>Контакт<input value={draft.phone} maxLength={100}
             onChange={e=>setDraft({...draft,phone:e.target.value})}/></label>
           <label className="span-2">Цвет сотрудника
             <span className="manager-color-picker" role="group" aria-label="Цвет сотрудника">
               {palette.map(color=><button type="button" key={color}
                 className={'manager-color-choice '+(draft.colorKey===color?'is-selected':'')}
                 style={{backgroundColor:color}} aria-label={'Цвет '+color}
                 onClick={()=>setDraft({...draft,colorKey:color})}/>)}
               <input type="color" value={draft.colorKey} aria-label="Свой цвет"
                 onChange={e=>setDraft({...draft,colorKey:e.target.value})}/>
             </span>
           </label>
           {draft.role==='Логист'?<p className="span-2 mini-panel-note">
             Логист работает с заказами и отправками TAUWACH и WACHIZEN одновременно. Назначать бренды не нужно.
           </p>:<label className="span-2">Бренды
             <span className="team-brand-choices">{WATCH_BRANDS.map(brand=><label key={brand}>
               <input type="checkbox" checked={draft.brands.includes(brand)}
                 onChange={e=>setDraft({...draft,brands:e.target.checked?
                   [...draft.brands,brand]:draft.brands.filter(v=>v!==brand)})}/>
               {brand}</label>)}</span>
           </label>}
           <label className="span-2">Комментарий<input value={draft.comment} maxLength={500}
             onChange={e=>setDraft({...draft,comment:e.target.value})}/></label>
           {!draft.id&&<section className="span-2 team-access-onboarding client3-access-onboarding">
             <div className="team-access-onboarding-head">
               <div><strong>Вход в систему</strong>
                 <span>Логин связывается с сотрудником: заказы и действия принадлежат именно ему.</span>
               </div>
               <label className="team-access-toggle"><input type="checkbox"
                 checked={draft.createAccount}
                 onChange={e=>setDraft({...draft,createAccount:e.target.checked})}/>
                 <span>Создать доступ сразу</span>
               </label>
             </div>
             {draft.createAccount?<div className="team-access-onboarding-fields">
               <label>Логин<input autoComplete="off" minLength={3} maxLength={32}
                 required value={draft.login}
                 onChange={e=>setDraft({...draft,login:e.target.value.toLowerCase()})}
                 placeholder={suggestLogin(draft.name,employees)}/><small>
                   Латинские буквы и цифры. Предложенный логин: @{suggestLogin(draft.name,employees)}
                 </small></label>
               <label>Временный пароль<input autoComplete="new-password" type="password"
                 required minLength={8} value={draft.password}
                 onChange={e=>setDraft({...draft,password:e.target.value})}
                 placeholder="Не менее 8 символов"/><small>
                   Передайте пароль сотруднику лично.
                 </small></label>
               <label className="checkbox-row team-access-force-change"><input type="checkbox"
                 checked={draft.mustChangePassword}
                 onChange={e=>setDraft({...draft,mustChangePassword:e.target.checked})}/>
                 Потребовать сменить пароль при первом входе</label>
             </div>:<p className="mini-panel-note">Вход можно создать позднее из карточки сотрудника.</p>}
           </section>}
         </div>
         <div className="button-row"><button type="submit" className="primary" disabled={saving}>
           {saving?'Сохраняю…':draft.id?'Сохранить изменения':'Создать сотрудника'}</button>
           <button type="button" className="secondary" onClick={()=>setDraft(null)}>Отмена</button></div>
       </form>
     </section>}
     <p className="team-roster-note">{rosterView==='active'?
       'Здесь действующие сотрудники. Увольнение не удаляет их заказы и другие исторические записи.':
       'У бывших сотрудников сохранены история заказов, планы и связи с аккаунтами.'}</p>
     <LinkedTableScroll ariaLabel="Состав команды">
       <table className="data-table team-roster-table">
         <thead><tr><th>Сотрудник</th><th>Роль</th><th>Первый заказ / начало</th>
           <th>Цвет</th><th>Бренды</th><th>Доступ</th><th>Действия</th></tr></thead>
         <tbody>{listed.map(person=><tr key={person.id}>
           <td><div className="team-person-cell"><strong className="team-roster-person">
             <span className="manager-color-dot" style={{backgroundColor:person.colorKey}}/>{person.name}</strong>
             {person.phone&&<small>{person.phone}</small>}
             {person.birthDate&&<small>Дата рождения: {fmt(person.birthDate)}</small>}</div></td>
           <td>{person.role}</td><td>{fmt(person.hiredAt)}</td>
           <td><span className="manager-color-dot" style={{backgroundColor:person.colorKey}}/></td>
           <td>{person.allBrandsLogistics||person.role==='Логист'?
             <div className="team-brands-cell"><strong>Оба бренда</strong>
               <small>Логистика · без привязки</small></div>:
             brandEditor===person.id?
             <div className="team-brand-edit">
               {WATCH_BRANDS.map(b=><label key={b}><input type="checkbox"
                 checked={brandDraft.includes(b)} onChange={e=>setBrandDraft(v=>
                   e.target.checked?[...v,b]:v.filter(x=>x!==b))}/>{b}</label>)}
               <button type="button" className="primary compact" disabled={saving}
                 onClick={()=>void saveBrands(person)}>Сохранить</button>
               <button type="button" className="secondary compact" onClick={()=>setBrandEditor(null)}>Отмена</button>
             </div>:
             <div className="team-brands-cell">
               {person.brands.length?person.brands.join(' · '):'Не назначено'}
               {person.isActive&&<button className="secondary compact" type="button"
                 onClick={()=>{setBrandEditor(person.id);setBrandDraft([...person.brands])}}>Изменить</button>}
             </div>}</td>
           <td><div className="team-access-cell">
             <strong>{person.access?'@'+person.access.login:'Без входа'}</strong>
             <span className={'team-access-status '+(person.access?.isActive?'is-active':'is-disabled')}>
               {person.access?.isActive?'Активен':'Нет активного доступа'}</span>
             <button className="secondary compact" type="button"
               onClick={()=>openAccount(person)}>{person.access?'Настроить':'Создать вход'}</button>
           </div></td>
           <td><div className="row-actions compact-actions">
             <button className="secondary compact" type="button" onClick={()=>{
               setDraft({...empty(),id:person.id,name:person.name,role:person.role,phone:person.phone,
                 comment:person.comment,colorKey:person.colorKey,hiredAt:person.hiredAt,
                 birthDate:person.birthDate||'',brands:[...person.brands]})
               window.requestAnimationFrame(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}))
             }}>Редактировать</button>
             <button className={'secondary compact '+(person.isActive?'danger-outline':'')} type="button"
               disabled={saving} onClick={()=>void employment(person,!person.isActive)}>
               {person.isActive?'Уволить':'Восстановить'}</button>
           </div></td>
         </tr>)}
         {data&&!listed.length&&<tr><td colSpan={7} className="empty-state">Сотрудников в этой группе нет.</td></tr>}
         {!data&&<tr><td colSpan={7} className="empty-state">Список сотрудников не загрузился. Повторите запрос.</td></tr>}
         </tbody>
       </table>
     </LinkedTableScroll>
   </>}
   {mode==='timesheet'&&<WatchTimesheetWorkspace
     month={timesheetMonth} onMonthChange={next=>{setTimesheetMonth(next);setSelectedDays([])}}
     employees={timesheet?.employees||[]} entries={timesheet?.entries||[]}
     selectedDays={selectedDays} setSelectedDays={setSelectedDays}
     selectedManagers={selectedManagers} setSelectedManagers={setSelectedManagers}
     workUntil={workUntil} setWorkUntil={setWorkUntil}
     comment={timeComment} setComment={setTimeComment} saving={saving}
     onSave={()=>void saveTimesheet(false)}
     onClear={()=>{if(window.confirm('Очистить выбранные даты табеля?'))void saveTimesheet(true)}}/>}
   {['plan','salary','activity'].includes(mode)&&<div className="report-filter-row">
     {mode==='plan'&&<label>Бренд<select value={reportBrand}
       onChange={e=>setReportBrand(e.target.value as WatchBrand)}>
         {WATCH_BRANDS.map(b=><option key={b}>{b}</option>)}</select></label>}
     <label>С<input type="date" value={period.from} onChange={e=>setPeriod(p=>({...p,from:e.target.value}))}/></label>
     <label>По<input type="date" value={period.to} onChange={e=>setPeriod(p=>({...p,to:e.target.value}))}/></label>
     <button className="secondary compact" type="button" onClick={()=>setPeriod(month())}>Месяц</button>
   </div>}
   {mode==='plan'&&<section className="mini-panel">
     <h3>Выполнение денежных планов · {reportBrand}</h3>
     <p className="mini-panel-note">KPI не используется. Факт определяется по настоящим денежным событиям.</p>
     <LinkedTableScroll ariaLabel="Выполнение планов команды"><table className="data-table">
       <thead><tr><th>Кому</th><th>Период</th><th>План</th><th>Факт</th><th>Выполнение</th></tr></thead>
       <tbody>{[...(plans?.departmentPlans||[]).map(p=>({...p,manager:'Отдел'})),
         ...(plans?.managerPlans||[])].map(x=><tr key={(x.managerId||0)+'-'+x.id}>
           <td>{x.manager}</td><td>{fmt(x.periodStart)} — {fmt(x.periodEnd)}</td>
           <td>{watchMoney(x.plannedAmount)}</td><td>{watchMoney(x.factAmount)}</td>
           <td>{percent(x.completionRate)}</td></tr>)}</tbody>
     </table></LinkedTableScroll>
   </section>}
   {mode==='salary'&&<section className="mini-panel">
     <h3>Предварительный расчёт зарплаты</h3>
     <p className="mini-panel-note">Оклад каждого сотрудника учитывается один раз, бонусы — по денежным планам назначенных брендов. Это расчёт, не выплата из кассы.</p>
     <LinkedTableScroll ariaLabel="Зарплата команды"><table className="data-table">
       <thead><tr><th>Сотрудник</th><th>Дней</th><th>План</th><th>Факт</th>
         <th>Оклад</th><th>Бонус</th><th>Итого</th></tr></thead>
       <tbody>{salary.map(r=><tr key={r.managerId}><td>{r.manager}</td><td>{r.workDays}</td>
         <td>{watchMoney(r.plannedAmount)}</td><td>{watchMoney(r.factAmount)}</td>
         <td>{watchMoney(r.salaryBase)}</td><td>{watchMoney(r.bonusAmount)}</td>
         <td>{watchMoney(r.totalSalary)}</td></tr>)}</tbody>
     </table></LinkedTableScroll>
   </section>}
   {mode==='activity'&&<section className="mini-panel">
     <h3>Работа с заказами</h3>
     <LinkedTableScroll ariaLabel="Активность менеджеров"><table className="data-table">
       <thead><tr><th>Сотрудник</th><th>Роль</th><th>Заказов</th><th>Общая сумма</th><th>Отправлено</th></tr></thead>
       <tbody>{activity.map(r=><tr key={r.managerId}><td>{r.manager}</td><td>{r.role}</td>
         <td>{r.ordersCount}</td><td>{watchMoney(r.salesTotal)}</td><td>{r.sentOrders}</td></tr>)}</tbody>
     </table></LinkedTableScroll>
   </section>}
   {mode==='accounts'&&<>
     <section className="mini-panel team-account-manager-creation">
       <div className="mini-panel-head"><div><h3>Аккаунт менеджера или логиста</h3>
         <p className="mini-panel-note">Сначала добавьте человека во вкладке «Сотрудники», затем создайте ему отдельный логин и временный пароль. Менеджеру назначаются бренды, логист видит оба без привязки.</p>
       </div></div>
       <div className="form-grid compact-form">
         <label>Сотрудник без учётной записи
           <select value={accountTargetId} onChange={e=>setAccountTargetId(Number(e.target.value))}>
             <option value={0}>Выберите сотрудника</option>
             {employees.filter(person=>person.isActive&&!person.access).map(person=>
               <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}
           </select></label>
         <div className="actions"><button type="button" className="primary"
           disabled={saving||!employees.some(p=>p.id===accountTargetId&&p.isActive&&!p.access)}
           onClick={()=>{const person=employees.find(p=>p.id===accountTargetId);if(person)openAccount(person)}}>
           Создать вход сотруднику</button></div>
       </div>
       {!employees.some(p=>p.isActive&&!p.access)&&data&&
         <p className="mini-panel-note">Все действующие сотрудники уже имеют аккаунты или список команды пуст.</p>}
     </section>
     <WatchUserAccessPanel/>
   </>}
   {accountEditor&&<div className="team-access-modal-backdrop" role="presentation" onMouseDown={e=>{
     if(e.target===e.currentTarget)setAccountEditor(null)}}>
     <form className="team-access-modal" role="dialog" aria-modal="true"
       aria-label="Доступ сотрудника" onSubmit={e=>void saveAccount(e)}>
       <div className="team-access-modal-head"><div><h3>Вход сотрудника</h3>
         <p>{accountEditor.name}</p></div><button className="secondary compact" type="button"
         onClick={()=>setAccountEditor(null)}>Закрыть</button></div>
       <div className="team-access-modal-fields">
         <label>Логин<input required minLength={3} maxLength={32} autoComplete="off"
           value={accountDraft.login} onChange={e=>setAccountDraft(d=>({...d,login:e.target.value.toLowerCase()}))}/></label>
         <label>{accountEditor.access?'Новый пароль (необязательно)':'Временный пароль'}
           <input type="password" autoComplete="new-password"
             required={!accountEditor.access} minLength={8} value={accountDraft.password}
             onChange={e=>setAccountDraft(d=>({...d,password:e.target.value}))}/></label>
         <label>Уровень доступа<select value={accountDraft.role}
           onChange={e=>setAccountDraft(d=>({...d,role:e.target.value}))}>
           <option value="manager">Сотрудник</option><option value="admin">Администратор</option>
         </select></label>
         <label className="checkbox-row"><input type="checkbox"
           checked={accountDraft.isActive} onChange={e=>setAccountDraft(d=>({...d,isActive:e.target.checked}))}/>
           Активный доступ</label>
       </div>
       <div className="button-row"><button className="primary" disabled={saving} type="submit">
         {saving?'Сохраняю…':'Сохранить доступ'}</button>
         <button className="secondary" type="button" onClick={()=>setAccountEditor(null)}>Отмена</button></div>
     </form>
   </div>}
 </article>
}
