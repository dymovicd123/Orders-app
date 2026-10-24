import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { workspaceModules } from '../src/app/constants.ts'
import { canOpenWorkspaceSector, canSeeWorkspaceMenuItem } from '../src/app/managerWorkspaceAccess.ts'
const allowed=['orders','workshop','inventory','reports','finance']
const visible=workspaceModules.filter(item=>canSeeWorkspaceMenuItem('manager',item.id)).map(item=>item.id)
assert.deepEqual(visible,allowed,'Managers should see Finance in addition to four existing workspaces')
for(const sector of allowed){
  assert.equal(canOpenWorkspaceSector('manager',sector),true,sector+' should be open')
  assert.equal(canSeeWorkspaceMenuItem('manager',sector),true,sector+' should be visible')
}
for(const sector of ['overview','clients','references','leads','plan','team','kaspi']){
  assert.equal(canOpenWorkspaceSector('manager',sector),false,sector+' must remain restricted')
  assert.equal(canSeeWorkspaceMenuItem('manager',sector),false,sector+' must stay hidden')
}
for(const module of workspaceModules)assert(canSeeWorkspaceMenuItem('admin',module.id))
const app=readFileSync('src/App.tsx','utf8')
assert.match(app,/canOpenWorkspaceSector\(authUser\.role, nextSector\)/)
assert.match(app,/workspaceModules\.filter\(\(module\) => canSeeWorkspaceMenuItem\(accessRole, module\.id\)\)/)
assert.match(app,/canOpenWorkspaceSector\(accessRole, activeSector\)/)
const finance=readFileSync('src/features/sections/FinanceSection.tsx','utf8')
assert.match(finance,/FinanceDashboardRenderer/)
console.log('MANAGER FINANCE ACCESS PASSED — menu/deep link, safe role exclusions, Finance component, admin parity')
