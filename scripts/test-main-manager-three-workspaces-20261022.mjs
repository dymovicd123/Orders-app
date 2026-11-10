import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { workspaceModules } from '../src/app/constants.ts'
import { canOpenWorkspaceSector, canSeeWorkspaceMenuItem } from '../src/app/managerWorkspaceAccess.ts'

const managerIds = workspaceModules.filter(item => canSeeWorkspaceMenuItem('manager', item.id)).map(item => item.id)
assert.deepEqual(managerIds, ['orders', 'workshop', 'inventory', 'finance', 'leads', 'plan', 'reports'], 'Managers must see the current approved operational workspaces')
assert.equal(workspaceModules.filter(item => canSeeWorkspaceMenuItem('admin', item.id)).length, workspaceModules.length, 'Admin navigation must remain complete')
for (const sector of ['orders', 'workshop', 'inventory', 'reports', 'finance', 'leads', 'plan']) {
  assert(canOpenWorkspaceSector('manager', sector), 'Manager lost an operational workspace: '+sector)
}
for (const sector of ['overview', 'clients', 'references', 'team', 'kaspi']) {
  assert(!canOpenWorkspaceSector('manager', sector), 'Forbidden workspace reachable: '+sector)
  assert(canOpenWorkspaceSector('admin', sector), 'Administrator lost workspace: '+sector)
}
for (const module of workspaceModules) {
  assert(canSeeWorkspaceMenuItem('admin', module.id), 'Admin sidebar missing '+module.id)
}

const team = readFileSync('src/features/sections/TeamSection.tsx','utf8')
const timesheetWorkspace = readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
assert(team.includes('<TeamTimesheetWorkspace') && timesheetWorkspace.includes('Табель сотрудников') &&
  timesheetWorkspace.includes('Журнал по дням') && timesheetWorkspace.includes('График'), 'Timesheet heading and accessible day/calendar view must remain visible')
assert(!team.includes('Сымбат и администраторы не назначаются в табель'), 'Obsolete personalized timesheet notice returned')
assert(!team.includes('Выбери дни в календаре, сотрудников и время работы'), 'Obsolete timesheet instructions returned')
const app = readFileSync('src/App.tsx','utf8')
const orderCreation = readFileSync('src/features/orders/orderCreationActions.ts', 'utf8')
const gate = app.slice(app.indexOf('const syncSectorFromHash = () => {'), app.indexOf('window.addEventListener(\'hashchange\', syncSectorFromHash)'))
assert(gate.includes('!canOpenWorkspaceSector(authUser.role, nextSector)'), 'Deep links are not checked against authenticated role')
assert(gate.includes('window.history.replaceState(') && gate.includes('#orders'), 'Forbidden hash must be replaced with orders, without a back-loop')
assert(app.includes('[authUser?.id, authUser?.role, authUser?.mustChangePassword]'), 'Role changes must recheck navigation')
assert(app.includes('workspaceModules.filter((module) => canSeeWorkspaceMenuItem(accessRole, module.id))'), 'Sidebar must use shared role policy')
assert(app.includes('if (!canOpenWorkspaceSector(accessRole, activeSector))'), 'Forbidden content must not be shown before redirect')
assert(gate.includes("if (authUser.role === 'admin')"), 'Warehouse admin links must honor session role')
assert(gate.includes("setInventoryPanel('overview')") && gate.includes('#inventory'), 'Manager deep links into catalog/settings must land on normal warehouse')
assert(app.includes('<DeferredSection active={activeSector === \'orders\'} label="Заказы">'), 'Orders still render')
assert(app.includes('<DeferredSection active={activeSector === \'workshop\'} label="Цех">'), 'Workshop still renders')
assert(app.includes('<DeferredSection active={activeSector === \'inventory\'} label="Склад">'), 'Warehouse still renders')
assert(app.includes('<DeferredSection active={activeSector === \'reports\'} label="Отчёты">'), 'Reports section must render for managers')
assert(app.includes('createOrderCreationActions({') && orderCreation.includes("authUser?.role === 'manager'"), 'Manager session handling must stay active in delegated creation')
assert(!app.includes('setActiveSector(\'finance\')'), 'Manager business flow may not bypass role guard by direct state set')
// This change does not alter server roles, stock, finance, master-data or D1.

// The archive preview remains a separate, non-destructive confirmation UI.
assert(app.includes('<ArchiveMonthModal') && app.includes('archiveModalOpen ? ('),
  'Archive preview was not wired into the main application')
const builtModal = await build({
  entryPoints:['src/features/orders/ArchiveMonthModal.tsx'],
  platform:'node', format:'esm', target:'es2022', bundle:true,
  jsx:'automatic', write:false, logLevel:'silent',
})
const {ArchiveMonthModal} = await import(
  'data:text/javascript;base64,' + Buffer.from(builtModal.outputFiles[0].text).toString('base64')
)
const draft = {month:'2026-10',cutoffDate:'2026-10-31',includeNotSent:false,reason:'Закрытие месяца'}
const preview = {
  eligibleCount:1,
  blocked:{notClosed:2,withDebt:3,activeWorkshop:4,notSent:5},
  orders:[{id:1,externalId:'TEST-ORDER',orderDate:'2026-10-17',manager:'М',totalAmount:32000}],
}
const modalHtml = renderToStaticMarkup(createElement(ArchiveMonthModal,{
  archiveDraft:draft,archivePreview:preview,archiveBusy:false,
  setArchiveDraft:()=>{},setArchivePreview:()=>{},setArchiveModalOpen:()=>{},
  loadArchivePreview:async()=>{},runArchiveOrders:async()=>{},
}))
assert(modalHtml.includes('Проверить месяц') && modalHtml.includes('Архивировать месяц'),
  'Archive operations must remain two-step')
assert(modalHtml.includes('TEST-ORDER') && modalHtml.includes('Есть незакрытые долги: 3'),
  'Archive modal must still show eligibility and debt blockers')
assert(modalHtml.includes('type="month"') && modalHtml.includes('type="checkbox"'),
  'Archive cutoff and unsent-order acknowledgement disappeared')
const emptyHtml = renderToStaticMarkup(createElement(ArchiveMonthModal,{
  archiveDraft:draft,archivePreview:null,archiveBusy:false,
  setArchiveDraft:()=>{},setArchivePreview:()=>{},setArchiveModalOpen:()=>{},
  loadArchivePreview:async()=>{},runArchiveOrders:async()=>{},
}))
assert(emptyHtml.includes('Сначала проверьте месяц.') && emptyHtml.includes('disabled'),
  'Archive action must stay disabled before preview')

console.log('MANAGER_CURRENT_WORKSPACES_PASSED: role/menu, deep link, first-render and admin parity')
