import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

function source(file){return readFileSync('.github/workflows/'+file,'utf8')}
function pullPart(file){
 const sourceText=source(file)
 assert.match(sourceText,/pull_request:\s*\n\s+branches:\s*\[main\]/,'PR Main target removed from '+file)
 const begin=sourceText.indexOf('  pull_request:')
 assert(begin>=0)
 const endA=sourceText.indexOf('\n  workflow_dispatch:',begin+1)
 const endB=sourceText.indexOf('\n  push:',begin+1)
 const end=Math.min(...[endA,endB].filter(x=>x>=0))
 assert(end>begin,file+' PR event bounds')
 const text=sourceText.slice(begin,end)
 assert.match(text,/\n\s+paths:/,'selective paths missing from '+file)
 return text
}
const kpi=pullPart('main-product-kpi-20261027.yml')
assert(kpi.includes('worker/domains/product-kpi.ts')&&kpi.includes('migrations/0116_monthly_product_kpi.sql'))
assert(!kpi.includes('inventory-movement.ts')&&!kpi.includes('src/App.tsx'))
const staff=pullPart('main-city-staff-release-20261025.yml')
assert(staff.includes('worker/domains/team.ts')&&staff.includes('migrations/0115_team_birth_date.sql'))
assert(!staff.includes('inventory-movement.ts')&&!staff.includes('src/App.tsx'))
const oldResolver=pullPart('main-resolver-selective-20261022.yml')
assert(oldResolver.includes('scripts/main-resolver-selective-release-20261022.mjs'))
assert(!oldResolver.includes('worker/domains/order-reservations.ts')&&!oldResolver.includes('src/features/orders/OrderCatalogResolutionModal.tsx'))
assert(source('main-resolver-selective-20261022.yml').includes('workflow_dispatch:'))
const w12=pullPart('main-w12-operations-only-20261024.yml')
assert(w12.includes('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx'))
assert(!w12.includes('worker/domains/inventory-movement.ts')&&!w12.includes('worker/index.ts'))
// Do not confuse a historical limited release with universal security or current-code regression checks.
const quality=source('quality-check.yml')
assert(quality.includes('npm audit --omit=dev --audit-level=moderate'))
assert(quality.includes('npm audit --audit-level=high'))
assert(quality.includes('node scripts/test-main-current-business-release-20261031.mjs'))
assert(quality.includes('npm run build'))
assert(source('main-product-kpi-20261027.yml').includes('branches: [release-product-kpi-leads-20261027, main]'),'KPI production push trigger changed')
for(const file of ['main-city-staff-release-20261025.yml','main-w12-operations-only-20261024.yml']){
 assert.match(source(file),/push:\s*\n\s+branches:\s*\[main\]/,'main push safety trigger changed in '+file)
}
console.log('MAIN_CI_RELEASE_GATE_SCOPE_PASS — unrelated legacy PR checks scoped; global production audits, main push security and build remain enabled')
