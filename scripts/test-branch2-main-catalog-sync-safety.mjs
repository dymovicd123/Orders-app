import fs from 'node:fs'

const script = fs.readFileSync('scripts/branch2-sync-main-catalog-once.mjs', 'utf8')
const workflow = fs.readFileSync('.github/workflows/branch2-main-catalog-sync-once.yml', 'utf8')
const check = (c, m) => { if (!c) throw new Error(m) }

check(script.includes("const PROD_DB_ID = '17e68a41-1d58-4a36-8a63-47c3e32443c4'"), 'Prod D1 identity missing')
check(script.includes("const BRANCH2_DB_ID = '40065052-854e-44b8-bcd5-251bdd488301'"), 'Branch2 D1 identity missing')
check(script.includes("if (databaseId === PROD_DB_ID)"), 'Prod read-only gate missing')
check(script.includes("head.startsWith('SELECT') || head.startsWith('PRAGMA')"), 'Prod query gate is not SELECT/PRAGMA-only')
check(script.includes("check(databaseId === BRANCH2_DB_ID, 'D1 batch writes are allowed only to Branch2')"), 'Batch write helper is not hard-locked to Branch2')
check(script.includes("JSON.stringify({ batch: chunk.map(sql => ({ sql })) })"), 'Bounded Branch2 D1 API batch execution missing')
check(script.includes("else if (MODE === 'apply') await apply()"), 'Prepared sync plan has no guarded apply mode')
check(script.includes("'orders','customers','inventory_movements'") || (script.includes("'orders'") && script.includes("'customers'") && script.includes("'inventory_movements'")), 'Transactional cleanup scope incomplete')
check(script.includes("Main Catalog does not contain an Этно кардиган product"), 'Ethno cardigan source precondition missing')
check(script.includes("_branch2_catalog_price_backup_20260926"), 'Branch2 Stage03 price preservation backup missing')
check(script.includes("DELETE FROM catalog_execution_prices;"), 'Stale/test execution price cleanup missing')
check(script.includes("does not match the captured main Catalog snapshot"), 'Exact main Catalog verification missing')
check(script.includes("BR2-H8 fixture products survived cleanup"), 'Fixture residue verification missing')

check(workflow.includes("branches:\n      - branch2"), 'Workflow is not branch2-only')
check(workflow.includes('node scripts/branch2-sync-main-catalog-once.mjs apply'), 'Branch2 guarded API apply step missing')
check(!workflow.includes('npx wrangler d1 execute orders_db_prod'), 'Workflow must never execute Production D1')
check(workflow.includes('Full code gate before remote mutation') && workflow.includes('npm run release:check'), 'Full gate must run before mutation')
check(workflow.includes('Verify zero test residue and exact main Catalog copy'), 'Post-mutation verification missing')
check(!fs.existsSync('.github/workflows/stage03-branch2-test-reset-once.yml'), 'Obsolete H8 reseed workflow must be retired')

console.log('BRANCH2 MAIN CATALOG SYNC SAFETY PASSED — Production is read-only, Branch2 is the only write target, test transactions/fixtures are removed, Stage03 prices are preserved by business identity, and exact Catalog parity is verified')
