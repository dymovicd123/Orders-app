import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { WATCH_OPTIONS, type WatchBrand } from '../shared/client3/watch-domain'
import { WatchBrandAccessPanel } from './features/client3/WatchBrandAccessPanel'
import { WatchCatalogEditor } from './features/client3/WatchCatalogEditor'
import {WatchWarehouseMain} from './features/client3/WatchWarehouseMain'
import {WatchStockMainBrowse} from './features/client3/WatchStockMainBrowse'
import { WatchOrdersPanel } from './features/client3/WatchOrdersPanel'
import {WatchFinancePanel} from './features/client3/WatchFinancePanel'
import {WatchReturnsPanel} from './features/client3/WatchReturnsPanel'
import {WatchLegacyOrdersPanel} from './features/client3/WatchLegacyOrdersPanel'
import {WatchUserAccessPanel} from './features/client3/WatchUserAccessPanel'
import { WatchLogisticsPanel } from './features/client3/WatchLogisticsPanel'
import { WatchOrderForm, type WatchOrderChoice, type WatchOrderDraftPayload } from './features/client3/WatchOrderForm'
import {Client3MainChrome} from './features/client3/Client3MainChrome'
import {OrdersHeaderSection} from './features/sections/OrdersHeaderSection'
import {orderPanelOptions} from './app/constants'
import './styles/client3-watch-shell.css'

