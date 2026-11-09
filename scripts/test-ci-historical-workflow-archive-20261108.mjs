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
console.log('HISTORICAL_PROD_WORKFLOWS_ARCHIVED',JSON.stringify({preserved:historical.length,active:active.length}))
