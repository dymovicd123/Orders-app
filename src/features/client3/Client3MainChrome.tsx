import {useEffect,useState,type ReactNode} from 'react'
import {workspaceModules} from '../../app/constants'
// These are the actual unmodified Main ERP CSS layers, in App.tsx order.
import '../../styles/00-foundation.css'
import '../../styles/10-workshop-reports-team.css'
import '../../styles/20-inventory-dashboard.css'
import '../../styles/30-erp-stabilization.css'
import '../../styles/40-auth-import-catalog.css'
import '../../styles/50-inventory-matrix.css'
import '../../styles/60-shared-ui-regression.css'
import '../../styles/70-manager-ui.css'
import '../../styles/80-compact-operator.css'
import '../../styles/90-balanced-operator.css'
import '../../styles/95-scroll-and-layout-fixes.css'
import '../../styles/99-verified-workspace.css'
import '../../styles/100-natural-page-scroll.css'
import '../../styles/110-mobile-desktop-parity.css'
import '../../styles/120-inventory-direct-operations.css'
import '../../styles/130-native-table-scrolling.css'
import '../../styles/140-finance-truth.css'
import '../../styles/150-orders-finance-sync.css'
import '../../styles/160-inventory-matrix-usability.css'
import '../../styles/170-cash-stocktake-arrival.css'
import '../../styles/188g-adaptive-sidebar-scroll.css'
import '../../styles/188k3-safe-early-handover.css'
import '../../styles/189b-business-history.css'
import '../../styles/189c-reliable-money-history.css'
import '../../styles/finance-f4-money-journal.css'
import '../../styles/189d-team-activity-cleanup.css'
import '../../styles/1905-small-screen-acceptance.css'
import '../../styles/192b1-warehouse-attention.css'
import '../../styles/192c-arrival-recovery.css'
import '../../styles/195-kaspi-orders.css'
import '../../styles/client3-main-chrome.css'

