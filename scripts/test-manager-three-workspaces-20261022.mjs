import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { workspaceModules } from '../src/app/constants.ts'
import { canOpenWorkspaceSector, canSeeWorkspaceMenuItem } from '../src/app/managerWorkspaceAccess.ts'

const managerIds = workspaceModules.filter(item => canSeeWorkspaceMenuItem('manager', item.id)).map(item => item.id)
assert.deepEqual(managerIds, ['orders', 'workshop', 'inventory', 'finance', 'reports'], 'Managers must see Orders, Workshop, Inventory, Reports and Finance')
assert.equal(workspaceModules.filter(item => canSeeWorkspaceMenuItem('admin', item.id)).length, workspaceModules.length, 'Admin navigation must remain complete')
for (const sector of ['orders', 'workshop', 'inventory', 'reports', 'finance']) {
  assert(canOpenWorkspaceSector('manager', sector), 'Manager lost an operational workspace: '+sector)
}
for (const sector of ['overview', 'clients', 'references', 'leads', 'plan', 'team', 'kaspi']) {
  assert(!canOpenWorkspaceSector('manager', sector), 'Forbidden workspace reachable: '+sector)
  assert(canOpenWorkspaceSector('admin', sector), 'Administrator lost workspace: '+sector)
}
for (const module of workspaceModules) {
  assert(canSeeWorkspaceMenuItem('admin', module.id), 'Admin sidebar missing '+module.id)
}

const team = readFileSync('src/features/sections/TeamSection.tsx','utf8')
assert(team.includes('<h3>Табель</h3>'), 'Timesheet heading must remain visible')
assert(!team.includes('Сымбат и администраторы не назначаются в табель'), 'Obsolete personalized timesheet notice returned')
assert(!team.includes('Выбери дни в календаре, сотрудников и время работы'), 'Obsolete timesheet instructions returned')
const app = readFileSync('src/App.tsx','utf8')
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
assert(app.includes('authUser?.role === \'manager\''), 'Manager session handling must stay active')
assert(!app.includes('setActiveSector(\'finance\')'), 'Finance navigation must use the role guard')
// This change does not alter server roles, stock, finance, master-data or D1.
console.log('MANAGER_FIVE_WORKSPACES_PASSED: role/menu, deep link, first-render and admin parity')
