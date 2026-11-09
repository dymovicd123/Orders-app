import fs from 'node:fs'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const app = read('src/App.tsx')
  const authGate = read('src/features/auth/AuthGate.tsx')
  check(app.includes('<AuthGate stage="login"') && app.includes('<AuthGate stage="change-password"'), 'App does not render the extracted login/forced-change gates')

  check(app.includes('async function offerBrowserPasswordSave'), 'Credential Management helper missing')
  check(app.includes('PasswordCredentialCtor') && app.includes('navigator.credentials.store(credential)'), 'Browser credential store integration missing')
  check(app.includes("if (!user.mustChangePassword) await offerBrowserPasswordSave(authLogin, authPassword)"), 'Temporary-password login is not excluded from browser save')
  check(app.includes('await offerBrowserPasswordSave(authLogin, authPassword)'), 'Successful permanent login is not offered to the browser password manager')
  check(app.includes('await offerBrowserPasswordSave(authUser.login, newPassword)'), 'Changed permanent password is not offered to the browser password manager')

  check(authGate.includes("action={authHasUsers ? '/api/auth/login' : '/api/auth/setup'}") && authGate.includes('method="post"'), 'Login form does not expose stable POST semantics')
  const combinedForms = app + '\n' + authGate
  check((combinedForms.match(/action="\/api\/auth\/change-password"/g) || []).length === 2, 'Both password-change forms must expose the password-change action')
  check((combinedForms.match(/autoComplete="username"/g) || []).length >= 3, 'Username autocomplete is missing from a password-change flow')
  check((combinedForms.match(/autoComplete="current-password"/g) || []).length >= 3, 'Current-password autocomplete is missing from a password-change flow')
  check((combinedForms.match(/autoComplete="new-password"/g) || []).length >= 2, 'New-password autocomplete is missing from a password-change flow')

  const forcedChange = authGate.slice(authGate.indexOf('Первый вход сотрудника'))
  check(forcedChange.includes('value={authUser.login}') && forcedChange.includes('name="username"'), 'Forced password change does not carry the account username')
  check(forcedChange.includes('name="current-password"') && forcedChange.includes('name="new-password"'), 'Forced password change field semantics missing')

  const modalStart = app.indexOf('aria-label="Смена пароля"')
  const modalEnd = app.indexOf('{authUsersOpen && isAdmin', modalStart)
  const modal = app.slice(modalStart, modalEnd)
  check(modal.includes('value={authUser.login}') && modal.includes('name="username"'), 'Regular password-change modal does not carry the account username')
  check(modal.includes('autoComplete="current-password"') && modal.includes('autoComplete="new-password"'), 'Regular password-change modal autocomplete semantics missing')


  // SSR actual extracted forms: the browser still sees the correct names,
  // form actions and autocomplete fields in every auth state.
  const bundle = await build({
    entryPoints:['src/features/auth/AuthGate.tsx'], bundle:true,
    platform:'node', format:'esm', target:'es2022', jsx:'automatic',
    write:false, logLevel:'silent',
  })
  const { AuthGate } = await import(
    'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
  )
  const props = {
    authUser: {id:1,login:'admin',role:'admin',mustChangePassword:true},
    authHasUsers:true, authLogin:'admin', authPassword:'',
    authDisplayName:'', authBootstrapLogin:'admin', authBootstrapPassword:'',
    authBusy:false, passwordChangeBusy:false, passwordChangeDraft:{currentPassword:'',newPassword:''},
    error:null,
    setError:()=>{}, setAuthLogin:()=>{}, setAuthPassword:()=>{},
    setAuthDisplayName:()=>{}, setAuthBootstrapLogin:()=>{}, setAuthBootstrapPassword:()=>{},
    setPasswordChangeDraft:()=>{}, submitAuth:()=>{},submitPasswordChange:()=>{},logout:()=>{},
  }
  const loginHtml = renderToStaticMarkup(createElement(AuthGate,{...props,stage:'login'}))
  check(loginHtml.includes('action="/api/auth/login"') && loginHtml.includes('name="username"') && loginHtml.includes('name="password"'),
    'Actual login form dropped username/password or HTTP action')
  const setupHtml = renderToStaticMarkup(createElement(AuthGate,{...props,stage:'login',authHasUsers:false}))
  check(setupHtml.includes('action="/api/auth/setup"') && setupHtml.includes('name="bootstrap-password"'),
    'First-admin setup no longer requests bootstrap credentials')
  const forcedHtml = renderToStaticMarkup(createElement(AuthGate,{...props,stage:'change-password'}))
  check(forcedHtml.includes('action="/api/auth/change-password"') && forcedHtml.includes('name="current-password"') && forcedHtml.includes('name="new-password"'),
    'Forced password change lost form credentials')
  const checkingHtml = renderToStaticMarkup(createElement(AuthGate,{...props,stage:'checking'}))
  check(checkingHtml.includes('Загрузка сессии.') && !checkingHtml.includes('type="password"'),
    'Loading state must not render an editable credential field')

  console.log('AUTH R6 PASSWORD MANAGER PASSED — permanent credentials are offered explicitly, temporary passwords are skipped, and both change-password forms carry username/current/new semantics.')
} catch (error) {
  console.error(`AUTH R6 PASSWORD MANAGER FAILED: ${error?.message || error}`)
  process.exit(1)
}
