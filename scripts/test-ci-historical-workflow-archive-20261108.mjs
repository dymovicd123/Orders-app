// Current CI guard: historical Production migrations must never be runnable
// from GitHub Actions merely because somebody touched an old workflow file.
// This is an offline filesystem check. It never calls GitHub or Cloudflare.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const historical = [
  "auth-production-migrations-0080-0081.yml",
  "catalog-reference-production-schema-0090-0105.yml",
  "client-zammler-production-migration-0075.yml",
  "kaspi-production-migration-0082.yml",
  "kaspi-production-post-deploy-reconcile.yml",
  "main-admin-editor-schema-0110-0112.yml",
  "main-p0-financial-atomic-20261027.yml",
  "main-product-kpi-20261027.yml",
  "main-city-staff-release-20261025.yml",
  "main-kpi-product-selection-20261028.yml",
  "return-attributes-release-20261029.yml",
  "main-p0-legacy-partial-exchange-20261027.yml",
  "main-ethno-manual-finalization-schema-0109.yml",
  "main-retired-sku-schema-0113-0114.yml",
  "main-stage04-dormant-schema-20261018.yml",
  "one-off-prod-1734-targeted-cleanup.yml",
  "oneoff-add-two-colors-rename23-20261016.yml",
  "oneoff-batch8-color-20261016.yml",
  "oneoff-color-1469-1584.yml",
  "oneoff-ethno-four-keeper-colors-20261016.yml",
  "oneoff-hide-retired-light-gray-reference-20261016.yml",
  "oneoff-main-asiya-23-kaspi-paid-20261019.yml",
  "oneoff-main-kaspi-sent-history-20261018.yml",
  "oneoff-production-color-canary-1464.yml",
  "oneoff-remaining26-colors-20261016.yml",
  "stage03-production-migration-0072.yml",
  "stage03-production-migrations-0073-0074.yml",
  "test-main-return-active-reserve-p0.yml"
]
for (const filename of historical) {
  assert.equal(existsSync(join('.github/workflows', filename)), false,
    'Retired Production workflow was reactivated without review: ' + filename)
  assert.equal(existsSync(join('docs/ci-archive/workflows', filename)), true,
    'Missing preserved historical workflow: ' + filename)
}
for (const filename of [
  'quality-check.yml',
  'cloudflare-deploy-monitor.yml',
  'resolver-shipping-acceptance-20261027.yml',
  'main-order-source-picker-acceptance-20261106.yml',
]) assert.equal(existsSync(join('.github/workflows', filename)), true,
  'Required current release/QA workflow missing: ' + filename)
const active = readdirSync('.github/workflows').filter(file => /\.ya?ml$/.test(file))
const cfg=readFileSync('.github/workflows/quality-check.yml','utf8')
assert(cfg.includes('npm run release:check'), 'Central regression gate must remain required')
// The Main/Branch2 monitor may attest Cloudflare builds, but must not be
// another privileged publisher capable of deploying when Cloudflare skips.
const monitor = readFileSync('.github/workflows/cloudflare-deploy-monitor.yml', 'utf8')
const branch2Monitor = readFileSync('wrangler.jsonc','utf8').includes('"name": "orders-app-branch2"')
if (branch2Monitor) {
  // Branch2's native Cloudflare integration is UPLOAD-ONLY until owner approval.
  // Its archived GitHub monitor must never publish, not even through manual dispatch.
  assert(monitor.includes('if: false'), 'Branch2 archived monitor was enabled')
  assert(monitor.includes('workflow_dispatch:'), 'Branch2 monitor changed its archival trigger')
  assert(!/\n\s+push:|\n\s+pull_request:/.test(monitor),
    'Branch2 archived monitor must not react to push or pull requests')
  assert(!/(?:fallback_required|npm run deploy|npx wrangler deploy|wrangler versions deploy|direct Production deploy fallback)/i.test(monitor),
    'Branch2 archived monitor must never publish a Worker')
} else {
  assert(monitor.includes('build_trigger_metadata.commit_hash == $sha'),
    'Cloudflare monitor must match the exact commit before claiming success')
  assert(monitor.includes('build_trigger_metadata.branch == $branch'),
    'Cloudflare monitor must match the exact branch before claiming success')
  assert(monitor.includes('if [[ "$outcome" != "success" ]]; then'),
    'Missing/failed/skipped native builds must not report successful release')
  assert(monitor.includes('Mark build failure') && monitor.includes('Mark build pending'),
    'Cloudflare monitor lost explicit failure/pending build statuses')
  assert(!/(?:fallback_required|npm run deploy|npx wrangler deploy|wrangler versions deploy|direct Production deploy fallback)/i.test(monitor),
    'GitHub monitor must not trigger an independent Worker production deploy')
}


/*
 * The 2026-10/11 one-off publishers were supplanted by Cloudflare's native
 * exact-SHA build monitor. Git history keeps the original workflow sources.
 * Never reactivate a second Main publisher or a completed PR803 Branch2 deploy
 * while retaining the current verification jobs.
 */
for (const filename of [
  'main345-prod-0119-oneoff-20261102.yml',
  'main-approved-split-kpi-direct-20261103.yml',
  'main-resolver-selective-20261022.yml',
]) assert.equal(existsSync(join('.github/workflows', filename)), false,
  'Retired direct publisher reactivated: ' + filename)

for (const [filename, expectedJob] of [
  ['main-manager-finance-20261024.yml', '  verify:'],
  ['main-stage05-demand-selective-20261023.yml', '  stage05-build:'],
  ['main-w12-operations-only-20261024.yml', '  verify:'],
  ['w19-main-stock-operations-only.yml', '  verify:'],
  ['main-order-source-picker-acceptance-20261106.yml', '  source-first-order-qa:'],
]) {
  const source = readFileSync(join('.github/workflows', filename), 'utf8')
  assert(source.includes(expectedJob), 'Business QA job was deleted: ' + filename)
  assert(source.includes('npm run build'), 'Build regression removed: ' + filename)
  assert(!/(?:npx wrangler deploy|wrangler versions deploy|npm run deploy|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|deploy-branch2-pr803|release-main:)/i.test(source),
    'Historical privileged deploy path reactivated: ' + filename)
}


// Native Cloudflare Builds is the only production publisher. GitHub watches exact
// build SHA/branch and reads the active deployment, but never deploys itself.
if (!branch2Monitor) {
  assert(monitor.includes('cloudflare-build/$GITHUB_REF_NAME'),
    'Cloudflare monitoring must report build status rather than claiming upload or deployment')
  assert(monitor.includes('Cloudflare build successful; inspect active deployment in log'),
    'Build status must not claim an unverified release')
  assert(monitor.includes('.result.deployments | sort_by(.created_on)'),
    'Monitor must read the actual active Worker deployment from the Cloudflare API')
  assert(monitor.includes('build_trigger_metadata.commit_hash == $sha'),
    'Monitor must match the exact commit SHA')
  assert(!monitor.includes('workflow_dispatch:'),
    'No manual Main production promotion inside the build monitor')
  assert(!monitor.includes('manual-main-promote:') && !monitor.includes('manual-main-inspect:'),
    'Retired manual Main release jobs must stay removed')
  }
assert(!existsSync('scripts/main-version-promotion.mjs'),
  'Retired manual Main release script must not be reintroduced')

console.log('HISTORICAL_PROD_WORKFLOWS_ARCHIVED',JSON.stringify({preserved:historical.length,active:active.length}))
