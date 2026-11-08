import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
const workflow=fs.readFileSync('.github/workflows/cloudflare-deploy-monitor.yml','utf8')
const wrangler=fs.readFileSync('wrangler.jsonc','utf8')
const smoke=fs.readFileSync('scripts/verify-branch2-live-ui.mjs','utf8')
const view=fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx','utf8')
const events=workflow.slice(0,workflow.indexOf('\npermissions:'))
assert.match(events,/on:\s*\n  workflow_dispatch:/)
assert.doesNotMatch(events,/^\s*(?:push|pull_request|schedule|workflow_run):/m)
assert.match(workflow,/^    if: false$/m)
assert.doesNotMatch(workflow,/(?:fallback_required|npm run deploy|wrangler deploy|npx wrangler|--remote)/)
assert(wrangler.includes('"name": "orders-app-branch2"'))
assert(wrangler.includes('"database_name": "orders_db_branch2_mirror_20261027"'))
assert(wrangler.includes('"database_id": "0904a573-21ff-44d8-93b0-c9200f771702"'))
assert(!wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'))
for(const label of ['Остатки какой точки?','С учтённым наличием или резервом','Активные модели каталога','На месте','В заказах']){
 assert(smoke.includes(label))
 assert(view.includes(label))
}

// Manual publication uses one permanent reusable CLI, not an implicit workflow.
// The offline check must never need cloud credentials, network or real D1.
const command='scripts/branch2-manual-release.mjs'
const offline=spawnSync(process.execPath,[command,'--check'],{encoding:'utf8'})
assert.equal(offline.status,0,'Offline release isolation check failed: '+offline.stderr)
assert.match(offline.stdout,/BRANCH2_MANUAL_RELEASE_CONFIG_PASS/)
for(const unsafe of [
  ['--publish','--sha','0000000000000000000000000000000000000000'],
  ['--publish','--sha','0000000000000000000000000000000000000000','--confirm','MAIN'],
  ['--dry-run','--sha','not-a-full-sha'],
  ['--check','--publish'],
]){
  const rejected=spawnSync(process.execPath,[command,...unsafe],{encoding:'utf8'})
  assert.notEqual(rejected.status,0,'Unsafe manual-release input must be rejected before any external operation')
}
const source=fs.readFileSync(command,'utf8')
assert.match(source,/git\('ls-remote','origin','refs\/heads\/branch2'\)/)
assert.match(source,/git\('status','--porcelain','--untracked-files=all'\)/)
assert.match(source,/if\(mode==='--publish' && fields\.get\('--confirm'\)!=='BRANCH2-ONLY'\)/)
assert.match(source,/const before=query\(fingerprintSql\)/)
assert.match(source,/const after=query\(fingerprintSql\)/)
assert.doesNotMatch(source,/wrangler','d1','migrations|wrangler','d1','delete/)
console.log('BRANCH2_MANUAL_RELEASE_INPUT_SAFETY_PASSED: offline isolated config, full SHA, explicit consent, read-only D1 probes')

console.log('BRANCH2_CD_SAFETY_PASSED — no implicit deploy and isolated D1; manual version promotion required')
