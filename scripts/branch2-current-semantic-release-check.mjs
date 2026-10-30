// Branch2 current-release candidate: assert current behavior, never rewrite source files.
// Historical source-pinned replay stays opt-in: release:check:historical-branch2.
// This script performs no network calls, D1 writes, git checkout or deployment.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const fail = (message) => { throw new Error(message) }
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8')
const required = [
  '"name": "orders-app-branch2"',
  '"binding": "DB"',
  '"database_name": "orders_db_branch2_mirror_20261027"',
  '"database_id": "0904a573-21ff-44d8-93b0-c9200f771702"',
]
for (const marker of required) {
  if (!wrangler.includes(marker)) fail('Branch2 isolation changed: missing ' + marker)
}
for (const marker of [
  'orders_db_prod',
  '17e68a41-1d58-4a36-8a63-47c3e32443c4',
  '40065052-854e-44b8-bcd5-251bdd488301',
]) {
  if (wrangler.includes(marker)) fail('Unsafe D1 identity in Branch2 configuration: ' + marker)
}
if ((wrangler.match(/"binding"\s*:\s*"DB"/g) || []).length !== 1) {
  fail('Branch2 must use exactly one DB binding')
}

const groups = [
  ['DB isolation and safety', [
    'scripts/verify-database-safety.mjs',
    'scripts/test-branch2-environment.mjs',
    'scripts/test-order-shortage-explicit-decision-20261030.mjs',
    'scripts/test-p0-shortage-confirmation-reachable-20261030.mjs',
    'scripts/test-atomic-reservation-admission-20261030.mjs',
    'scripts/test-pending-reservation-resolution-20261030.mjs',
    'scripts/test-p0-critical-order-reservation-retry-20261030.mjs',
    'scripts/test-p0-http-pending-reservation-20261030.mjs',
    'scripts/test-p0-http-create-core-20261030.mjs',
    'scripts/test-p0-mapped-entity-lease-sql-20261030.mjs',
    'scripts/test-order-manager-schema-reconciliation-20261030.mjs',
    'scripts/test-branch2-current-d1-readonly-preflight-20261030.mjs',
    'scripts/test-branch2-cd-safety-20261030.mjs',
    'scripts/test-branch2-legacy-cloudflare-workflows-archived-20261030.mjs',
  ]],
  ['Orders, shipment and reservations', [
    'scripts/test-branch2-shipping-no-shortage-confirmation-20261021.mjs',
    'scripts/test-mistaken-shipping-physical-restore-20261028.mjs',
    'scripts/test-old-order-post-stocktake-guard-r1.mjs',
    'scripts/test-old-order-post-stocktake-handover-r1.mjs',
    'scripts/test-branch2-resolver-historic-reserve-20261022.mjs',
    'scripts/test-branch2-resolver-known-pending-20261022.mjs',
    'scripts/test-branch2-resolver-only-when-actionable-20261022.mjs',
    'scripts/test-branch2-resolver-opposite-gender-20261021.mjs',
  ]],
  ['Returns and exchanges', [
    'scripts/test-return-kind-physical-truth-20261028.mjs',
    'scripts/test-return-active-reserve-p0-20261021.mjs',
    'scripts/test-branch2-partial-return-atomic-and-exchange-ui-20261028.mjs',
    'scripts/test-branch2-pending-exchange-initial-shipping-20261028.mjs',
    'scripts/test-branch2-exchange-delayed-dispatch-20261028.mjs',
    'scripts/test-branch2-exchange-pending-resolver-guard-20261028.mjs',
    'scripts/test-legacy-exchange-product-pick-no-white-screen-20261017.mjs',
  ]],
  ['Warehouse operations and history', [
    'scripts/test-stocktake-functional-acceptance.mjs',
    'scripts/test-w8-warehouse-operation-integrity.mjs',
    'scripts/test-w11-manual-correction-runtime.mjs',
    'scripts/test-w12-stock-issues.mjs',
    'scripts/test-w12-sku-history.mjs',
    'scripts/test-w16-source-attention-correction.mjs',
    'scripts/test-w17-optional-stock-notes-clear.mjs',
    'scripts/test-w18-variant-history-investigation.mjs',
    'scripts/test-inventory-writeoff-review.mjs',
  ]],
  ['Catalog, stock writeoff and workshop financial ledger', [
    'scripts/test-catalog-only-writeoff-20261018.mjs',
    'scripts/test-catalog-semantic-sku-identity.mjs',
    'scripts/test-catalog-resolver-r12-catalog-consistency.mjs',
    'scripts/test-stage04-opening-cutover-20261018.mjs',
    'scripts/test-stage04b2-workshop-catalog-cost.mjs',
    'scripts/test-stage04c-workshop-payments.mjs',
    'scripts/test-stage04d-workshop-settlements.mjs',
    'scripts/test-stage04-fast-workshop-settlements.mjs',
  ]],
]
const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit', shell: false, env: process.env, timeout: 150_000,
  })
  if (result.error || result.status !== 0) {
    console.error('FAILED ' + command + ' ' + args.join(' ') +
      ' (' + (result.error?.message || result.status) + ')')
    return false
  }
  return true
}
const failures = []
let total = 0
for (const [group, files] of groups) {
  console.log('\n=== Current Branch2: ' + group + ' ===')
  for (const file of files) {
    if (!fs.existsSync(file)) fail('Required current regression missing: ' + file)
    console.log('CHECK ' + file)
    if (!run(process.execPath, ['--experimental-strip-types', file])) failures.push(file)
    total++
  }
}
console.log('\n=== Current Branch2: TypeScript, Vite and Worker build ===')
if (!run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'])) failures.push('TypeScript/Vite build')
if (!fs.existsSync('dist/client/assets')) failures.push('Current build output missing')
if (failures.length) fail('Current Branch2 gate: ' + failures.length + ' failures: ' + failures.join(', '))
console.log('BRANCH2_CURRENT_SEMANTIC_RELEASE_PASSED — ' + total +
  ' current regressions + production build; historical frozen replay is separate')