type User = {
  id: number
  role: string
  employeeRole?: string
  login?: string
  displayName?: string
  mustChangePassword?: boolean
}
type AuthStatus = { ok: boolean; user: User | null; hasUsers: boolean; setupReady: boolean; message?: string }
type BrandResponse = { ok: boolean; brands: Array<{ code: WatchBrand; name: string }>; message?: string }
type ModelResponse = { ok: boolean; models: WatchOrderChoice[]; message?: string }
type ManagerChoice = {brand: WatchBrand;id:number;name:string}
type ManagerResponse = {ok:boolean;managers:Array<{id:number;name:string}>;message?:string}
type WatchSection = 'orders'|'create'|'logistics'|'warehouse'|'operations'|'catalog'|'returns'|'exchange'|'finance'|'staff'|'accounts'|'legacy'
const sectionMeta:Record<WatchSection,{title:string;description:string;area:string}>={
  orders:{title:'Заказы',description:'Продажи, отгрузки и состояние заказов по брендам.',area:'Продажи'},
  create:{title:'Новый заказ',description:'Выберите доступные часы, укажите оплату и данные получателя.',area:'Продажи'},
  logistics:{title:'Логистика',description:'Гравировка, сроки исполнения и подготовка к отправке.',area:'Рабочие процессы'},
  warehouse:{title:'Склад',description:'Реальные остатки, резервы и складские операции.',area:'Товары и склад'},
  catalog:{title:'Каталог товаров',description:'Модели, комплектации и каталожные цены.',area:'Товары и склад'},
  exchange:{title:'Обмен часов',description:'Полная замена одной позиции без изменения цены.',area:'Продажи'},
  operations:{title:'Операции склада',description:'Приход, списание, перемещение и пересчёт.',area:'Товары и склад'},
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
  const activeSection:WatchSection=
    (!canAdmin&&['legacy','accounts','staff'].includes(tab))||
    (!canSales&&['orders','create','warehouse','operations','catalog','finance','returns','exchange'].includes(tab))
      ? 'logistics':tab
  const orderTab=activeSection==='create'?'create':activeSection==='returns'?'returns':
    activeSection==='exchange'?'exchange':activeSection==='legacy'?'activity':'list'
  const accountTab=activeSection==='accounts'?'accounts':'staff'
  const viewModels=(brand&&models)||[]
  return <Client3MainChrome
    user={user}
    section={activeSection}
    canSales={canSales}
    busy={busy}
    onNavigate={goTo}
    onLogout={()=>void logout()}
    onRefresh={()=>{setCatalogVersion(x=>x+1)}}
    error={error} success={success} warning={warning}>
    <div className="client3-main-page">
      {['orders','create','returns','exchange','legacy'].includes(activeSection)&&<>
        <OrdersHeaderSection ctx={{
          orderPanel:orderTab,
          orderPanelOptions:orderPanelOptions.filter(panel=>
            ['list','create','returns','exchange'].includes(panel.kind)||
            (canAdmin&&panel.kind==='activity'))
            .map(panel=>panel.kind==='exchange'?{...panel,label:'Обмен'}:
              panel.kind==='returns'?{...panel,label:'Возвраты'}:
              panel.kind==='activity'?{...panel,label:'Исторические заказы'}:panel),
          returnHistorySummary:{pendingPhysicalQuantity:0},
          exchangeHistorySummary:{pendingPhysicalQuantity:0},
          sectorStyle:()=>({}),
          setEditorOpen:()=>{},
          setOrderPanel:(panel:string)=>goTo(panel==='create'?'create':
            panel==='returns'?'returns':panel==='exchange'?'exchange':
            panel==='activity'?'legacy':'orders'),
        }}/>
        {activeSection==='orders'?(brands.length?
          <WatchOrdersPanel key={'orders-'+catalogVersion}
            initialBrand={lastOrderBrand||undefined} allowedBrands={brands.map(x=>x.code)}/>:
          <article className="card wide">Бренды ещё не загружены или доступ не назначен.</article>):
        activeSection==='create'?
          <section className="watch-shell-create-page">
            {catalogBusy?<article className="card wide">Загрузка доступных часов…</article>:
              <WatchOrderForm allowedBrands={brands.map(x=>x.code)} catalog={models}
                isAdmin={canAdmin} managers={managerChoices}
                deliveryMethods={['Казпочта','Курьер','Самовывоз','Межгород']}
                onSave={saveWatchOrder}/>}
          </section>:
        activeSection==='returns'?<>
          <article className="card wide"><div className="card-label">Возвраты</div>
            <div className="card-meta">Для оформления возврата выберите исходный заказ во вкладке «Все заказы». Ниже находится очередь физической приёмки возвратов и старых часов после обмена.</div>
            <button type="button" className="secondary compact" onClick={()=>goTo('orders')}>Открыть заказы</button></article>
          {brands.length&&<WatchReturnsPanel brands={brands.map(x=>x.code)}/>}
        </>:
        activeSection==='exchange'?<>
          <article className="card wide"><div className="card-label">Обмены</div>
            <div className="card-meta">Откройте отправленный заказ и выберите «Обменять часы». Для сохранности остатков действуют проверки точного SKU, цены и отправки.</div></article>
          {brands.length&&<WatchOrdersPanel key={'exchange-'+catalogVersion} allowedBrands={brands.map(x=>x.code)}/>}
        </>:
        canAdmin?<WatchLegacyOrdersPanel/>:null}
      </>}
      {activeSection==='logistics'&&<WatchLogisticsPanel key={'logistics-'+catalogVersion}
        brand="all" canCompleteEngraving={canAdmin||user.employeeRole==='Логист'}/>}
      {['warehouse','operations','catalog'].includes(activeSection)&&<>
        <article className="card wide client3-main-erp-inventory-tabs">
          <button className={'secondary compact '+(activeSection==='warehouse'?'is-active':'')} type="button"
            onClick={()=>goTo('warehouse')}>Остатки</button>
          {canAdmin&&<button className={'secondary compact '+(activeSection==='operations'?'is-active':'')} type="button"
            onClick={()=>goTo('operations')}>Операции</button>}
          <button className={'secondary compact '+(activeSection==='catalog'?'is-active':'')} type="button"
            onClick={()=>goTo('catalog')}>Товары</button>
        </article>
        <div className="watch-shell-catalog">
          <div className="watch-shell-catalog-header">
            <div><h2>{activeSection==='catalog'?'Товары':
              activeSection==='operations'?'Складские операции':'Остатки'}</h2>
              <p>{activeSection==='catalog'?'Модели и комплектации часов.':
                'Количество, резерв и движения по выбранному бренду.'}</p></div>
            <label>Бренд<select value={brand}
              onChange={event=>{setBrand(event.target.value as WatchBrand);setError('')}}>
              {brands.map(row=><option key={row.code} value={row.code}>{row.name}</option>)}
            </select></label>
          </div>
          {canAdmin&&brand?(activeSection==='catalog'?
            <WatchCatalogEditor key={'catalog-'+brand} brand={brand} view="catalog"
              onStockChanged={()=>setCatalogVersion(x=>x+1)}/>:
            activeSection==='operations'?
              <WatchWarehouseMain key={'operation-'+brand} brand={brand}
                onStockChanged={()=>setCatalogVersion(x=>x+1)}/>:
              <WatchStockMainBrowse key={'stock-'+brand+'-'+catalogVersion}
                brand={brand} canCorrect={canAdmin} onCorrect={()=>goTo('operations')}/>):
            <div className="watch-shell-model-list">
              {viewModels.map(model=><article key={model.watchVariantId}>
                <strong>{model.modelName}</strong>
                <p>{model.gender==='male'?'Мужские':'Женские'} ·
                  {optionLabel(WATCH_OPTIONS.braceletMaterials,model.braceletMaterial)} ·
                  {optionLabel(WATCH_OPTIONS.dialColors,model.dialColor)}</p>
                <div>Офис: <strong>{sourceFree(model,true)}</strong> шт.</div>
                <div>Витрина: <strong>{sourceFree(model,false)}</strong> шт.</div>
              </article>)}
            </div>}
        </div>
      </>}
      {activeSection==='finance'&&brands.length>0&&
        <WatchFinancePanel key={'fin-'+catalogVersion} brands={brands.map(x=>x.code)}/>}
      {['staff','accounts'].includes(activeSection)&&canAdmin&&<>
        <article className="card wide client3-main-erp-account-tabs">
          <button type="button" className={'secondary compact '+(accountTab==='staff'?'is-active':'')}
            onClick={()=>goTo('staff')}>Менеджеры и бренды</button>
          <button type="button" className={'secondary compact '+(accountTab==='accounts'?'is-active':'')}
            onClick={()=>goTo('accounts')}>Учётные записи</button>
        </article>
        {activeSection==='staff'?<WatchBrandAccessPanel/>:<WatchUserAccessPanel/>}
      </>}
    </div>
  </Client3MainChrome>
}
