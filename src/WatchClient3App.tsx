import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { WATCH_OPTIONS, type WatchBrand } from '../shared/client3/watch-domain'
import {WatchTeamMainPanel} from './features/client3/WatchTeamMainPanel'
import { WatchCatalogEditor } from './features/client3/WatchCatalogEditor'
import {WatchWarehouseMain} from './features/client3/WatchWarehouseMain'
import {WatchWarehouseHistory} from './features/client3/WatchWarehouseStage5'
import {WatchStockMainBrowse} from './features/client3/WatchStockMainBrowse'
import {WatchDemandMainPanel} from './features/client3/WatchDemandMainPanel'
import { WatchOrdersPanel } from './features/client3/WatchOrdersPanel'
import {WatchDebtWorkspace} from './features/client3/WatchDebtWorkspace'
import {WatchClientsPanel} from './features/client3/WatchClientsPanel'
import {WatchFinancePanel} from './features/client3/WatchFinancePanel'
import {WatchDashboardPanel} from './features/client3/WatchDashboardPanel'
import {WatchReportsPanel} from './features/client3/WatchReportsPanel'
import {WatchPlansPanel} from './features/client3/WatchPlansPanel'
import {WatchLeadsPanel} from './features/client3/WatchLeadsPanel'
import {WatchReturnsPanel} from './features/client3/WatchReturnsPanel'
import {WatchOperationHistoryPanel} from './features/client3/WatchOperationHistoryPanel'
import {WatchLegacyOrdersPanel} from './features/client3/WatchLegacyOrdersPanel'
import { WatchLogisticsPanel } from './features/client3/WatchLogisticsPanel'
import {WatchReferencesSection} from './features/client3/WatchReferencesSection'
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
type WatchSection = 'dashboard'|'reports'|'plan'|'leads'|'clients'|'orders'|'create'|'debts'|'logistics'|'warehouse'|'operations'|'revision'|'history'|'statistics'|'catalog'|'returns'|'exchange'|'finance'|'staff'|'accounts'|'legacy'|'references'
const sectionMeta:Record<WatchSection,{title:string;description:string;area:string}>={
  dashboard:{title:'Инфопанель',description:'Продажи, деньги и внимание к срокам логистики.',area:'Обзор'},
  reports:{title:'Отчёты',description:'Брендовые отчёты Main по оплатам, товарам, городам и менеджерам.',area:'Финансы'},
  plan:{title:'План',description:'Денежные планы отдела и менеджеров, без KPI.',area:'Продажи'},
  leads:{title:'Лиды',description:'Лиды и Колл-центр по каждому бренду, как в Main.',area:'Продажи'},
  orders:{title:'Заказы',description:'Продажи, отгрузки и состояние заказов по брендам.',area:'Продажи'},
  debts:{title:'Закрытие долга',description:'Открытые долги, оплата и история закрытий.',area:'Продажи'},
  clients:{title:'Клиенты',description:'Покупатели, повторные продажи и история заказов.',area:'Продажи'},
  create:{title:'Новый заказ',description:'Выберите доступные часы, укажите оплату и данные получателя.',area:'Продажи'},
  logistics:{title:'Логистика',description:'Гравировка, сроки исполнения и подготовка к отправке.',area:'Рабочие процессы'},
  warehouse:{title:'Склад',description:'Реальные остатки, резервы и складские операции.',area:'Товары и склад'},
  catalog:{title:'Каталог товаров',description:'Модели, комплектации и каталожные цены.',area:'Товары и склад'},
  exchange:{title:'Обмен часов',description:'Полная замена одной позиции без изменения цены.',area:'Продажи'},
  operations:{title:'Операции склада',description:'Приход, списание, перемещение и пересчёт.',area:'Товары и склад'},
  revision:{title:'Ревизия',description:'Полная и выборочная проверка часов с сохранением прогресса.',area:'Товары и склад'},
  history:{title:'История склада',description:'Реальные движения товаров по брендам и точкам.',area:'Товары и склад'},
  statistics:{title:'Статистика склада',description:'Продажи по моделям, комплектациям и фактическим ценам.',area:'Товары и склад'},
  returns:{title:'Приём возвратов',description:'Физическое поступление часов после возврата или обмена.',area:'Рабочие процессы'},
  finance:{title:'Финансы',description:'Движение денежных средств и итоги продаж по брендам.',area:'Финансы'},
  staff:{title:'Команда',description:'Сотрудники, табель, доступ, планы и отчёты как в Main.',area:'Администрирование'},
  accounts:{title:'Учётные записи',description:'Доступ сотрудников и управление администраторами.',area:'Администрирование'},
  references:{title:'Справочники',description:'Бренды и параметры часов, доставка и оплата.',area:'Справочники'},
  legacy:{title:'Исторические заказы',description:'Заказы до перехода на новую систему, без изменения данных.',area:'Администрирование'},
}
const sections:WatchSection[]=(Object.keys(sectionMeta) as WatchSection[]).filter(section=>section!=='legacy')
type LoginResponse = { ok: boolean; user?: User; message?: string }
async function api<T extends { ok: boolean; message?: string }>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init })
  const result = await response.json() as T
  if (!response.ok || !result.ok) throw new Error(result.message || 'Ошибка (' + response.status + ')')
  return result
}
const jsonHeaders = { 'Content-Type': 'application/json' }
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
  const [tab, setTab] = useState<WatchSection>('dashboard')
  const [managerChoices,setManagerChoices] = useState<ManagerChoice[]>([])
  const [success,setSuccess] = useState('')
  const [warning,setWarning] = useState('')
  const [lastOrderBrand,setLastOrderBrand]=useState<WatchBrand|null>(null)
  const [logisticsFocusOrderId,setLogisticsFocusOrderId]=useState<number|null>(null)
  const [debtTarget,setDebtTarget]=useState<{brand:WatchBrand;orderId:number;externalId:string}|null>(null)
  const [correctionPrefill,setCorrectionPrefill]=useState<{
    brand:WatchBrand;source:'office'|'showcase';watchProductId:number;watchVariantId:number;operation?:'arrival'|'count'
  }|null>(null)
  const [reportOrderFocus,setReportOrderFocus]=useState<{
    brand:WatchBrand;orderId:number;externalId:string;orderDate:string
  }|null>(null)
  const [models, setModels] = useState<WatchOrderChoice[]>([])
  const [,setCatalogBusy] = useState(false)
  const [catalogVersion,setCatalogVersion]=useState(0)
  const [watchRefOptions,setWatchRefOptions]=useState<{
    paymentMethods:string[];deliveryMethods:string[];
    movements:string[];bracelets:string[];dials:string[];leatherColors:string[];cities:string[]
  }>({
    paymentMethods:['KASPI GOLD','KASPI RED','Рассрочка'],
    deliveryMethods:['Казпочта','Курьер','Самовывоз','Межгород'],
    movements:[],bracelets:[],dials:[],leatherColors:[],cities:[],
  })

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

  useEffect(()=>{
    if(!user||user.mustChangePassword||tab!=='create')return
    const controller=new AbortController()
    void api<{ok:boolean;rows:Array<{kind:string;value:string}>}>('/api/client3/watches/references',{
      signal:controller.signal,
    }).then(result=>{
      if(controller.signal.aborted)return
      const paymentMethods=result.rows.filter(row=>row.kind==='paymentMethods').map(row=>row.value)
      const deliveryMethods=result.rows.filter(row=>row.kind==='deliveryMethods').map(row=>row.value)
      setWatchRefOptions({
        paymentMethods:paymentMethods.length?paymentMethods:['KASPI GOLD','KASPI RED','Рассрочка'],
        deliveryMethods:deliveryMethods.length?deliveryMethods:['Казпочта','Курьер','Самовывоз','Межгород'],
        movements:result.rows.filter(row=>row.kind==='movements').map(row=>row.value),
        bracelets:result.rows.filter(row=>row.kind==='bracelets').map(row=>row.value),
        dials:result.rows.filter(row=>row.kind==='dials').map(row=>row.value),
        leatherColors:result.rows.filter(row=>row.kind==='leatherColors').map(row=>row.value),
        cities:result.rows.filter(row=>row.kind==='cities').map(row=>row.value),
      })
    }).catch(cause=>{if(!controller.signal.aborted)setError(
      cause instanceof Error?cause.message:'Не удалось загрузить способы оплаты и доставки')})
    return ()=>controller.abort()
  },[user?.id,user?.mustChangePassword,tab])

  const saveWatchOrder=async(draft:WatchOrderDraftPayload)=>{
    const result=await api<{ok:boolean;orderId:number;externalId:string;message?:string;pendingReservation?:boolean;warning?:string}>(
      '/api/client3/watches/orders',{
        method:'POST',headers:jsonHeaders,body:JSON.stringify(draft),
      })
    setSuccess('Заказ '+(result.externalId||'#'+result.orderId)+' сохранён. Товар не отправлен.')
    // Open the exact saved order; backdated sales can clarify possession
    // against the most recent completed inventory check before any shipment.
    setReportOrderFocus({brand:draft.brand,orderId:result.orderId,
      externalId:result.externalId||'#'+result.orderId,orderDate:draft.orderDate})
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

  if(checking)return <main className="auth-shell">
    <section className="auth-card">
      <div className="erp-brand auth-brand"><div className="erp-brand-mark">S</div>
        <div><div className="erp-brand-title">Система заказов</div>
          <div className="erp-brand-subtitle">Проверяем вход…</div></div>
      </div>
      <p className="muted-note">Загрузка сессии.</p>
    </section>
  </main>
  if(!user)return <main className="auth-shell">
    <form className="auth-card" onSubmit={event=>void authenticate(event)} method="post"
      action={hasUsers?'/api/auth/login':'/api/auth/setup'} autoComplete="on">
      <div className="erp-brand auth-brand">
        <div className="erp-brand-mark">S</div>
        <div><div className="erp-brand-title">Система заказов</div>
          <div className="erp-brand-subtitle">{hasUsers?'Вход по логину и паролю':'Первый запуск'}</div></div>
      </div>
      <div><h1>{hasUsers?'Вход':'Создать администратора'}</h1>
        <p>{hasUsers?'Введите логин и пароль своего аккаунта.':'Создайте первый аккаунт администратора.'}</p></div>
      {error&&<div className="app-alert error" role="alert"><span>{error}</span></div>}
      {!setupReady&&<p role="alert">Первоначальная настройка ещё не разрешена владельцем.</p>}
      <label><span>Логин</span><input id="auth-username" name="username" value={login}
        onChange={event=>setLogin(event.target.value)} autoComplete="username" autoCapitalize="none"
        spellCheck={false} required minLength={3} maxLength={32} placeholder="Например: admin"/></label>
      <label><span>Пароль</span><input id="auth-password" name="password" type="password"
        value={password} onChange={event=>setPassword(event.target.value)}
        autoComplete={hasUsers?'current-password':'new-password'} required minLength={8}/></label>
      {!hasUsers&&<label><span>Код первого администратора</span>
        <input type="password" required value={bootstrapPassword}
          onChange={event=>setBootstrapPassword(event.target.value)}/></label>}
      <button className="primary" type="submit" disabled={busy||(!hasUsers&&!setupReady)}>
        {busy?'Проверяю…':hasUsers?'Войти':'Создать администратора'}
      </button>
    </form>
  </main>
  if(user.mustChangePassword)return <main className="auth-shell">
    <form className="auth-card" onSubmit={event=>void changePassword(event)}
      method="post" action="/api/auth/change-password" autoComplete="on">
      <div className="erp-brand auth-brand"><div className="erp-brand-mark">S</div>
        <div><div className="erp-brand-title">Система заказов</div>
          <div className="erp-brand-subtitle">Первый вход сотрудника</div></div></div>
      <div><h1>Смена временного пароля</h1>
        <p>Перед началом работы требуется сменить временный пароль.</p></div>
      {error&&<div className="app-alert error" role="alert"><span>{error}</span></div>}
      <label><span>Текущий пароль</span><input type="password" autoComplete="current-password"
        required value={password} onChange={event=>setPassword(event.target.value)}/></label>
      <label><span>Новый пароль</span><input type="password" autoComplete="new-password"
        required minLength={8} value={nextPassword} onChange={event=>setNextPassword(event.target.value)}/></label>
      <button className="primary" type="submit" disabled={busy}>Сменить пароль</button>
      <button className="secondary" type="button" disabled={busy} onClick={()=>void logout()}>Выйти</button>
    </form>
  </main>

  const isLogisticsRole=['Логист','Упаковщик'].includes(user.employeeRole||'')
  const isWarehouseRole=user.employeeRole==='Завсклад'
  const canSales=brands.length>0&&(user.role==='admin'||(!isLogisticsRole&&!isWarehouseRole))
  const canAdmin=user.role==='admin'
  const canWarehouse=canAdmin||isWarehouseRole
  const canSeeWarehouse=canSales||canWarehouse
  const goTo=(next:WatchSection)=>{
    if(next!=='operations')setCorrectionPrefill(null)
    setTab(next);setError('')
    if(next==='create'){setSuccess('');setWarning('')}
    if(window.location.hash!=='#'+next)window.location.hash=next
  }
  const activeSection:WatchSection=
    (!canAdmin&&['legacy','accounts','staff'].includes(tab))||
    (!canSales&&['dashboard','reports','plan','leads','clients','orders','create','debts','finance','returns','exchange'].includes(tab))||
    (!canSeeWarehouse&&['warehouse','operations','revision','history','statistics','catalog','references'].includes(tab))
      ? (isWarehouseRole?'warehouse':'logistics'):tab
  const orderTab=activeSection==='debts'?'debt':activeSection==='create'?'create':activeSection==='returns'?'returns':
    activeSection==='exchange'?'exchange':activeSection==='legacy'?'activity':'list'
  const viewModels=(brand&&models)||[]
  return <Client3MainChrome
    user={user}
    section={activeSection}
    canSales={canSales} canWarehouse={canWarehouse}
    busy={busy}
    onNavigate={goTo}
    onLogout={()=>void logout()}
    onRefresh={()=>{setCatalogVersion(x=>x+1)}}
    error={error} success={success} warning={warning}>
    <div className="client3-main-page">
      {activeSection==='dashboard'&&brands.length>0&&
        <WatchDashboardPanel brands={brands.map(x=>x.code)}
          onNavigate={section=>goTo(section)}/>}
      {activeSection==='plan'&&brands.length>0&&
        <WatchPlansPanel brands={brands.map(b=>b.code)} isAdmin={canAdmin}/>}
      {activeSection==='leads'&&brands.length>0&&
        <WatchLeadsPanel brands={brands.map(b=>b.code)} isAdmin={canAdmin}/>}
      {activeSection==='reports'&&brands.length>0&&
        <WatchReportsPanel brands={brands.map(x=>x.code)}
          onOpenOrder={order=>{
            setReportOrderFocus(order);setLastOrderBrand(order.brand)
            goTo('orders')
          }}/>}
      {activeSection==='clients'&&brands.length>0&&<WatchClientsPanel brands={brands.map(x=>x.code)}
        onOpenOrder={order=>{setReportOrderFocus(order);setLastOrderBrand(order.brand);goTo('orders')}}/>}
      {['orders','create','debts','returns','exchange','legacy'].includes(activeSection)&&<>
        <OrdersHeaderSection ctx={{
          orderPanel:orderTab,
          orderPanelOptions:orderPanelOptions.filter(panel=>
            ['list','create','debt','returns','exchange'].includes(panel.kind))
            .map(panel=>panel.kind==='exchange'?{...panel,label:'Обмен'}:
              panel.kind==='returns'?{...panel,label:'Возвраты'}:
              panel),
          returnHistorySummary:{pendingPhysicalQuantity:0},
          exchangeHistorySummary:{pendingPhysicalQuantity:0},
          sectorStyle:()=>({}),
          setEditorOpen:()=>{},
          setOrderPanel:(panel:string)=>{
            if(panel==='debt')setDebtTarget(null)
            goTo(panel==='create'?'create':panel==='debt'?'debts':
              panel==='returns'?'returns':panel==='exchange'?'exchange':
              'orders')
          },
        }}/>
        {activeSection==='orders'?(brands.length?
          <WatchOrdersPanel key={'orders-'+catalogVersion}
            initialBrand={reportOrderFocus?.brand||lastOrderBrand||undefined}
            initialFocusedOrder={reportOrderFocus||undefined}
            allowedBrands={brands.map(x=>x.code)}
            isAdmin={canAdmin} onOpenDebt={(selected,orderId,externalId)=>{
              setDebtTarget({brand:selected,orderId,externalId})
              setLastOrderBrand(selected);goTo('debts')
            }} onOpenLogistics={(selected,orderId)=>{
              setLogisticsFocusOrderId(orderId);setBrand(selected);goTo('logistics')
            }}
            onOpenWorkflow={(kind,order)=>{
              setReportOrderFocus(order);setLastOrderBrand(order.brand);
              goTo(kind==='returns'?'returns':'exchange')
            }}/>:
          <article className="card wide">Бренды ещё не загружены или доступ не назначен.</article>):
        activeSection==='debts'?(
          brands.length?<WatchDebtWorkspace key={'debts-'+(debtTarget?.orderId||'list')+'-'+(debtTarget?.brand||lastOrderBrand||'')}
            brands={brands.map(x=>x.code)} initialTarget={debtTarget||undefined}/>:
          <article className="card wide">Бренды ещё не загружены или доступ не назначен.</article>
        ):
        activeSection==='create'?
          <section className="watch-shell-create-page">
            <WatchOrderForm allowedBrands={brands.map(x=>x.code)} catalog={models}
                isAdmin={canAdmin} managers={managerChoices}
                deliveryMethods={watchRefOptions.deliveryMethods}
                paymentMethods={watchRefOptions.paymentMethods}
                references={watchRefOptions}
                onSave={saveWatchOrder}/>
          </section>:
        activeSection==='returns'?<>
          {brands.length>0&&<WatchOrdersPanel workflow="returns" key={'return-order-flow-'+catalogVersion+'-'+(reportOrderFocus?.orderId||0)}
            initialBrand={reportOrderFocus?.brand||lastOrderBrand||undefined}
            initialFocusedOrder={reportOrderFocus||undefined}
            allowedBrands={brands.map(x=>x.code)} isAdmin={canAdmin}
            onOpenOrders={()=>goTo('orders')}/>}
          {brands.length>0&&<WatchReturnsPanel key={'returns-'+catalogVersion+'-'+(reportOrderFocus?.brand||brand)}
            brands={brands.map(x=>x.code)} initialBrand={reportOrderFocus?.brand||brand||undefined}/>}
          {brands.length>0&&<WatchOperationHistoryPanel kind="return"
            isAdmin={canAdmin}
            key={'return-history-'+catalogVersion}
            initialBrand={reportOrderFocus?.brand||lastOrderBrand||undefined}
            brands={brands.map(x=>x.code)}
            onOpenOrder={order=>{
              setReportOrderFocus(order);setLastOrderBrand(order.brand);goTo('orders')
            }}/>}
        </>:
        activeSection==='exchange'?<>
          {brands.length>0&&<WatchOrdersPanel workflow="exchange" key={'exchange-order-flow-'+catalogVersion+'-'+(reportOrderFocus?.orderId||0)}
            initialBrand={reportOrderFocus?.brand||lastOrderBrand||undefined}
            initialFocusedOrder={reportOrderFocus||undefined}
            allowedBrands={brands.map(x=>x.code)} isAdmin={canAdmin}
            onOpenOrders={()=>goTo('orders')}/>}
          {brands.length>0&&<WatchOperationHistoryPanel kind="exchange"
            isAdmin={canAdmin}
            key={'exchange-history-'+catalogVersion}
            initialBrand={reportOrderFocus?.brand||lastOrderBrand||undefined}
            brands={brands.map(x=>x.code)}
            onOpenOrder={order=>{
              setReportOrderFocus(order);setLastOrderBrand(order.brand);goTo('orders')
            }}/>}
        </>:
        canAdmin?<WatchLegacyOrdersPanel/>:null}
      </>}
      {activeSection==='logistics'&&<WatchLogisticsPanel
        key={'logistics-'+catalogVersion+'-'+brand+'-'+isLogisticsRole+'-'+(logisticsFocusOrderId||0)}
        focusOrderId={logisticsFocusOrderId}
        brand={isLogisticsRole?'all':brand||'all'} allowedBrands={brands.map(x=>x.code)}
        canDispatch={canSales||isLogisticsRole} canCorrectDispatch={canAdmin}
        canCompleteEngraving={canAdmin||isLogisticsRole}
        onOpenReturns={canSales?selected=>{
          setBrand(selected);setLastOrderBrand(selected);setReportOrderFocus(null);goTo('returns')
        }:undefined}
        onOpenStock={canWarehouse?selected=>{
          setBrand(selected);setLastOrderBrand(selected);goTo('warehouse')
        }:undefined}/>}
      {['warehouse','operations','revision','history','statistics','catalog'].includes(activeSection)&&<>
        <div className="warehouse-w2-navigation" data-w2-human-warehouse="task-navigation" data-cleanup-navigation="true">
          <div className="warehouse-w2-primary" aria-label="Разделы склада">
            {([
              {section:'warehouse' as const,label:'Остатки',hint:'Товар на месте, резерв и доступность'},
              {section:'catalog' as const,label:'Товары',hint:'Модели и комплектации часов'},
              {section:'statistics' as const,label:'Статистика',hint:'Продажи по комплектациям и реальным ценам'},
              ...(canWarehouse?[{section:'operations' as const,label:'Операции',hint:'Приход, списание, перемещение и пересчёт'},{section:'revision' as const,label:'Ревизия',hint:'Полная и выборочная проверка с сохранением'},{section:'history' as const,label:'История',hint:'Складские движения по товарам'}]:[]),
            ]).map(item=><button key={item.section} type="button"
              className={activeSection===item.section?'is-active':''} title={item.hint}
              aria-current={activeSection===item.section?'page':undefined}
              onClick={()=>goTo(item.section)}><strong>{item.label}</strong></button>)}
          </div>
        </div>
        <div className="watch-shell-catalog">
          <section className="client3-brand-workspace" aria-label="Независимые бренды склада">
            <div className="client3-brand-workspace-context">
              <div className="card-label">Бренд склада</div>
              <strong>{brand||'Бренд не выбран'}</strong>
              <p>У каждого бренда свои модели, комплектации и остатки. Действия применяются только к выбранному бренду.</p>
            </div>
            <div className="client3-brand-workspace-tabs" role="group" aria-label="Переключить бренд склада">
              {brands.map(row=><button key={row.code} type="button"
                aria-pressed={brand===row.code}
                className={brand===row.code?'is-active':''}
                onClick={()=>{setBrand(row.code);setError('')}}>
                <strong>{row.name}</strong>
                <small>{brand===row.code?'Выбран сейчас':'Перейти к бренду'}</small>
              </button>)}
            </div>
          </section>
          {brand&&activeSection==='statistics'?<WatchDemandMainPanel key={'demand-main-'+brand} brand={brand}/>:
          canWarehouse&&brand?(activeSection==='catalog'?
            <WatchCatalogEditor key={'catalog-'+brand} brand={brand} view="catalog" canEditPrices={canAdmin}
              onStockChanged={()=>setCatalogVersion(x=>x+1)}
              onOpenReferences={()=>goTo('references')}/>:
            activeSection==='history'?
              <WatchWarehouseHistory key={'history-'+brand+'-'+catalogVersion} brand={brand} revision={catalogVersion}/>:
            activeSection==='operations'||activeSection==='revision'?
              <WatchWarehouseMain key={(activeSection==='revision'?'revision-':'operation-')+brand} brand={brand}
                initialRevision={activeSection==='revision'}
                prefill={correctionPrefill?.brand===brand&&activeSection==='operations'?correctionPrefill:undefined}
                onStockChanged={()=>setCatalogVersion(x=>x+1)}/>:
              <WatchStockMainBrowse key={'stock-'+brand+'-'+catalogVersion}
                brand={brand} canCorrect={canWarehouse}
                onCorrect={selection=>{setCorrectionPrefill({brand,...selection});goTo('operations')}}/>):
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
      {activeSection==='references'&&brand&&<WatchReferencesSection
        brand={brand} brands={brands.map(x=>x.code)}
        onBrandChange={setBrand} canEdit={canWarehouse} canEditFinancialRefs={canAdmin} onOpenCatalog={()=>goTo('catalog')}
        onOpenStaff={canAdmin?()=>goTo('staff'):undefined}/>}
      {activeSection==='finance'&&brands.length>0&&
        <WatchFinancePanel key={'fin-'+catalogVersion} brands={brands.map(x=>x.code)}
          isAdmin={canAdmin} onOpenReferences={()=>goTo('references')}
          onOpenOrder={order=>{
            setReportOrderFocus(order);setLastOrderBrand(order.brand)
            goTo('orders')
          }}/>}
      {['staff','accounts'].includes(activeSection)&&canAdmin&&
        <WatchTeamMainPanel key={activeSection==='accounts'?'team-accounts':'team-staff'}
          initialMode={activeSection==='accounts'?'accounts':'employees'}/>}

    </div>
  </Client3MainChrome>
}
