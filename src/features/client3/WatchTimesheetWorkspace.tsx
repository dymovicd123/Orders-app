import type {Dispatch,SetStateAction} from 'react'
import '../../styles/client3-watch-timesheet-workspace.css'

export type WatchTimesheetEntry={
 id:number;date:string;managerId:number;workUntil:string;comment:string
}
export type WatchTimesheetEmployee={id:number;name:string}
type Props={
 month:string;onMonthChange:(month:string)=>void;
 employees:WatchTimesheetEmployee[];entries:WatchTimesheetEntry[];
 selectedDays:string[];setSelectedDays:Dispatch<SetStateAction<string[]>>;
 selectedManagers:number[];setSelectedManagers:Dispatch<SetStateAction<number[]>>;
 workUntil:string;setWorkUntil:(value:string)=>void;
 comment:string;setComment:(value:string)=>void;
 saving:boolean;onSave:()=>void;onClear:()=>void;
}
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
export function watchTimesheetCalendarSlots(month:string):(string|null)[]{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return []
 const [year,m]=month.split('-').map(Number)
 const count=new Date(Date.UTC(year,m,0)).getUTCDate()
 const offset=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7
 return [...Array<null>(offset).fill(null),...Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'))]
}
const dateText=(date:string)=>date.slice(8)+'.'+date.slice(5,7)
export function WatchTimesheetWorkspace({
 month,onMonthChange,employees,entries,selectedDays,setSelectedDays,
 selectedManagers,setSelectedManagers,workUntil,setWorkUntil,comment,setComment,
 saving,onSave,onClear,
}:Props){
 const slots=watchTimesheetCalendarSlots(month)
 const dates=slots.filter((x):x is string=>x!==null)
 const known=new Map(employees.map(x=>[x.id,x.name]))
 const validEntries=entries.filter(x=>x.managerId>0&&x.date.startsWith(month+'-'))
 const byDate=new Map<string,WatchTimesheetEntry[]>()
 for(const e of validEntries){
   const list=byDate.get(e.date)||[]
   list.push(e);byDate.set(e.date,list)
 }
 const toggleDate=(date:string)=>setSelectedDays(old=>old.includes(date)
   ?old.filter(x=>x!==date):[...old,date].sort())
 const setPreset=(preset:'all'|'weekdays'|'weekends'|'even'|'odd'|'clear')=>{
   setSelectedDays(preset==='clear'?[]:dates.filter(date=>{
     const n=Number(date.slice(-2)),day=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7
     return preset==='all'||(preset==='weekdays'&&day<5)||
       (preset==='weekends'&&day>=5)||(preset==='even'&&n%2===0)||(preset==='odd'&&n%2===1)
   }))
 }
 const flipPerson=(id:number)=>setSelectedManagers(ids=>ids.includes(id)
   ?ids.filter(x=>x!==id):[...ids,id])
 const moveMonth=(offset:number)=>{
   const [y,m]=month.split('-').map(Number)
   const date=new Date(Date.UTC(y,m-1+offset,1))
   onMonthChange(date.toISOString().slice(0,7))
 }
 const scheduledDays=byDate.size
 const sorted=[...validEntries].sort((a,b)=>b.date.localeCompare(a.date)||a.managerId-b.managerId)
 return <section className="watch-ts" aria-label="Табель сотрудников">
   <header className="watch-ts-header">
     <div>
       <h3>Рабочий календарь команды</h3>
       <p>Выберите даты и сотрудников. Уже назначенные смены видны прямо в календаре.</p>
     </div>
     <div className="watch-ts-month-controls">
       <button type="button" className="secondary compact" aria-label="Предыдущий месяц"
         onClick={()=>moveMonth(-1)}>‹</button>
       <label className="watch-ts-month-label">Месяц
         <input type="month" value={month} onChange={e=>onMonthChange(e.target.value)}/>
       </label>
       <button type="button" className="secondary compact" aria-label="Следующий месяц"
         onClick={()=>moveMonth(1)}>›</button>
     </div>
   </header>
   <div className="watch-ts-facts">
     <div><strong>{scheduledDays}</strong><span>дней со сменами</span></div>
     <div><strong>{validEntries.length}</strong><span>назначений в месяце</span></div>
     <div><strong>{selectedDays.length}</strong><span>дней выбрано</span></div>
     <div><strong>{selectedManagers.length}</strong><span>сотрудников выбрано</span></div>
   </div>
   <div className="watch-ts-workspace">
     <div className="watch-ts-calendar-area">
       <div className="watch-ts-calendar-actions">
         <strong>Выберите дни</strong>
         <div className="watch-ts-presets">
           <button type="button" onClick={()=>setPreset('all')}>Все</button>
           <button type="button" onClick={()=>setPreset('weekdays')}>Будни</button>
           <button type="button" onClick={()=>setPreset('weekends')}>Выходные</button>
           <button type="button" onClick={()=>setPreset('even')}>Чётные</button>
           <button type="button" onClick={()=>setPreset('odd')}>Нечётные</button>
           <button type="button" onClick={()=>setPreset('clear')}>Снять выбор</button>
         </div>
       </div>
       <div className="watch-ts-calendar" role="group" aria-label="Календарь выбора смен">
         {weekdays.map(x=><div key={x} className="watch-ts-weekday">{x}</div>)}
         {slots.map((date,index)=>{
           if(!date)return <span className="watch-ts-blank" key={'blank-'+index}/>
           const assignments=byDate.get(date)||[]
           const chosen=selectedDays.includes(date)
           const day=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7
           return <button key={date} type="button" aria-pressed={chosen}
             aria-label={date+': '+assignments.length+' назначений'}
             className={'watch-ts-day'+(chosen?' selected':'')+(day>=5?' weekend':'')+
               (assignments.length?' scheduled':'')}
             onClick={()=>toggleDate(date)}>
             <span className="watch-ts-day-heading">
               <strong>{Number(date.slice(-2))}</strong>
               {chosen&&<span className="watch-ts-check" aria-hidden="true">✓</span>}
             </span>
             <span className="watch-ts-assignments">
               {assignments.length?assignments.map(e=><span key={e.id} className="watch-ts-assignment">
                 <span className="watch-ts-dot" aria-hidden="true"/>
                 <span>{known.get(e.managerId)||'Сотрудник №'+e.managerId}</span>
                 {e.workUntil&&<em>{e.workUntil}</em>}
               </span>):<span className="watch-ts-free">Без смен</span>}
             </span>
           </button>
         })}
       </div>
       <div className="watch-ts-legend"><span><i className="watch-ts-legend-scheduled"/> Есть смена</span>
         <span><i className="watch-ts-legend-chosen"/> Выбрано для действия</span></div>
     </div>
     <aside className="watch-ts-editor">
       <h4>Назначить смены</h4>
       <p className="watch-ts-selection">Выбрано дней: <strong>{selectedDays.length}</strong></p>
       <div className="watch-ts-editor-block">
         <div className="watch-ts-editor-row"><strong>Сотрудники</strong>
           <div><button type="button" onClick={()=>setSelectedManagers(employees.map(x=>x.id))}>Все</button>
             <button type="button" onClick={()=>setSelectedManagers([])}>Снять</button></div>
         </div>
         <div className="watch-ts-people">
           {employees.map(person=><button type="button" key={person.id}
             className={'watch-ts-person'+(selectedManagers.includes(person.id)?' selected':'')}
             aria-pressed={selectedManagers.includes(person.id)}
             onClick={()=>flipPerson(person.id)}>
             <span className="watch-ts-person-check" aria-hidden="true">{selectedManagers.includes(person.id)?'✓':'+'}</span>
             {person.name}
           </button>)}
           {!employees.length&&<p>Нет сотрудников для табеля.</p>}
         </div>
       </div>
       <div className="watch-ts-editor-fields">
         <label>Работают до
           <input type="time" value={workUntil} onChange={e=>setWorkUntil(e.target.value)}/>
         </label>
         <label>Комментарий (необязательно)
           <textarea rows={3} maxLength={500} value={comment}
             onChange={e=>setComment(e.target.value)}
             placeholder="Например, дополнительная смена"/>
         </label>
       </div>
       <div className="watch-ts-editor-actions">
         <button className="primary" type="button"
           disabled={saving||!selectedDays.length||!selectedManagers.length}
           onClick={onSave}>{saving?'Сохранение…':'Назначить выбранное'}</button>
         <button className="secondary danger-outline" type="button"
           disabled={saving||!selectedDays.length}
           onClick={onClear}>Очистить выбранные даты</button>
       </div>
       <small className="watch-ts-editor-note">При сохранении действующие назначения проверяются сервером. Выбор дат не меняет табель до нажатия кнопки.</small>
     </aside>
   </div>
   <details className="watch-ts-history">
     <summary>Показать список всех назначений за месяц ({sorted.length})</summary>
     <div className="watch-ts-history-rows">
       {sorted.map(e=><div key={e.id} className="watch-ts-history-row">
         <strong>{dateText(e.date)}</strong>
         <span>{known.get(e.managerId)||'Сотрудник №'+e.managerId}</span>
         <span>{e.workUntil?'До '+e.workUntil:'Время не указано'}</span>
         <span>{e.comment||''}</span>
       </div>)}
       {!sorted.length&&<p>За этот месяц смен пока нет.</p>}
     </div>
   </details>
 </section>
}
