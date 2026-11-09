// Current CI guard: historical Production migrations must never be runnable
// from GitHub Actions merely because somebody touched an old workflow file.
// This is an offline filesystem check. It never calls GitHub or Cloudflare.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
assert(monitor.includes('build_trigger_metadata.commit_hash == $sha'),
  'Cloudflare monitor must match the exact commit before claiming success')
assert(monitor.includes('build_trigger_metadata.branch == $branch'),
  'Cloudflare monitor must match the exact branch before claiming success')
assert(monitor.includes('if [[ "$outcome" != "success" ]]; then'),
  'Missing/failed/skipped native builds must not report successful release')
assert(monitor.includes('Mark deploy failure') && monitor.includes('Mark deploy pending'),
  'Cloudflare monitor lost explicit failure/pending release statuses')
assert(!/(?:fallback_required|npm run deploy|npx wrangler deploy|wrangler versions deploy|direct Production deploy fallback)/i.test(monitor),
  'GitHub monitor must not trigger an independent Worker production deploy')


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


// Main native Cloudflare build is upload-only. A successful upload is not a
// live rollout. Deployment requires separate manual dispatch and exact proof.
assert(monitor.includes('cloudflare-upload/$GITHUB_REF_NAME'),
  'Upload status must never masquerade as deployed Production traffic')
assert(monitor.includes('Read current live deployment without changing traffic'),
  'Upload observer must independently show active deployment without publishing it')
assert(monitor.includes('/workers/scripts/$WORKER_NAME/deployments'),
  'Upload observer must read actual deployed Worker versions')
assert(monitor.includes('.result.deployments | sort_by(.created_on)'),
  'Cloudflare deployment API wraps the list in result.deployments')
assert(readFileSync('scripts/main-version-promotion.mjs','utf8')
  .includes('response?.deployments'),
  'Manual promotion must unwrap the Cloudflare deployments response')
assert(monitor.includes('Cloudflare upload finished (NOT serving traffic)'),
  'Successful build must be labelled as upload-only')
assert(monitor.includes("github.event_name == 'push'"),
  'Build observer must only run for pushes')
assert(monitor.includes("github.event_name == 'workflow_dispatch'"),
  'Main promotion must require explicit manual workflow invocation')
assert(monitor.includes("environment: main-production"),
  'Main promotion must be gated by a dedicated GitHub environment')
assert(monitor.includes("cancel-in-progress: false"),
  'Main release promotions must never be cancelled mid-deploy')
assert(monitor.includes("inputs.mode == 'promote'"),
  'Explicit promote selection is mandatory')
assert(monitor.includes("node scripts/main-version-promotion.mjs"),
  'Main must promote an exact uploaded version rather than re-deploy Worker code')
assert(!/npx wrangler deploy|wrangler versions deploy|npm run deploy/.test(monitor),
  'Cloudflare upload monitor must not contain a second direct Wrangler deploy')
const promotionScript = readFileSync('scripts/main-version-promotion.mjs', 'utf8')
for (const guard of [
  'MAIN_RELEASE_BLOCKED', 'PUBLISH-MAIN-100', 'RELEASE_SHA === env.GITHUB_SHA',
  'deploymentId === env.EXPECTED_DEPLOYMENT_ID',
  'versionId === env.EXPECTED_ACTIVE_VERSION_ID',
  "deploy_command ?? ''", 'Target Version ID is not proven',
  'main-production', // checked below through YAML, not executable script
]) {
  if (guard === 'main-production') continue
  assert(promotionScript.includes(guard), 'Missing pinned Main release safety guard: ' + guard)
}
assert(!/wrangler deploy|wrangler d1 execute|migrations apply/.test(promotionScript),
  'Manual promotion must not build or write to D1')
const releaseSelfTest = spawnSync(process.execPath,
  ['scripts/main-version-promotion.mjs', '--self-test'],
  {encoding:'utf8', timeout:20000,env:{...process.env,CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}})
assert.equal(releaseSelfTest.status, 0,
  'Offline Main release fail-closed tests failed: ' + releaseSelfTest.stderr)
assert(releaseSelfTest.stdout.includes('MAIN_MANUAL_PROMOTION_OFFLINE_SAFETY_PASS'),
  'Main safety checks failed to complete')

console.log('HISTORICAL_PROD_WORKFLOWS_ARCHIVED',JSON.stringify({preserved:historical.length,active:active.length}))
