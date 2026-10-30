import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=name=>readFileSync('.github/workflows/'+name+'.yml','utf8')
const monitor=read('cloudflare-deploy-monitor')
const city=read('main-city-staff-release-20261025')
const kpi=read('main-product-kpi-20261027')
const finance=read('test-main-finance-exchange-lineage')
const head=workflow=>workflow.slice(0,workflow.indexOf('\npermissions:'))
assert.match(head(monitor),/paths:\s*\n/, 'Only relevant code changes may request a cloud build monitor')
assert.match(head(monitor),/'worker\/\*\*'/)
assert.match(head(monitor),/'src\/\*\*'/)
assert.doesNotMatch(head(monitor),/'docs\/\*\*'/)
assert.doesNotMatch(monitor,/npm run deploy|wrangler deploy|fallback_required|Production direct deploy fallback/,
  'A build-status monitor must never turn an unrelated push into production publishing')
assert.match(monitor,/"database_name": "orders_db_branch2_mirror_20261027"/)
assert.match(monitor,/"database_id": "0904a573-21ff-44d8-93b0-c9200f771702"/)
assert.match(monitor,/"database_name": "orders_db_prod"/)
assert.match(monitor,/if \[\[ "\$outcome" != "success" \]\]/,
  'Non-successful native build may not be recorded as a successful deployment')
assert.match(city,/src\/features\/sections\/TeamSection\.tsx/)
assert.doesNotMatch(head(city),/push:/, 'One-off staff migration cannot auto-run on main push')
assert.doesNotMatch(head(city),/branches: \[main\]\s*\n\s*workflow_dispatch/, 'Main feature PR requires a path guard')
assert.match(head(kpi),/branches: \[release-product-kpi-leads-20261027\]/)
assert.match(head(kpi),/worker\/domains\/product-kpi\.ts/)
assert.doesNotMatch(head(kpi),/branches: \[release-product-kpi-leads-20261027, main\]/)
assert.doesNotMatch(head(finance),/package\.json/,
  'Package-only security updates must not trigger a historical finance selective release')
console.log('DEPLOYMENT_WORKFLOW_SAFETY_PASSED — no implicit prod fallback; scoped historic gates; explicit Branch2 mirror')
