import assert from 'node:assert/strict'
import fs from 'node:fs'
const workflow=fs.readFileSync('.github/workflows/cloudflare-deploy-monitor.yml','utf8')
const smoke=fs.readFileSync('scripts/verify-branch2-live-ui.mjs','utf8')
const view=fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx','utf8')
const event=workflow.slice(0,workflow.indexOf('\npermissions:'))
assert.match(event,/'src\/\*\*'/)
assert.match(event,/'worker\/\*\*'/)
assert.doesNotMatch(event,/'docs\/\*\*'/)
assert.match(workflow,/"database_name": "orders_db_branch2_mirror_20261027"/)
assert.match(workflow,/"database_id": "0904a573-21ff-44d8-93b0-c9200f771702"/)
assert.match(workflow,/"database_name": "orders_db_prod"/)
assert.doesNotMatch(workflow,/fallback_required|npm run deploy|wrangler deploy|Branch2 direct deploy fallback/,
  'Monitoring may not write to any Worker or D1')
assert.match(workflow,/if \[\[ "\$outcome" != "success" \]\]/)
assert.match(workflow,/node scripts\/verify-branch2-live-ui\.mjs/,
  'A successful native build must be checked against served Branch2 frontend')
assert.match(workflow,/exit 33/,'Stale published UI must fail rather than trigger an automatic deploy')
for(const label of ['Остатки какой точки?','С учтённым наличием или резервом','Активные модели каталога','На месте','В заказах']){
  assert(smoke.includes(label),'Public Branch2 smoke must test current stock interface: '+label)
  assert(view.includes(label),'Expected current view must implement: '+label)
}
assert(!smoke.includes('Фильтр выбирает товары, но внутри каждого товара видны все размеры'),
  'Do not demand deleted filter labels from public UI')
console.log('BRANCH2_CD_SAFETY_PASSED — monitor never deploys; current mirror D1 and current public stock interface required')
