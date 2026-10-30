import assert from 'node:assert/strict'
import fs from 'node:fs'

const worker=fs.readFileSync('wrangler.jsonc','utf8')
const preflight=fs.readFileSync('scripts/branch2-d1-replica-readonly-preflight-20261027.mjs','utf8')
const workflow=fs.readFileSync('.github/workflows/branch2-d1-replica-readonly-preflight-20261027.yml','utf8')

const target='0904a573-21ff-44d8-93b0-c9200f771702'
const old='40065052-854e-44b8-bcd5-251bdd488301'
const production='17e68a41-1d58-4a36-8a63-47c3e32443c4'
assert(worker.includes(target))
assert(worker.includes('orders_db_branch2_mirror_20261027'))
assert(!worker.includes(old) && !worker.includes(production),'Config must isolate active mirror')
assert(preflight.includes(target) && !preflight.includes(old))
assert(preflight.includes('EXPECTED_TEST_ID'))
assert(preflight.includes('assert(TEST_ID===EXPECTED_TEST_ID'))
assert(preflight.includes("target?.database_name==='orders_db_branch2_mirror_20261027'"))
assert(preflight.includes("method==='POST' && endpoint==='/query'"))
assert(preflight.includes('!body.sql.includes(\';\')'))
assert(preflight.includes("readFileSync('wrangler.jsonc'"))
assert(preflight.includes("planOrderManagerSchemaReconciliation("))
assert(preflight.includes("pragma_table_info('orders')"))
assert(workflow.includes('workflow_dispatch:'))
assert(!/^\s+push:\s*$/m.test(workflow),'No automatic remote D1 preflight on push')
assert(workflow.includes("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/branch2'"))
assert(!workflow.includes(old))
assert(workflow.includes(target))
assert(workflow.includes('permissions:') && workflow.includes('  contents: read'),
 'Read-only workflow should keep minimum GitHub permissions')
console.log('P0_BRANCH2_D1_PREFLIGHT_SAFETY_PASSED: exact live mirror binding, SELECT-only both DBs, schema guard and manual remote dispatch')
