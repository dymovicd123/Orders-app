import assert from 'node:assert/strict'
import fs from 'node:fs'
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
console.log('BRANCH2_CD_SAFETY_PASSED — no implicit deploy and isolated D1; manual version promotion required')
