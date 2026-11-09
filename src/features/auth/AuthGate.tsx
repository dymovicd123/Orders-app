import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { AuthUser } from '../../app/types'

// Presentation only. Session checks, login/setup race recovery, logout and
// forced password change continue to be owned by the existing App controller.
type AuthGateProps = {
  stage: 'checking' | 'login' | 'change-password'
  authUser: AuthUser | null
  authHasUsers: boolean
  authLogin: string
  authPassword: string
  authDisplayName: string
  authBootstrapLogin: string
  authBootstrapPassword: string
  authBusy: boolean
  passwordChangeBusy: boolean
  passwordChangeDraft: { currentPassword: string; newPassword: string }
  error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  setAuthLogin: Dispatch<SetStateAction<string>>
  setAuthPassword: Dispatch<SetStateAction<string>>
  setAuthDisplayName: Dispatch<SetStateAction<string>>
  setAuthBootstrapLogin: Dispatch<SetStateAction<string>>
  setAuthBootstrapPassword: Dispatch<SetStateAction<string>>
  setPasswordChangeDraft: Dispatch<SetStateAction<{ currentPassword: string; newPassword: string }>>
  submitAuth: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  submitPasswordChange: (event?: FormEvent<HTMLFormElement>) => void | Promise<void>
  logout: () => void | Promise<void>
}

export function AuthGate({
  stage,
  authUser,
  authHasUsers,
  authLogin,
  authPassword,
  authDisplayName,
  authBootstrapLogin,
  authBootstrapPassword,
  authBusy,
  passwordChangeBusy,
  passwordChangeDraft,
  error,
  setError,
  setAuthLogin,
  setAuthPassword,
  setAuthDisplayName,
  setAuthBootstrapLogin,
  setAuthBootstrapPassword,
  setPasswordChangeDraft,
  submitAuth,
  submitPasswordChange,
  logout,
}: AuthGateProps) {
  if (stage === 'checking') {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="erp-brand auth-brand">
            <div className="erp-brand-mark">S</div>
            <div>
              <div className="erp-brand-title">Система заказов</div>
              <div className="erp-brand-subtitle">Проверяем вход...</div>
            </div>
          </div>
          <p className="muted-note">Загрузка сессии.</p>
        </section>
      </main>
    )
  }

  if (stage === 'login') {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={submitAuth} method="post" action={authHasUsers ? '/api/auth/login' : '/api/auth/setup'} autoComplete="on">
          <div className="erp-brand auth-brand">
            <div className="erp-brand-mark">S</div>
            <div>
              <div className="erp-brand-title">Система заказов</div>
              <div className="erp-brand-subtitle">{authHasUsers ? 'Вход по логину и паролю' : 'Первый запуск'}</div>
            </div>
          </div>
          <div>
            <h1>{authHasUsers ? 'Вход' : 'Создать администратора'}</h1>
            <p>
              {authHasUsers
                ? 'Введите логин и пароль своего аккаунта.'
                : 'Подтвердите текущий админ-доступ и создайте первый персональный аккаунт администратора.'}
            </p>
          </div>
          {error ? <div className="app-alert error"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
          {!authHasUsers ? (
            <>
              <label>
                <span>Текущий админ-логин</span>
                <input id="auth-bootstrap-username" name="bootstrap-username" value={authBootstrapLogin} onChange={(event) => setAuthBootstrapLogin(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
              </label>
              <label>
                <span>Текущий админ-пароль</span>
                <input id="auth-bootstrap-password" name="bootstrap-password" value={authBootstrapPassword} onChange={(event) => setAuthBootstrapPassword(event.target.value)} type="password" autoComplete="current-password" required />
              </label>
              <label>
                <span>Имя администратора</span>
                <input value={authDisplayName} onChange={(event) => setAuthDisplayName(event.target.value)} placeholder="Например: Администратор" />
              </label>
            </>
          ) : null}
          <label>
            <span>{authHasUsers ? 'Логин' : 'Новый логин'}</span>
            <input id="auth-username" name="username" value={authLogin} onChange={(event) => setAuthLogin(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} placeholder="Например: admin" />
          </label>
          <label>
            <span>{authHasUsers ? 'Пароль' : 'Новый пароль'}</span>
            <input id="auth-password" name="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} type="password" autoComplete={authHasUsers ? 'current-password' : 'new-password'} required minLength={8} placeholder="Минимум 8 символов" />
          </label>
          <button className="primary" type="submit" disabled={authBusy}>
            {authBusy ? 'Проверяю...' : authHasUsers ? 'Войти' : 'Создать администратора'}
          </button>
        </form>
      </main>
    )
  }

  if (stage === 'change-password' && authUser) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={submitPasswordChange} method="post" action="/api/auth/change-password" autoComplete="on">
          <div className="erp-brand auth-brand">
            <div className="erp-brand-mark">S</div>
            <div>
              <div className="erp-brand-title">Система заказов</div>
              <div className="erp-brand-subtitle">Первый вход сотрудника</div>
            </div>
          </div>
          <div>
            <h1>Смените временный пароль</h1>
            <p>Администратор создал аккаунт с временным паролем. Перед работой нужно задать свой пароль.</p>
          </div>
          {error ? <div className="app-alert error"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
          <label>
            <span>Логин</span>
            <input id="auth-change-username" name="username" value={authUser.login} autoComplete="username" readOnly />
          </label>
          <label>
            <span>Текущий временный пароль</span>
            <input id="auth-current-password" name="current-password" value={passwordChangeDraft.currentPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, currentPassword: event.target.value }))} type="password" autoComplete="current-password" required />
          </label>
          <label>
            <span>Новый пароль</span>
            <input id="auth-new-password" name="new-password" value={passwordChangeDraft.newPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, newPassword: event.target.value }))} type="password" autoComplete="new-password" required minLength={8} />
          </label>
          <button className="primary" type="submit" disabled={passwordChangeBusy}>
            {passwordChangeBusy ? 'Сохраняю...' : 'Сменить пароль и войти'}
          </button>
          <button className="secondary" type="button" onClick={() => void logout()} disabled={passwordChangeBusy}>Выйти</button>
        </form>
      </main>
    )
  }


  return null
}
