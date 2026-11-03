import {useEffect,useState,type FormEvent} from 'react'
type Account={id:number;login:string;role:'admin'|'manager';managerId:number|null;
 managerName:string;displayName:string;isActive:boolean;mustChangePassword:boolean;lastLoginAt:string|null}
type ReadResponse={ok:boolean;items:Account[];message?:string}
type WriteResponse={ok:boolean;id?:number;message?:string}
type Draft={id:number;login:string;password:string;displayName:string;isActive:boolean}
const blank=():Draft=>({id:0,login:'',password:'',displayName:'',isActive:true})
export function WatchUserAccessPanel(){
 const [rows,setRows]=useState<Account[]>([])
 const [draft,setDraft]=useState<Draft|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [version,setVersion]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   setError('')
   void fetch('/api/auth/users',{credentials:'include',cache:'no-store',signal:controller.signal})
    .then(async response=>{
      const data=await response.json() as ReadResponse
      if(!response.ok||!data.ok)throw new Error(data.message||'Нет доступа к учётным записям')
      if(!controller.signal.aborted)setRows(data.items||[])
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка списка')})
   return ()=>controller.abort()
 },[version])
 const save=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   if(busy||!draft)return
   setBusy(true);setError('');setNotice('')
   try{
     const edit=Boolean(draft.id)
     const response=await fetch(edit?'/api/auth/users/'+draft.id:'/api/auth/users',{
       method:edit?'PATCH':'POST',credentials:'include',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({login:draft.login.trim().toLowerCase(),
         displayName:draft.displayName.trim()||'Системный администратор',
         role:'admin',managerId:null,isActive:draft.isActive,
         ...(draft.password?{password:draft.password}:{})}),
     })
     const data=await response.json() as WriteResponse
     if(!response.ok||!data.ok)throw Error(data.message||'Не удалось сохранить администратора.')
     setDraft(null);setNotice(edit?'Аккаунт администратора обновлён.':'Администратор создан; временный пароль надо сменить после первого входа.')
     setVersion(v=>v+1)
   }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить администратора.')}
   finally{setBusy(false)}
 }
 const deactivate=async(account:Account)=>{
   if(!window.confirm('Отключить аккаунт @'+account.login+'? Активные сессии будут завершены.'))return
   setBusy(true);setError('')
   try{
     const result=await fetch('/api/auth/users/'+account.id,{
       method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({isActive:false}),
     })
     const data=await result.json() as WriteResponse
     if(!result.ok||!data.ok)throw Error(data.message||'Отключение не удалось.')
     setNotice('Доступ @'+account.login+' отключён.');setVersion(v=>v+1)
   }catch(e){setError(e instanceof Error?e.message:'Ошибка доступа.')}
   finally{setBusy(false)}
 }
 return <section className="mini-panel team-access-admin-list">
   <div className="mini-panel-head"><div><h3>Учётные записи</h3>
     <p className="mini-panel-note">Вход сотрудников привязывается к строкам команды. Здесь управляются системные администраторы, как в Main.</p></div>
     <button className="primary compact" type="button" onClick={()=>setDraft(blank())}>+ Добавить администратора</button>
   </div>
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   {notice&&<p role="status" className="app-alert success">{notice}</p>}
   <div className="summary-grid compact-summary">
     <div className="summary-card"><span>Администраторов</span><strong>{rows.filter(x=>x.role==='admin').length}</strong></div>
     <div className="summary-card"><span>Сотрудников с входом</span><strong>{rows.filter(x=>x.managerId&&x.isActive).length}</strong></div>
   </div>
   <div className="table-shell">
     <table className="data-table team-roster-table">
       <thead><tr><th>Пользователь</th><th>Роль</th><th>Связан с</th><th>Состояние</th><th>Последний вход</th><th>Действия</th></tr></thead>
       <tbody>{rows.map(a=><tr key={a.id}>
         <td><strong>{a.displayName||a.login}</strong><div className="cash-entry-meta">@{a.login}</div></td>
         <td>{a.role==='admin'?'Администратор':'Сотрудник'}</td>
         <td>{a.managerName||'Системный доступ'}</td>
         <td><span className={'team-access-status '+(a.isActive?'is-active':'is-disabled')}>
           {a.isActive?'Активен':'Отключён'}</span>
           {a.mustChangePassword&&<small> · Смена пароля</small>}</td>
         <td>{a.lastLoginAt?new Date(a.lastLoginAt).toLocaleDateString('ru-RU'):'—'}</td>
         <td><div className="row-actions compact-actions">
           {a.role==='admin'&&!a.managerId&&<>
             <button className="secondary compact" type="button" onClick={()=>setDraft({
               id:a.id,login:a.login,password:'',displayName:a.displayName,isActive:a.isActive,
             })}>Редактировать</button>
             {a.isActive&&<button className="secondary danger-outline compact" type="button"
               disabled={busy} onClick={()=>void deactivate(a)}>Отключить</button>}
           </>}
           {a.managerId?'Управляется в карточке сотрудника':null}
         </div></td>
       </tr>)}</tbody>
     </table>
   </div>
   {draft&&<div className="team-access-modal-backdrop" onMouseDown={e=>{
     if(e.target===e.currentTarget)setDraft(null)}}>
     <form className="team-access-modal" role="dialog" aria-modal="true"
       aria-label="Редактирование системного администратора" onSubmit={e=>void save(e)}>
       <div className="team-access-modal-head"><div><h3>{draft.id?'Администратор':'Новый администратор'}</h3>
         <p>Системный доступ ко всем разделам и обоим брендам.</p></div>
         <button type="button" className="secondary compact" onClick={()=>setDraft(null)}>Закрыть</button></div>
       <div className="team-access-modal-fields">
         <label>Логин<input autoComplete="off" required minLength={3} maxLength={32}
           value={draft.login} onChange={e=>setDraft({...draft,login:e.target.value.toLowerCase()})}/></label>
         <label>Отображаемое имя<input required maxLength={80}
           value={draft.displayName} onChange={e=>setDraft({...draft,displayName:e.target.value})}/></label>
         <label>{draft.id?'Новый пароль (необязательно)':'Временный пароль'}
           <input type="password" autoComplete="new-password" required={!draft.id} minLength={8}
             value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})}/></label>
         <label className="checkbox-row"><input type="checkbox" checked={draft.isActive}
           onChange={e=>setDraft({...draft,isActive:e.target.checked})}/> Активный доступ</label>
       </div>
       <div className="button-row"><button className="primary" disabled={busy} type="submit">
         {busy?'Сохраняю…':'Сохранить'}</button>
         <button type="button" className="secondary" onClick={()=>setDraft(null)}>Отмена</button>
       </div>
     </form>
   </div>}
 </section>
}
