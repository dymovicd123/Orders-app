import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { WATCH_OPTIONS, type WatchBrand } from '../shared/client3/watch-domain'
import { WatchBrandAccessPanel } from './features/client3/WatchBrandAccessPanel'
import { WatchCatalogEditor } from './features/client3/WatchCatalogEditor'
import { WatchOrdersPanel } from './features/client3/WatchOrdersPanel'
import {WatchFinancePanel} from './features/client3/WatchFinancePanel'
import {WatchReturnsPanel} from './features/client3/WatchReturnsPanel'
import {WatchLegacyOrdersPanel} from './features/client3/WatchLegacyOrdersPanel'
import {WatchUserAccessPanel} from './features/client3/WatchUserAccessPanel'
import { WatchLogisticsPanel } from './features/client3/WatchLogisticsPanel'
import { WatchOrderForm, type WatchOrderChoice, type WatchOrderDraftPayload } from './features/client3/WatchOrderForm'
import './styles/client3-watch-shell.css'

type User = {
  id: number
  role: string
  employeeRole?: string
  displayName?: string
  mustChangePassword?: boolean
}
type AuthStatus = { ok: boolean; user: User | null; hasUsers: boolean; setupReady: boolean; message?: string }
type BrandResponse = { ok: boolean; brands: Array<{ code: WatchBrand; name: string }>; message?: string }
type ModelResponse = { ok: boolean; models: WatchOrderChoice[]; message?: string }
type ManagerChoice = {brand: WatchBrand;id:number;name:string}
type ManagerResponse = {ok:boolean;managers:Array<{id:number;name:string}>;message?:string}
type WatchSection = 'orders'|'create'|'logistics'|'warehouse'|'catalog'|'returns'|'finance'|'staff'|'accounts'|'legacy'
const sectionMeta:Record<WatchSection,{title:string;description:string;area:string}>={
  orders:{title:'Заказы',description:'Продажи, отгрузки и состояние заказов по брендам.',area:'Продажи'},
  create:{title:'Новый заказ',description:'Выберите доступные часы, укажите оплату и данные получателя.',area:'Продажи'},
  logistics:{title:'Логистика',description:'Гравировка, сроки исполнения и подготовка к отправке.',area:'Рабочие процессы'},
  warehouse:{title:'Склад',description:'Реальные остатки, резервы и складские операции.',area:'Товары и склад'},
  catalog:{title:'Каталог товаров',description:'Модели, комплектации и каталожные цены.',area:'Товары и склад'},
  returns:{title:'Приём возвратов',description:'Физическое поступление часов после возврата или обмена.',area:'Рабочие процессы'},
  finance:{title:'Финансы',description:'Движение денежных средств и итоги продаж по брендам.',area:'Финансы'},
  staff:{title:'Доступ к брендам',description:'Назначение менеджеров на TAUWACH и WACHIZEN.',area:'Администрирование'},
  accounts:{title:'Учётные записи',description:'Доступ сотрудников и управление администраторами.',area:'Администрирование'},
  legacy:{title:'Исторические заказы',description:'Заказы до перехода на новую систему, без изменения данных.',area:'Администрирование'},
}
const sectionIcons:Record<WatchSection,string>={
  orders:'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',
  create:'M12 5v14 M5 12h14',
  logistics:'M3 7h12v11H3z M15 10h4l3 4v4h-7 M6 20h3 M17 20h3',
  warehouse:'M3 8l9-5 9 5v12H3z M3 8l9 5 9-5 M12 13v7',
  catalog:'M4 4h8l9 9-8 8-9-9z M8.5 8.5h.01',
  returns:'M8 3L4 7l4 4 M4 7h11a5 5 0 0 1 0 10H5',
  finance:'M4 20V10 M9 20V6 M14 20v-9 M19 20V4',
  staff:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8 M19 8v6 M16 11h6',
  accounts:'M12 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8 M4 21v-3a8 8 0 0 1 16 0v3 M8 21h8',
  legacy:'M3 12a9 9 0 1 0 3-7 M3 3v6h6 M12 7v5l4 2',
}
const sections=Object.keys(sectionMeta) as WatchSection[]
type LoginResponse = { ok: boolean; user?: User; message?: string }
async function api<T extends { ok: boolean; message?: string }>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init })
  const result = await response.json() as T
  if (!response.ok || !result.ok) throw new Error(result.message || 'Ошибка (' + response.status + ')')
  return result
}
const jsonHeaders = { 'Content-Type': 'application/json' }
function fullName(user: User) { return user.displayName || 'Сотрудник' }
function optionLabel(rows: readonly {value:string;label:string}[], value: string) {
  return rows.find(row => row.value === value)?.label || value
}
function sourceFree(item: WatchOrderChoice, office: boolean) {
  return Math.max(0, office
    ? Number(item.officePhysical) - Number(item.officeReserved)
    : Number(item.showcasePhysical) - Number(item.showcaseReserved))
}
export function WatchClient3App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [hasUsers, setHasUsers] = useState(true)
  const [setupReady, setSetupReady] = useState(true)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [bootstrapPassword, setBootstrapPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [brands, setBrands] = useState<BrandResponse['brands']>([])
  const [brand, setBrand] = useState<WatchBrand | ''>('')
  const [tab, setTab] = useState<WatchSection>('orders')
  const [mobileNavOpen,setMobileNavOpen]=useState(false)
  const [managerChoices,setManagerChoices] = useState<ManagerChoice[]>([])
  const [success,setSuccess] = useState('')
  const [warning,setWarning] = useState('')
  const [lastOrderBrand,setLastOrderBrand]=useState<WatchBrand|null>(null)
  const [models, setModels] = useState<WatchOrderChoice[]>([])
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogVersion,setCatalogVersion]=useState(0)

  const refreshAuth = useCallback(async () => {
    setChecking(true)
    try {
      const result = await api<AuthStatus>('/api/auth/status')
      setUser(result.user)
      setHasUsers(result.hasUsers)
      setSetupReady(result.setupReady)
      setError('')
    } catch (cause) {
      setUser(null)
      setError(cause instanceof Error ? cause.message : 'Нет связи с сервером')
    } finally { setChecking(false) }
  }, [])
  useEffect(() => { void refreshAuth() }, [refreshAuth])
  useEffect(()=>{
    const syncHash=()=>{
      const section=window.location.hash.slice(1) as WatchSection
      if(sections.includes(section))setTab(section)
    }
    syncHash()
    window.addEventListener('hashchange',syncHash)
    return ()=>window.removeEventListener('hashchange',syncHash)
  },[])


  useEffect(() => {
    if (!user || user.mustChangePassword) { setBrands([]); setBrand(''); return }
    const controller = new AbortController()
    void api<BrandResponse>('/api/client3/watches/brands', { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setBrands(result.brands || [])
        setBrand(old => result.brands.some(x => x.code === old) ? old : result.brands[0]?.code || '')
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Нет доступа к брендам')
      })
    return () => controller.abort()
  }, [user?.id, user?.mustChangePassword])

  useEffect(() => {
    if (!user || user.mustChangePassword || !(((tab === 'catalog'||tab === 'warehouse') && brand) || (tab === 'create' && brands.length))) {
      setModels([])
      return
    }
    const controller = new AbortController()
    setCatalogBusy(true)
    setModels([])
    const toLoad:WatchBrand[]=tab==='create'?brands.map(x=>x.code):[brand as WatchBrand]
    void Promise.all(toLoad.map(code=>api<ModelResponse>(
      '/api/client3/watches/models?brand=' + encodeURIComponent(code), {signal:controller.signal}
    ).then(result=>(result.models||[]).map(model=>({...model,brand:code})))))
      .then(groups=>{if(!controller.signal.aborted)setModels(groups.flat())})
      .catch(cause=>{if(!controller.signal.aborted){setModels([]);setError(cause instanceof Error?cause.message:'Каталог недоступен')}})
      .finally(()=>{if(!controller.signal.aborted)setCatalogBusy(false)})
    return () => controller.abort()
  }, [user?.id, user?.mustChangePassword, brand, tab, brands, catalogVersion])

  useEffect(()=>{
    if(tab!=='create'||user?.role!=='admin'||!brands.length){setManagerChoices([]);return}
    const controller=new AbortController()
    void Promise.all(brands.map(x=>api<ManagerResponse>(
      '/api/client3/watches/managers?brand='+encodeURIComponent(x.code),{signal:controller.signal}
    ).then(result=>result.managers.map(manager=>({...manager,brand:x.code})))))
      .then(groups=>{if(!controller.signal.aborted)setManagerChoices(groups.flat())})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Менеджеры недоступны')})
    return ()=>controller.abort()
  },[user?.id,user?.role,tab,brands])

  const saveWatchOrder=async(draft:WatchOrderDraftPayload)=>{
    const result=await api<{ok:boolean;orderId:number;externalId:string;message?:string;pendingReservation?:boolean;warning?:string}>(
      '/api/client3/watches/orders',{
        method:'POST',headers:jsonHeaders,body:JSON.stringify(draft),
      })
    setSuccess('Заказ '+(result.externalId||'#'+result.orderId)+' сохранён. Товар не отправлен.')
    setLastOrderBrand(draft.brand)
    setWarning(result.pendingReservation?(result.warning||'Резерв часов требует проверки.'): '')
    setError('')
    goTo('orders')
  }

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const path = hasUsers ? '/api/auth/login' : '/api/auth/setup'
      const body = hasUsers
        ? { login, password }
        : { login, password, bootstrapLogin: 'admin', bootstrapPassword, displayName: 'Администратор' }
      const result = await api<LoginResponse>(path, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify(body),
      })
      if (!result.user) throw new Error('Вход не подтверждён сервером')
      setUser(result.user); setPassword(''); setBootstrapPassword(''); setHasUsers(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось войти') }
    finally { setBusy(false) }
  }
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api<{ok:boolean;message?:string}>('/api/auth/change-password', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ currentPassword: password, newPassword: nextPassword }),
      })
      setPassword(''); setNextPassword('')
      await refreshAuth()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить пароль') }
    finally { setBusy(false) }
  }
  const logout = async () => {
    setBusy(true); setError('')
    try {
      await api<{ok:boolean;message?:string}>('/api/auth/logout', { method: 'POST' })
      setUser(null); setBrands([]); setBrand(''); setModels([])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Выход не выполнен') }
    finally { setBusy(false) }
  }

  if (checking) return <main className="watch-shell-auth"><p>Проверка доступа…</p></main>
  if (!user) return <main className="watch-shell-auth">
    <div className="watch-shell-auth-card">
      <h1>{hasUsers ? 'Вход' : 'Создание администратора'}</h1>
      {!setupReady && <p role="alert">Первоначальная настройка ещё не разрешена владельцем.</p>}
      {error && <p role="alert" className="watch-shell-error">{error}</p>}
      <form onSubmit={event => void authenticate(event)}>
        <label>Логин<input required autoComplete="username" value={login} onChange={event => setLogin(event.target.value)}/></label>
        <label>Пароль<input required type="password" autoComplete={hasUsers ? 'current-password' : 'new-password'}
          value={password} onChange={event => setPassword(event.target.value)}/></label>
        {!hasUsers && <label>Код первого администратора<input required type="password"
          value={bootstrapPassword} onChange={event => setBootstrapPassword(event.target.value)}/></label>}
        <button type="submit" disabled={busy || (!hasUsers && !setupReady)}>
          {busy ? 'Проверка…' : hasUsers ? 'Войти' : 'Создать администратора'}
        </button>
      </form>
      {error && <button type="button" className="watch-shell-secondary" onClick={() => void refreshAuth()}>Проверить соединение</button>}
    </div>
  </main>
  if (user.mustChangePassword) return <main className="watch-shell-auth">
    <div className="watch-shell-auth-card">
      <h1>Смена временного пароля</h1>
      <p>Перед началом работы требуется сменить пароль.</p>
      {error && <p role="alert" className="watch-shell-error">{error}</p>}
      <form onSubmit={event => void changePassword(event)}>
        <label>Текущий пароль<input required type="password" autoComplete="current-password"
          value={password} onChange={event => setPassword(event.target.value)}/></label>
        <label>Новый пароль<input required type="password" minLength={8} autoComplete="new-password"
          value={nextPassword} onChange={event => setNextPassword(event.target.value)}/></label>
        <button type="submit" disabled={busy}>Сменить пароль</button>
      </form>
      <button type="button" onClick={() => void logout()} disabled={busy}>Выйти</button>
    </div>
  </main>

  const canSales=brands.length>0&&(user.role==='admin'||user.employeeRole!=='Логист')
  const canAdmin=user.role==='admin'
  const goTo=(next:WatchSection)=>{
    setTab(next);setMobileNavOpen(false);setError('')
    if(next==='create'){setSuccess('');setWarning('')}
    if(window.location.hash!=='#'+next)window.location.hash=next
  }
  // Keep navigation role-aware even when the location hash is changed manually.
  const activeSection:WatchSection=
    (!canAdmin&&['legacy','accounts','staff'].includes(tab))||
    (!canSales&&['orders','create','warehouse','catalog','finance','returns'].includes(tab))
      ? 'logistics':tab
  const navItem=(section:WatchSection,label:string,important=false)=>
    <button key={section} type="button"
      className={'watch-shell-nav-item'+(important?' is-primary':'')}
      aria-current={activeSection===section?'page':undefined}
      onClick={()=>goTo(section)}>
      <svg className="watch-shell-nav-svg" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path d={sectionIcons[section]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <span>{label}</span>
      {important&&<span className="watch-shell-nav-plus" aria-hidden="true">+</span>}
    </button>
  const meta=sectionMeta[activeSection]
  return <div className="watch-shell">
    <aside className={'watch-shell-sidebar'+(mobileNavOpen?' is-open':'')} aria-label="Боковая панель">
      <div className="watch-shell-sidebar-top">
        <div className="watch-shell-brand-mark" aria-hidden="true">S</div>
        <div><strong>Система заказов</strong><small>Рабочая панель</small></div>
        <button className="watch-shell-sidebar-close" type="button"
          aria-label="Закрыть меню" onClick={()=>setMobileNavOpen(false)}>×</button>
      </div>
      <nav className="watch-shell-nav" aria-label="Основные разделы">
        {canSales&&<div className="watch-shell-nav-group">
          <div className="watch-shell-nav-group-label">Продажи</div>
          {navItem('orders','Заказы')}
          {navItem('create','Новый заказ',true)}
        </div>}
        <div className="watch-shell-nav-group">
          <div className="watch-shell-nav-group-label">Рабочие процессы</div>
          {navItem('logistics','Логистика')}
          {canSales&&navItem('returns','Приём возвратов')}
        </div>
        {canSales&&<div className="watch-shell-nav-group">
          <div className="watch-shell-nav-group-label">Товары и склад</div>
          {navItem('warehouse','Склад')}
          {navItem('catalog','Каталог товаров')}
        </div>}
        {canSales&&<div className="watch-shell-nav-group">
          <div className="watch-shell-nav-group-label">Финансы</div>
          {navItem('finance','Движение денег')}
        </div>}
        {canAdmin&&<div className="watch-shell-nav-group">
          <div className="watch-shell-nav-group-label">Администрирование</div>
          {navItem('staff','Доступ к брендам')}
          {navItem('accounts','Учётные записи')}
          {navItem('legacy','Исторические заказы')}
        </div>}
      </nav>
      <div className="watch-shell-sidebar-account">
        <span className="watch-shell-sidebar-avatar" aria-hidden="true">{fullName(user).slice(0,1).toUpperCase()}</span>
        <div className="watch-shell-sidebar-user"><strong>{fullName(user)}</strong>
          <small>{canAdmin?'Администратор':user.employeeRole||'Сотрудник'}</small></div>
        <button className="watch-shell-signout" type="button" disabled={busy} onClick={()=>void logout()}>Выйти</button>
      </div>
    </aside>
    {mobileNavOpen&&<button type="button" className="watch-shell-backdrop" aria-label="Закрыть меню"
      onClick={()=>setMobileNavOpen(false)}/>}
    <div className="watch-shell-workspace">
      <header className="watch-shell-topbar">
        <button className="watch-shell-menu-toggle" type="button" aria-label="Открыть меню разделов"
          aria-expanded={mobileNavOpen} onClick={()=>setMobileNavOpen(x=>!x)}>
          <span/><span/><span/>
        </button>
        <div className="watch-shell-breadcrumb"><span>{meta.area}</span><span aria-hidden="true">/</span><strong>{meta.title}</strong></div>
        <div className="watch-shell-topbar-right">
          {canSales&&activeSection!=='create'&&<button type="button" className="watch-shell-action" onClick={()=>goTo('create')}>+ Новый заказ</button>}
          <span className="watch-shell-topbar-user">{fullName(user)}</span>
        </div>
      </header>
      <main className="watch-shell-content" id="watch-main-content">
        <div className="watch-shell-page-head">
          <div><span className="watch-shell-page-kicker">{meta.area}</span>
            <h1>{meta.title}</h1><p>{meta.description}</p></div>
          {activeSection==='create'&&<button type="button" className="watch-shell-back-link" onClick={()=>goTo('orders')}>← К списку заказов</button>}
        </div>
        {error&&<p role="alert" className="watch-shell-error">{error}</p>}
        {success&&<p role="status" className="watch-shell-success">{success}</p>}
        {warning&&<p role="alert" className="watch-shell-warning">{warning}</p>}
        {activeSection==='accounts'?<WatchUserAccessPanel/>:
          activeSection==='legacy'?<WatchLegacyOrdersPanel/>:
          activeSection==='staff'?<WatchBrandAccessPanel/>:
          activeSection==='returns'?(brands.length?<WatchReturnsPanel brands={brands.map(x=>x.code)}/>:<p>Нет доступных брендов.</p>):
          activeSection==='finance'?(brands.length?<WatchFinancePanel brands={brands.map(x=>x.code)}/>:<p>Нет доступных брендов.</p>):
          activeSection==='orders'?(brands.length?<WatchOrdersPanel initialBrand={lastOrderBrand||undefined} allowedBrands={brands.map(x=>x.code)}/>:<p className="watch-shell-loading">Загрузка доступных брендов…</p>):
          activeSection==='create'?
            <section className="watch-shell-create-page">
              {catalogBusy?<p className="watch-shell-loading">Загрузка доступных часов…</p>:
                <WatchOrderForm allowedBrands={brands.map(x=>x.code)} catalog={models}
                  isAdmin={canAdmin} managers={managerChoices}
                  deliveryMethods={['Казпочта','Курьер','Самовывоз','Межгород']}
                  onSave={saveWatchOrder}/>}
            </section>:
          activeSection==='logistics'?
            <WatchLogisticsPanel brand="all" canCompleteEngraving={canAdmin||user.employeeRole==='Логист'}/>:
          <section className="watch-shell-catalog">
            <div className="watch-shell-catalog-header">
              <div><h2>{activeSection==='warehouse'?'Остатки и операции':'Каталог моделей'}</h2>
                <p>{activeSection==='warehouse'?'Наличие и резервы раздельно по офису и витрине.':'Модели и комплектации для выбранного бренда.'}</p></div>
              <label>Бренд<select value={brand} onChange={event=>{setBrand(event.target.value as WatchBrand);setError('')}}>
                {brands.map(x=><option key={x.code} value={x.code}>{x.name}</option>)}
              </select></label>
            </div>
            {catalogBusy&&<p className="watch-shell-loading">Загружаем товары…</p>}
            {canAdmin&&brand?
              <WatchCatalogEditor key={activeSection+'-'+brand} brand={brand}
                view={activeSection==='warehouse'?'warehouse':'catalog'}
                onStockChanged={()=>setCatalogVersion(x=>x+1)}/>:
              <div className="watch-shell-model-list">
                {models.map(model=><article key={model.watchVariantId}>
                  <strong>{model.modelName}</strong>
                  <p>{model.gender==='male'?'Мужские':'Женские'} · {optionLabel(WATCH_OPTIONS.braceletMaterials,model.braceletMaterial)}
                    · {optionLabel(WATCH_OPTIONS.dialColors,model.dialColor)}</p>
                  <div>Офис: <strong>{sourceFree(model,true)}</strong> шт.</div>
                  <div>Витрина: <strong>{sourceFree(model,false)}</strong> шт.</div>
                </article>)}
                {!catalogBusy&&models.length===0&&<p>Моделей пока нет.</p>}
              </div>}
          </section>}
      </main>
    </div>
  </div>
}
