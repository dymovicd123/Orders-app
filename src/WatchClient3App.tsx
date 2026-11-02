import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { WatchBrand } from '../shared/client3/watch-domain'
import { WatchLogisticsPanel } from './features/client3/WatchLogisticsPanel'
import type { WatchOrderChoice } from './features/client3/WatchOrderForm'
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
type LoginResponse = { ok: boolean; user?: User; message?: string }
async function api<T extends { ok: boolean; message?: string }>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init })
  const result = await response.json() as T
  if (!response.ok || !result.ok) throw new Error(result.message || 'Ошибка (' + response.status + ')')
  return result
}
const jsonHeaders = { 'Content-Type': 'application/json' }
function fullName(user: User) { return user.displayName || 'Сотрудник' }
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
  const [tab, setTab] = useState<'logistics' | 'catalog'>('logistics')
  const [models, setModels] = useState<WatchOrderChoice[]>([])
  const [catalogBusy, setCatalogBusy] = useState(false)

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
    if (!user || user.mustChangePassword || tab !== 'catalog' || !brand) {
      setModels([])
      return
    }
    const controller = new AbortController()
    setCatalogBusy(true)
    void api<ModelResponse>('/api/client3/watches/models?brand=' + encodeURIComponent(brand), {
      signal: controller.signal,
    }).then(result => {
      if (!controller.signal.aborted) setModels(result.models || [])
    }).catch(cause => {
      if (!controller.signal.aborted) { setModels([]); setError(cause instanceof Error ? cause.message : 'Каталог недоступен') }
    }).finally(() => { if (!controller.signal.aborted) setCatalogBusy(false) })
    return () => controller.abort()
  }, [user?.id, user?.mustChangePassword, brand, tab])

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
      <h1>TAUWACH / WACHIZEN</h1>
      <p>{hasUsers ? 'Вход в систему часов' : 'Первоначальная настройка администратора'}</p>
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
      <button type="button" className="watch-shell-secondary" onClick={() => void refreshAuth()}>Повторить проверку</button>
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

  return <div className="watch-shell">
    <header className="watch-shell-header">
      <div><h1>TAUWACH <span>/ WACHIZEN</span></h1><p>Система часов и логистики</p></div>
      <div className="watch-shell-session"><span>{fullName(user)}</span>
        <button type="button" disabled={busy} onClick={() => void logout()}>Выйти</button>
      </div>
    </header>
    <nav className="watch-shell-nav" aria-label="Разделы">
      <button type="button" aria-current={tab === 'logistics' ? 'page' : undefined}
        onClick={() => setTab('logistics')}>Логистика</button>
      {brands.length > 0 && <button type="button" aria-current={tab === 'catalog' ? 'page' : undefined}
        onClick={() => setTab('catalog')}>Каталог и остатки</button>}
    </nav>
    <main className="watch-shell-content">
      {error && <p role="alert" className="watch-shell-error">{error}</p>}
      {tab === 'logistics'
        ? <WatchLogisticsPanel brand="all"
            canCompleteEngraving={user.role === 'admin' || user.employeeRole === 'Логист'}/>
        : <section className="watch-shell-catalog">
            <div className="watch-shell-catalog-header"><h2>Каталог часов</h2>
              <label>Бренд <select value={brand} onChange={event => { setBrand(event.target.value as WatchBrand); setError('') }}>
                {brands.map(x => <option key={x.code} value={x.code}>{x.name}</option>)}
              </select></label>
            </div>
            <p>Наличие раздельно по офису и витрине; резерв уже вычтен из доступного количества.</p>
            {catalogBusy && <p>Загружаем каталог…</p>}
            {!catalogBusy && models.length === 0 && <p>Модели не добавлены или нет доступа.</p>}
            <div className="watch-shell-model-list">
              {models.map(model => <article key={model.watchVariantId}>
                <strong>{model.modelName}</strong>
                <p>{model.gender === 'male' ? 'Мужские' : 'Женские'} ·
                  {model.movement === 'quartz' ? 'Кварц' : 'Механика'} ·
                  {model.braceletMaterial} · {model.dialColor}
                  {model.braceletColor ? ' · ремешок: ' + model.braceletColor : ''}</p>
                <div>Офис: <strong>{sourceFree(model, true)}</strong> шт.</div>
                <div>Витрина: <strong>{sourceFree(model, false)}</strong> шт.</div>
              </article>)}
            </div>
          </section>}
    </main>
  </div>
}