export type WatchMainRoute='dashboard'|'reports'|'orders'|'create'|'returns'|'logistics'|'warehouse'|'operations'|'revision'|'history'|'catalog'|'exchange'|'finance'|'staff'|'accounts'|'legacy'|'references'
type User={id:number;role:string;employeeRole?:string;displayName?:string;login?:string}
const nav=[
  {route:'dashboard',module:'dashboard',label:'Инфопанель'},
  {route:'orders',module:'orders',label:'Заказы'},
  {route:'logistics',module:'workshop',label:'Логистика'},
  {route:'warehouse',module:'inventory',label:'Склад'},
  {route:'finance',module:'finance',label:'Финансы'},
  {route:'reports',module:'reports',label:'Отчёты'},
  {route:'staff',module:'team',label:'Команда'},
  {route:'references',module:'directory',label:'Справочники'},
] as const
const titles:Record<WatchMainRoute,{title:string;subtitle:string}>={
  dashboard:{title:'Инфопанель',subtitle:'Месячные показатели и сроки логистики'},
  reports:{title:'Отчёты',subtitle:'Оплаты, менеджеры, часы, города и долги'},
  orders:{title:'Заказы',subtitle:'Список, создание, возвраты и обмены'},
  create:{title:'Заказы',subtitle:'Список, создание, возвраты и обмены'},
  returns:{title:'Заказы',subtitle:'Список, создание, возвраты и обмены'},
  logistics:{title:'Логистика',subtitle:'Гравировка, готовность и сроки отправки'},
  warehouse:{title:'Склад',subtitle:'Остатки, операции и товары'},
  operations:{title:'Склад',subtitle:'Остатки, операции и товары'},
  revision:{title:'Склад',subtitle:'Ревизия: проверка количества и сохранение результатов'},
  history:{title:'Склад',subtitle:'История складских движений'},
  exchange:{title:'Заказы',subtitle:'Список, создание, возвраты и обмены'},
  catalog:{title:'Склад',subtitle:'Остатки, операции и товары'},
  finance:{title:'Финансы',subtitle:'Движение денег по брендам'},
  staff:{title:'Команда',subtitle:'Сотрудники и доступ к брендам'},
  accounts:{title:'Команда',subtitle:'Сотрудники и доступ к брендам'},
  legacy:{title:'Заказы',subtitle:'Исторические записи'},
  references:{title:'Справочники',subtitle:'Бренды, характеристики часов, доставка и способы оплаты'},
}
export function Client3MainChrome({user,section,onNavigate,onLogout,onRefresh,busy,canSales,children,error,success,warning}:{
  user:User;section:WatchMainRoute;onNavigate:(v:WatchMainRoute)=>void;onLogout:()=>void;onRefresh:()=>void;
  busy:boolean;canSales:boolean;children:ReactNode;error?:string;success?:string;warning?:string
}){
  const [mobileNavOpen,setMobileNavOpen]=useState(false)
  useEffect(()=>{
    document.body.classList.toggle('mobile-nav-open',mobileNavOpen)
    return ()=>document.body.classList.remove('mobile-nav-open')
  },[mobileNavOpen])
  const isAdmin=user.role==='admin'
  const current=section==='create'||section==='returns'||section==='exchange'||section==='legacy'?'orders':
    section==='catalog'||section==='operations'||section==='revision'||section==='history'?'warehouse':section==='accounts'?'staff':section
  const meta=titles[section]
  const display=user.displayName||'Сотрудник'
  return <main className="erp-shell client3-main-erp" data-sector={current}>
    <div className="global-alert-stack" aria-live="assertive" aria-atomic="true">
      {error&&<div className="error app-alert global-alert" role="alert"><span>{error}</span></div>}
      {success&&<div className="success app-alert global-alert" role="status"><span>{success}</span></div>}
      {warning&&<div className="app-alert global-alert" role="alert"><span>{warning}</span></div>}
    </div>
    <aside className={`erp-sidebar ${mobileNavOpen?'is-mobile-open':''}`.trim()}>
      <div className="erp-sidebar-scroll" tabIndex={0} aria-label="Навигация и режим доступа">
        <div className="erp-brand">
          <div className="erp-brand-mark">S</div>
          <div><div className="erp-brand-title">Система заказов</div>
            <div className="erp-brand-subtitle">Продажи · склад · логистика</div></div>
        </div>
        <button className="mobile-nav-toggle" type="button" aria-expanded={mobileNavOpen}
          aria-controls="primary-workspace-navigation"
          aria-label={mobileNavOpen?'Закрыть меню разделов':'Открыть меню разделов'}
          onClick={()=>setMobileNavOpen(open=>!open)}>
          <span className="mobile-nav-toggle-icon" aria-hidden="true"><i/><i/><i/></span>
          <span>{mobileNavOpen?'Закрыть':'Разделы'}</span>
        </button>
        <div className="erp-sidebar-card access-role-card">
          <div className="card-label">Аккаунт</div>
          <div className="access-role-control">
            <div className="auth-user-card"><strong>{display}</strong>
              <span>@{user.login||user.id}</span>
              <em>{isAdmin?'Администратор':user.employeeRole||'Менеджер'}</em></div>
            <div className="access-role-actions">
              {isAdmin&&<button className="secondary compact" type="button"
                onClick={()=>{onNavigate('accounts');setMobileNavOpen(false)}}>Аккаунты</button>}
              <button className="secondary compact" type="button" disabled={busy} onClick={onLogout}>Выйти</button>
            </div>
          </div>
        </div>
        <nav className="erp-primary-nav" id="primary-workspace-navigation" aria-label="Основные разделы">
          {nav.filter(item=>item.route!=='staff'||isAdmin)
            .filter(item=>canSales||(item.route==='logistics'))
            .map(item=>{
              const module=workspaceModules.find(entry=>entry.id===item.module)!
              const route=item.route as WatchMainRoute
              return <a key={route} href={'#'+route}
                className={`erp-primary-nav-button ${current===route?'is-current':''}`}
                title={item.label}
                aria-current={current===route?'page':undefined}
                onClick={e=>{e.preventDefault();onNavigate(route);setMobileNavOpen(false)}}>
                <span className="erp-nav-icon">{module.icon}</span>
                <span>{item.label}</span>
              </a>
            })}
        </nav>
        <div className="erp-sidebar-footer">Рабочая панель: заказы, логистика и склад.</div>
      </div>
    </aside>
    <button className={`mobile-nav-backdrop ${mobileNavOpen?'is-visible':''}`.trim()}
      type="button" aria-label="Закрыть меню разделов" tabIndex={mobileNavOpen?0:-1}
      onClick={()=>setMobileNavOpen(false)}/>
    <div className="erp-main">
      <header className="erp-topbar">
        <div className="erp-page-context">
          <div className="erp-page-kicker">Рабочий раздел</div>
          <h2 className="erp-page-title">{meta.title}</h2>
          <div className="erp-page-subtitle">{meta.subtitle}</div>
        </div>
        <div className="erp-topbar-actions">
          <button className="primary" type="button" onClick={onRefresh} disabled={busy}>
            {busy?'Обновляю…':'Обновить'}
          </button>
          <div className="erp-topbar-status">
            <span className="hint">Роль: <strong>{isAdmin?'Админ':user.employeeRole||'Менеджер'}</strong></span>
            <span className="status-pill status-online">Сессия активна</span>
          </div>
        </div>
      </header>
      {children}
    </div>
  </main>
}
