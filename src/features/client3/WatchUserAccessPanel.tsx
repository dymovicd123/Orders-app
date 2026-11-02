import {useEffect,useState,type FormEvent} from 'react'
import '../../styles/client3-watch-users.css'

type Account={id:number;login:string;role:'admin'|'manager';displayName:string;isActive:boolean;mustChangePassword:boolean;lastLoginAt:string|null}
type ReadResponse={ok:boolean;items:Account[];message?:string}
type WriteResponse={ok:boolean;id?:number;message?:string}
export function WatchUserAccessPanel(){
  const [rows,setRows]=useState<Account[]>([])
  const [login,setLogin]=useState('')
  const [displayName,setDisplayName]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [version,setVersion]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    void fetch('/api/auth/users',{credentials:'include',cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const data=await response.json() as ReadResponse
        if(!response.ok||!data.ok)throw new Error(data.message||'Нет доступа к учётным записям')
        if(!controller.signal.aborted)setRows(data.items||[])
      }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка списка')})
    return ()=>controller.abort()
  },[version])
  const create=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const response=await fetch('/api/auth/users',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({login,displayName,password,role:'admin',isActive:true}),
      })
      const data=await response.json() as WriteResponse
      if(!response.ok||!data.ok)throw new Error(data.message||'Не удалось создать администратора')
      setNotice('Учётная запись администратора создана. При первом входе потребуется сменить временный пароль.')
      setLogin('');setDisplayName('');setPassword('')
      setVersion(v=>v+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось создать администратора')}
    finally{setBusy(false)}
  }
  return <section className="watch-users">
    <h2>Учётные записи</h2>
    <p>Новый администратор получает доступ к обоим брендам. Пароль укажите временный:
       после первого входа система обязательно потребует его сменить.</p>
    <form onSubmit={e=>void create(e)}>
      <h3>Добавить администратора</h3>
      <label>Логин<input autoComplete="off" value={login} required minLength={3} maxLength={32}
        pattern="[a-z0-9][a-z0-9._-]*" onChange={e=>setLogin(e.target.value.toLowerCase())}
        placeholder="Например, owner.monitor"/></label>
      <label>Отображаемое имя<input value={displayName} required maxLength={80}
        onChange={e=>setDisplayName(e.target.value)} placeholder="Администратор"/></label>
      <label>Временный пароль<input type="password" autoComplete="new-password" value={password}
        required minLength={8} onChange={e=>setPassword(e.target.value)}/></label>
      <button disabled={busy} type="submit">{busy?'Сохранение…':'Создать администратора'}</button>
    </form>
    {error&&<p role="alert" className="watch-users-error">{error}</p>}
    {notice&&<p role="status" className="watch-users-success">{notice}</p>}
    <h3>Существующие аккаунты</h3>
    <div className="watch-users-list">{rows.map(account=><article key={account.id}>
      <strong>{account.displayName||account.login}</strong>
      <span>{account.login} · {account.role==='admin'?'Администратор':'Менеджер'}</span>
      <small>{account.isActive?'Активен':'Отключён'}{account.mustChangePassword?' · Требуется смена пароля':''}</small>
    </article>)}</div>
  </section>
}
