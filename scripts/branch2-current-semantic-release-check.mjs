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
    'scripts/test-atomic-reservation-admission-20261030.mjs',
    'scripts/test-order-shortage-pending-without-confirmation-20261031.mjs',
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
    'scripts/test-stage3-1-exact-obligation-lineage-20261031.mjs',
    'scripts/test-branch2-resolver-only-when-actionable-20261022.mjs',
    'scripts/test-branch2-resolver-opposite-gender-20261021.mjs',
  ]],
  ['Returns and exchanges', [
    'scripts/test-return-kind-physical-truth-20261028.mjs',
    'scripts/test-stage3-return-receipt-fractional-checkpoint-20261031.mjs',
    'scripts/test-stage3-legacy-partial-exchange-http-20261031.mjs',
    'scripts/test-stage3-partial-return-http-20261031.mjs',
    'scripts/test-stage3-issued-partial-exchange-http-20261031.mjs',
    'scripts/test-stage3-delayed-return-post-stocktake-http-20261031.mjs',
    'scripts/test-stage3-set-v2-issued-partial-http-20261031.mjs',
    'scripts/test-stage31-inbound-preserve-original-sku-20261031.mjs',
    'scripts/test-stage32-delete-fractional-checkpoint-http-20261031.mjs',
    'scripts/test-stage32-partial-itemized-rewrite-http-20261031.mjs',
    'scripts/test-stage32-unsent-delete-cross-source-http-20261031.mjs',
    'scripts/test-stage32-retired-sku-explicit-replacement-http-20261031.mjs',
    'scripts/test-return-active-reserve-p0-20261021.mjs',
    'scripts/test-branch2-partial-return-atomic-and-exchange-ui-20261028.mjs',
    'scripts/test-branch2-pending-exchange-initial-shipping-20261028.mjs',
    'scripts/test-branch2-exchange-delayed-dispatch-20261028.mjs',
    'scripts/test-branch2-exchange-pending-resolver-guard-20261028.mjs',
    'scripts/test-legacy-exchange-product-pick-no-white-screen-20261017.mjs',
  ]],
  ['Warehouse operations and history', [
    'scripts/test-stocktake-functional-acceptance.mjs',
    'scripts/test-found-stock-unique-identity-barcode-readiness-20261030.mjs',
    'scripts/test-arrival-canonical-barcode-sku-20261030.mjs',
    'scripts/test-transfer-canonical-barcode-identity-20261030.mjs',
    'scripts/test-w8-warehouse-operation-integrity.mjs',
    'scripts/test-w11-manual-correction-runtime.mjs',
    'scripts/test-w12-stock-issues.mjs',
    'scripts/test-older-unresolved-catalog-attention-20261031.mjs',
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
// Short developer feedback without weakening the full release gate.
// Examples: npm run check:focused -- --focus=reservations
//           npm run check:focused -- --focus=warehouse --build
// CI always calls release:check with no focus and therefore checks everything.
const focuses = ['db', 'reservations', 'returns', 'warehouse', 'catalog'];
const argumentsList = process.argv.slice(2);
const focusArgument = argumentsList.find(arg => arg.startsWith('--focus='));
const unexpected = argumentsList.filter(arg => !arg.startsWith('--focus=') && arg !== '--build' && arg !== '--all-errors');
if (unexpected.length || argumentsList.filter(arg => arg.startsWith('--focus=')).length > 1) {
  fail('Usage: [--focus=db|reservations|returns|warehouse|catalog] [--build] [--all-errors]');
}
const focused = focusArgument?.slice('--focus='.length) || null;
if (focused && !focuses.includes(focused)) fail('Unknown focus: ' + focused);
if (focused && process.env.CI === 'true') fail('CI cannot bypass the full Branch2 release gate with --focus');
const selectedGroups = focused ? groups.filter((_, i) => focuses[i] === focused) : groups;
const shouldBuild = !focused || argumentsList.includes('--build');
const stopOnFirstFailure = !argumentsList.includes('--all-errors');
if (focused) console.log('FAST_FOCUSED_BRANCH2_CHECK ' + focused + ' (full release acceptance remains separate)');

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
for (const [group, files] of selectedGroups) {
  console.log('\n=== Current Branch2: ' + group + ' ===')
  for (const file of files) {
    if (!fs.existsSync(file)) fail('Required current regression missing: ' + file)
    console.log('CHECK ' + file)
    if (!run(process.execPath, ['--experimental-strip-types', file])) {
      failures.push(file)
      // Never report a failure as green; exit immediately to avoid wasting
      // minutes on unrelated groups when a single regression is already red.
      if (stopOnFirstFailure) fail('Failed current regression: ' + file);
    }
    total++
  }
}
if (shouldBuild) {
  console.log('\n=== Current Branch2: TypeScript, Vite and Worker build ===')
  if (!run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'])) failures.push('TypeScript/Vite build')
  if (!fs.existsSync('dist/client/assets')) failures.push('Current build output missing')
}
if (failures.length) fail('Current Branch2 gate: ' + failures.length + ' failures: ' + failures.join(', '))
if (focused) {
  console.log('BRANCH2_FOCUSED_CHECK_PASSED — ' + focused + ': ' + total +
    ' tests' + (shouldBuild ? ' + build' : '') + '; full release acceptance NOT performed')
} else {
  console.log('BRANCH2_CURRENT_SEMANTIC_RELEASE_PASSED — ' + total +
    ' current regressions + production build; historical frozen replay is separate')
}
