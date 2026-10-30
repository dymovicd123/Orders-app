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


// Historical Production one-offs must remain present for audit, but inert.
const retiredProductionWorkflows = [
  "auth-production-migrations-0080-0081",
  "catalog-reference-production-schema-0090-0105",
  "client-zammler-production-migration-0075",
  "kaspi-production-migration-0082",
  "kaspi-production-post-deploy-reconcile",
  "main-admin-editor-schema-0110-0112",
  "main-ethno-manual-finalization-schema-0109",
  "main-retired-sku-schema-0113-0114",
  "main-stage04-dormant-schema-20261018",
  "one-off-prod-1734-targeted-cleanup",
  "oneoff-main-asiya-23-kaspi-paid-20261019",
  "oneoff-main-kaspi-sent-history-20261018",
  "stage03-production-migration-0072",
  "stage03-production-migrations-0073-0074",
  "oneoff-production-color-canary-1464",
  "oneoff-remaining26-colors-20261016",
  "oneoff-add-two-colors-rename23-20261016",
  "oneoff-batch8-color-20261016",
  "oneoff-color-1469-1584",
  "oneoff-ethno-four-keeper-colors-20261016",
  "oneoff-hide-retired-light-gray-reference-20261016"
]
for (const name of retiredProductionWorkflows) {
  const yaml=read(name)
  const events=yaml.slice(0,yaml.indexOf('\npermissions:')>=0?yaml.indexOf('\npermissions:'):yaml.indexOf('\njobs:'))
  assert.match(events,/on:\s*\n\s*workflow_dispatch:\s*\n/, name+' must have manual-only trigger')
  assert.doesNotMatch(events,/^\s*(?:push|pull_request|schedule|workflow_run):/m,
    name+' must never start automatically')
  const jobs=yaml.slice(yaml.indexOf('\njobs:')+1)
  const jobHeadings=(jobs.match(/^  [A-Za-z_][A-Za-z0-9_-]*:\s*$/gm)||[])
  const disabled=(jobs.match(/^    if: false # archived historical Production operation; never execute$/gm)||[])
  assert(jobHeadings.length>0,name+' must retain historical job definitions')
  assert.equal(disabled.length,jobHeadings.length,name+' all jobs must be hard-disabled')
  assert(!/^    if:(?! false # archived historical Production operation; never execute)/m.test(jobs),
    name+' must not have executable job conditions')
}
console.log('P0_LEGACY_PRODUCTION_WORKFLOWS_ARCHIVED: '+retiredProductionWorkflows.length+
  ' workflows, all job gates disabled and no push/PR triggers')
