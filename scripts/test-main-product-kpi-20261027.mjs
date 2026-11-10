import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
const read = p => readFileSync(p,'utf8')
const src=read('worker/domains/product-kpi.ts')
const worker=read('worker/index.ts')
const screen=read('src/features/sections/ProductKpiSection.tsx')
const plan=read('src/features/sections/PlanSection.tsx')
const access=read('src/app/managerWorkspaceAccess.ts')
const app=read('src/App.tsx')
const migration=read('migrations/0116_monthly_product_kpi.sql')
const has=(text,phrase)=>assert.ok(text.includes(phrase),'Missing: '+phrase)
has(migration,'CREATE TABLE IF NOT EXISTS product_kpis')
has(migration,'CREATE TABLE IF NOT EXISTS product_kpi_participants')
has(migration,'PRIMARY KEY(kpi_id,manager_id)')
has(migration,'CREATE TABLE IF NOT EXISTS product_kpi_audit')
has(access,"'leads', 'plan'")
has(worker,"url.pathname === '/api/product-kpis'")
has(worker,"url.pathname === '/api/product-kpis/eligible-managers'")
has(worker,"requireAdminUser(authUser, 'KPI может изменять только администратор.")
has(worker,"requireAdminUser(authUser, 'Удаление KPI доступно только администратору.")
has(worker,'authUser!')
has(worker,"url.pathname === '/api/leads'")
has(worker,"const denied = requireAdminUser(authUser, 'Денежные планы доступны только администратору.')")
const lead=read('src/features/sections/LeadsSection.tsx')
has(lead,'{isAdmin ? <button')
has(app,'<LeadsSection ctx={{ isAdmin,')
assert.match(app, /<PlanSection ctx=\{\{ apiFetch,(?: askActionConfirmation,)? currentManagerId:/, 'Plan workspace still receives current manager context')
assert.ok(!read('src/app/managerWorkspaceAccess.ts').includes("'salary'"), 'Salary must not be available to managers')
has(plan,"page === 'kpi' || !isAdmin")
has(plan,'ProductKpiSection')
has(app,"activeSector === 'plan' && isAdmin")
has(src,'filterKeys')
has(src,"'ADULT','ВЗРОСЛЫЙ'")
has(src,"'CHILD','KID','KIDS'")
has(src,"AND DATE(o.order_date) BETWEEN ? AND ? AND oi.product_id=? AND oi.quantity>0")
assert.ok(!src.includes('В каталоге не найдено ни одного действующего варианта'), 'Do not block unseen combinations')
has(src,'SUM(MAX(0,oi.quantity-COALESCE(ret.returned,0)))')
assert.ok(!src.includes("o.shipping_status='sent'"), 'Current KPI counts net order units without waiting for shipment')
has(src,"countingRule:'ordered_net_current_v2'")
has(src,"o.order_status<>'deleted'")
has(src,"ri.order_item_id")
has(src,'e.refund_return_id=r.id')
has(src,"managerId=toInt(user.managerId,0)")
has(src,"AND EXISTS(SELECT 1 FROM product_kpi_participants")
has(src,'new Set(parts.map')
has(src,'!==total')
has(src,"TRIM(COALESCE(role,'')) IN ('Менеджер'")
has(src,'expectedUpdatedAt')
has(src,"product_kpi_audit")
has(screen,"distribute(d.participants,d.targetQuantity)")
has(screen,"toggleManager")
has(screen,"overlap(r.filters,draft.filters)")
has(screen,"if(quotaSum!==draft.targetQuantity)")
has(screen,'filterKeys.map(key=>')
has(screen,'void load(month)')
has(screen,'records.map(k=>')
has(screen,'earnedBonus')
has(screen,'KpiProgressOverview')
has(screen,'Выполнение KPI')
has(screen,'Бонус при выполнении')
has(screen,'Итого по заданию')
has(screen,'pkpi-overview-table')
has(screen,'pkpi-overview-mobile')
has(screen,'onEdit={edit}')
has(screen,'onRemove={row=>void remove(row)}')
assert.ok(!screen.includes('pkpi-list'), 'Replace redundant task cards with one useful progress table')
has(screen,'handleProductKey')
has(screen,'pkpi-search-results')
has(screen,'slice(0,8)')
has(screen,"query.length<2")
has(screen,'pkpi-attributes-toggle')
has(screen,'<KpiCharacteristicPicker key={key}')
has(screen,"apiFetch('/api/reference-values?kind='+kind)")
has(screen,'referenceOptions={key===')
has(screen,"setReferenceStatus('ready')")
has(screen,"setReferenceStatus('error')")
has(screen,"onClick={()=>setReferenceStatus('idle')}")
const chooser=read('src/features/sections/KpiCharacteristicPicker.tsx')
has(chooser,'У этой модели')
has(chooser,'Из справочника')
has(chooser,'const officialExact=options.find')
has(chooser,'const exactFirst=')
has(chooser,'Использовать «{queryValue}»')
has(chooser,'referenceStatus === \'ready\'')
assert.ok(!chooser.includes('<datalist'), 'Avoid native dark system dropdown')
has(read('src/styles/product-kpi.css'),'.pkpi-choice-menu{position:absolute')
has(screen,'Выбранных сочетаний пока нет у модели')
assert.ok(!screen.includes('Таких комбинаций в каталоге нет'), 'Never block a manually specified KPI combination')
has(screen,'<svg width="18" height="18"')
assert.ok(!screen.includes("{chosen?'✓':'+'}"), 'Use symmetric CSS selector instead of offset glyphs')
has(screen,'setDetailsOpen')
has(screen,'pkpi-bonus-common')
has(screen,'pkpi-create-button')
has(screen,"setSearchOpen(false)")
assert.ok(!screen.includes('pkpi-product-choices'), 'Do not display the complete product catalog as a wall of buttons')
const styles=read('src/styles/product-kpi.css')
has(styles,'.pkpi-editor{width:100%;max-width:1140px')
has(styles,"grid-template-areas:'product members' 'target members'")
has(styles,'@media(max-width:1020px)')
has(styles,'.pkpi-search-results{position:absolute')
has(styles,'@media(max-width:740px)')
has(styles,'.pkpi-overview-table{width:100%')
has(styles,'@media(max-width:720px)')
has(styles,'.pkpi-overview-mobile{display:none}')
assert.ok(!src.includes("INSERT INTO payments"))
assert.ok(!src.includes("INSERT INTO financial_events"))
assert.ok(!src.includes("UPDATE plans SET"))
const even=(total,persons)=>{
 const floor=Math.floor(total/persons),remainder=total%persons
 return Array.from({length:persons},(_,i)=>floor+(i<remainder?1:0))
}
assert.deepEqual(even(90,4),[23,23,22,22])
assert.deepEqual(even(100,4),[25,25,25,25])
assert.equal(even(90,4).reduce((a,b)=>a+b,0),90)

// Exercise the actual typed Plan read/create/delete frontend, not just source markers.
const compiledPlan = await build({
  entryPoints: ['src/features/plans/planActions.ts'], bundle: true,
  platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
})
const { createPlanActions } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiledPlan.outputFiles[0].text).toString('base64')
)
const calls = []
let planReportValue = null
let planError = null
let planMessage = null
let managerDraftValue = null
let departmentDraftValue = null
let financeRefreshes = 0
let responseCode = 200
let planDialogApproved = true
const planDialogMessages = []
const managerDraft = {
  id: 0, periodStart: '2026-11-01', periodEnd: '2026-11-30',
  managerId: 9, managerName: 'Менеджер', plannedAmount: 500000,
  salaryBase: 0, comment: '',
}
const departmentDraft = {
  id: 0, periodStart: '2026-11-01', periodEnd: '2026-11-30',
  plannedAmount: 2000000, comment: '',
}
const planArgs = {
  isAdmin: true,
  planFilters: { dateFrom: '2026-11-01', dateTo: '2026-11-30' },
  planReport: null, managerPlanDraft: managerDraft, departmentPlanDraft: departmentDraft,
  askActionConfirmation: async (message) => { planDialogMessages.push(message); return planDialogApproved },
  setManagerPlanDraft: (value) => { managerDraftValue = value },
  setDepartmentPlanDraft: (value) => { departmentDraftValue = value },
  setPlanBusy: () => {},
  setPlanReport: (value) => { planReportValue = value },
  setError: (value) => { planError = value },
  setMessage: (value) => { planMessage = value },
  apiFetch: async (url, init) => {
    calls.push({ url, init })
    const body = url.startsWith('/api/plans?')
      ? { ok: true, managerPlans: [{id: 12}], departmentPlans: [{id: 15}] }
      : { ok: responseCode === 200, message: responseCode === 200 ? undefined : 'Изменено конкурентно' }
    return new Response(JSON.stringify(body), {
      status: responseCode, headers: { 'Content-Type': 'application/json' },
    })
  },
  reportReadFailure: (err) => { throw err },
  refreshFinanceReportsIfVisible: async () => { financeRefreshes++ },
}
const plans = createPlanActions(planArgs)
await plans.loadPlans()
assert.deepEqual(planReportValue, { managerPlans: [{ id: 12 }], departmentPlans: [{ id: 15 }] })
assert.equal(calls[0].url, '/api/plans?startDate=2026-11-01&endDate=2026-11-30')
await plans.saveManagerPlan()
const managerPost = calls.find(c => c.url === '/api/plans' && c.init?.method === 'POST')
assert(managerPost, 'Admin plan save must use original endpoint')
assert.deepEqual(JSON.parse(managerPost.init.body), {
  ...managerDraft, salaryBase: 100000, bonusHitPercent: 5, bonusMissPercent: 3,
})
assert.equal(financeRefreshes, 1, 'Manager plan updates should refresh financial reports after save')
assert.equal(managerDraftValue.managerId, 0)
assert.equal(managerDraftValue.salaryBase, 100000)
assert.match(planMessage, /План менеджера сохранён/)
await plans.saveDepartmentPlan()
const departmentPost = calls.find(c => c.url === '/api/department-plans' && c.init?.method === 'POST')
assert.deepEqual(JSON.parse(departmentPost.init.body), departmentDraft)
assert.equal(financeRefreshes, 2)
assert.equal(departmentDraftValue.plannedAmount, 0)
await plans.deleteManagerPlan(12)
assert(calls.some(c => c.url === '/api/plans/12' && c.init.method === 'DELETE'))
await plans.deleteDepartmentPlan(15)
assert(calls.some(c => c.url === '/api/department-plans/15' && c.init.method === 'DELETE'))
assert.equal(financeRefreshes, 4, 'Both deletion paths must refresh finance after success')
assert.equal(planDialogMessages.length, 2, 'Both deletes require an explicit in-app confirmation')
assert.match(planDialogMessages[0], /Удалить план менеджера/)
assert.match(planDialogMessages[1], /Удалить план отдела/)
const beforeCancelled = calls.length
planDialogApproved = false
await plans.deleteManagerPlan(12)
assert.equal(calls.length, beforeCancelled, 'Cancelling a plan deletion must not issue a DELETE')
planDialogApproved = true
// An admin plan HTTP failure must not silently publish a successful save or refresh.
responseCode = 409
planMessage = null
const beforeFinance = financeRefreshes
await plans.saveManagerPlan()
assert.equal(financeRefreshes, beforeFinance)
assert.equal(planMessage, null)
assert.match(planError, /Изменено конкурентно/)
// Managers may read but not alter salary, plan or department budgets.
const managerPlans = createPlanActions({ ...planArgs, isAdmin: false })
const beforeDeny = calls.length
await managerPlans.saveManagerPlan()
await managerPlans.saveDepartmentPlan()
await managerPlans.deleteManagerPlan(12)
await managerPlans.deleteDepartmentPlan(15)
assert.equal(calls.length, beforeDeny)
assert.match(planError, /только администратору/)

console.log('PRODUCT_KPI_AND_LEADS_INVARIANTS_PASS')
