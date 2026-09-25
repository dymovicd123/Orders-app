import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const workflow = read('.github/workflows/cloudflare-deploy-monitor.yml')

check(workflow.includes('if [[ "$outcome" == "skipped" && "$GITHUB_REF_NAME" == "branch2" ]]; then'), 'Deploy fallback must activate only for a skipped Branch2 native build')
check(workflow.includes('echo "fallback_required=true" >> "$GITHUB_OUTPUT"'), 'Skipped Branch2 build no longer exports fallback requirement')
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

console.log('BRANCH2 DEPLOY FALLBACK SAFETY PASSED — only skipped native Branch2 builds may use the direct path; exact commit, Worker and D1 are hard-locked, Production identities are rejected, and full release verification precedes deploy')
