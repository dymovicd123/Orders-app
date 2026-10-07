import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const workflow = read('.github/workflows/cloudflare-deploy-monitor.yml')

check(workflow.includes('if [[ "$outcome" == "skipped" && "$GITHUB_REF_NAME" == "branch2" ]]; then'), 'Skipped native-build fallback must stay Branch2-only')
check(workflow.includes('echo "fallback_required=true" >> "$GITHUB_OUTPUT"'), 'Branch2 fallback no longer exports fallback requirement')
check(workflow.includes("if: steps.wait.outputs.fallback_required == 'true' && github.ref_name == 'branch2'"), 'Direct deploy fallback is not hard-scoped to Branch2')

const start = workflow.indexOf('- name: Verify and deploy exact Branch2 commit after native skip')
const end = workflow.indexOf('- name: Mark deploy success', start)
check(start >= 0 && end > start, 'Direct Branch2 fallback step boundary missing')
const fallback = workflow.slice(start, end)

check(fallback.includes('[[ "$GITHUB_REF_NAME" == "branch2" ]]'), 'Fallback lacks runtime Branch2 assertion')
check(fallback.includes('[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]'), 'Fallback does not pin deployment to the exact checked-out commit')
check(fallback.includes('"name": "orders-app-branch2"'), 'Fallback does not verify Branch2 Worker')
check(fallback.includes('"database_name": "orders_db_branch2"'), 'Fallback does not verify Branch2 D1 name')
check(fallback.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'Fallback does not verify Branch2 D1 id')
check(fallback.includes("grep -Fq 'orders_db_prod'") && fallback.includes("grep -Fq '17e68a41-1d58-4a36-8a63-47c3e32443c4'"), 'Fallback does not hard-reject Production D1 identity')
check(fallback.includes('npm run release:check') && fallback.includes('npm run deploy'), 'Fallback must fully verify before deploying')
check(!fallback.includes('wrangler d1 execute') && !fallback.includes('migrations/'), 'Fallback must not execute D1 commands or migrations')

const skippedDecision = workflow.slice(workflow.indexOf('if [[ "$outcome" == "skipped"'), workflow.indexOf('if [[ "$outcome" != "success"'))
check(skippedDecision.includes('"branch2"') && !skippedDecision.includes('"main"'), 'Native-skip direct fallback must never target main')

const missingBuildDecision = workflow.slice(workflow.indexOf('No matching native Cloudflare build appeared for Branch2'), workflow.indexOf('sleep 10', workflow.indexOf('No matching native Cloudflare build appeared for Branch2')) + 'sleep 10'.length)
check(workflow.includes('"$GITHUB_REF_NAME" == "branch2" && "$attempt" -ge 12'), 'Missing-build fallback must wait for the bounded Branch2 observation window')
check(missingBuildDecision.includes('guarded direct Branch2 deploy fallback') && !missingBuildDecision.includes('"main"'), 'Missing-build fallback must remain Branch2-only')

check(
  workflow.includes('if [[ "$GITHUB_REF_NAME" == "branch2" && "$stale_build_token" == "true" ]]; then'),
  'Stale Cloudflare build-token fallback must remain Branch2-only',
)

console.log('BRANCH2 DEPLOY FALLBACK SAFETY PASSED — only Branch2 native-skip, bounded missing-build, or stale-build-token infrastructure cases may use the direct path; exact commit, Worker and D1 are hard-locked, Production identities are rejected, and full release verification precedes deploy')
