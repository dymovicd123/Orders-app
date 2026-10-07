import fs from 'node:fs'

const workflow = fs.readFileSync('.github/workflows/cloudflare-deploy-monitor.yml', 'utf8')
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(wrangler.includes('"name": "orders-app"'), 'Production fallback test: main Worker identity missing')
check(wrangler.includes('"database_name": "orders_db_prod"'), 'Production fallback test: Production D1 name missing')
check(wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'Production fallback test: Production D1 id missing')
check(!wrangler.includes('orders_db_branch2') && !wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'Production fallback test: Branch2 D1 identity leaked into main')

check(workflow.includes('if [[ "$outcome" == "skipped" && "$GITHUB_REF_NAME" == "main" ]]; then'), 'Skipped native-build fallback must stay main-only')
check(workflow.includes('echo "fallback_required=true" >> "$GITHUB_OUTPUT"'), 'Production fallback requirement is not exported')
check(workflow.includes('"$GITHUB_REF_NAME" == "main" && "$attempt" -ge 12'), 'Missing-build fallback must wait for the bounded main observation window')
check(workflow.includes('No matching native Cloudflare build appeared for main after 2 minutes'), 'Missing-build Production fallback marker missing')
check(workflow.includes('if [[ "$GITHUB_REF_NAME" == "main" && "$stale_build_token" == "true" ]]; then'), 'Stale Cloudflare build-token fallback must stay main-only')
check(workflow.includes("if: steps.wait.outputs.fallback_required == 'true' && github.ref_name == 'main'"), 'Production direct deploy fallback is not hard-scoped to main')

const start = workflow.indexOf('- name: Verify and deploy exact main commit after native skip')
const end = workflow.indexOf('- name: Mark deploy success', start)
check(start >= 0 && end > start, 'Production fallback step boundary missing')
const fallback = workflow.slice(start, end)

check(fallback.includes('[[ "$GITHUB_REF_NAME" == "main" ]]'), 'Production fallback lacks runtime main assertion')
check(fallback.includes('[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]'), 'Production fallback does not pin deployment to exact checked-out SHA')
check(fallback.includes('"name": "orders-app"'), 'Production fallback does not verify Production Worker')
check(fallback.includes('"database_name": "orders_db_prod"'), 'Production fallback does not verify Production D1 name')
check(fallback.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'Production fallback does not verify Production D1 id')
check(fallback.includes("grep -Fq 'orders_db_branch2'") && fallback.includes("grep -Fq '40065052-854e-44b8-bcd5-251bdd488301'"), 'Production fallback does not hard-reject Branch2 D1 identity')
check(fallback.includes('npm run release:check') && fallback.includes('npm run deploy'), 'Production fallback must run full verification before deploy')
check(!fallback.includes('wrangler d1 execute') && !fallback.includes('migrations/'), 'Production fallback must not execute D1 commands or migrations')

const skippedDecision = workflow.slice(workflow.indexOf('if [[ "$outcome" == "skipped"'), workflow.indexOf('if [[ "$outcome" != "success"'))
check(skippedDecision.includes('"main"') && !skippedDecision.includes('"branch2"'), 'This main workflow fallback must not deploy Branch2')

console.log('PRODUCTION DEPLOY FALLBACK SAFETY PASSED — only main native-skip, bounded missing-build, or stale-build-token infrastructure cases may use the direct path; exact SHA, Production Worker and Production D1 are hard-locked, Branch2 identities are rejected, and full release verification precedes deploy')
