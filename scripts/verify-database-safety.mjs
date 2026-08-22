import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

try {
  const packageJson = JSON.parse(read('package.json'))
  const wrangler = read('wrangler.jsonc')
  const workerTree = fs.readdirSync(path.join(root, 'worker', 'domains')).filter((name) => name.endsWith('.ts'))
    .map((name) => read(path.join('worker', 'domains', name))).join('\n') + '\n' + read('worker/index.ts')
  const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()

  check(wrangler.includes('"binding": "DB"'), 'wrangler.jsonc must keep the DB binding')
  check((wrangler.match(/"binding"\s*:\s*"DB"/g) || []).length === 1, 'exactly one DB binding is expected')
  check(migrations.includes('0059_v72_critical_operation_idempotency.sql'), '0059 must remain in migration history')
  check(migrations.includes('0060_v72_storage_database_hygiene.sql'), '0060 must remain in migration history')
  check(!Object.keys(packageJson.scripts || {}).some((name) => /^db:/.test(name)), 'normal package scripts must not expose db:* mutation helpers')
  for (const [name, command] of Object.entries(packageJson.scripts || {})) {
    if (name === 'dev') continue
    check(!/wrangler(?:\.cmd)?\s+d1\s+(?:execute|migrations|delete)|npx(?:\.cmd)?\s+wrangler\s+d1\s+(?:execute|migrations|delete)/i.test(String(command || '')), `package script ${name} must not mutate D1`)
  }
  check(!workerTree.includes("/api/import/"), 'legacy import API surface must stay retired')
  check(!workerTree.includes('rebuild-imported-test1'), 'legacy Test1 workshop rebuild route must stay retired')
  check(!workerTree.includes('repair-imported'), 'legacy imported-workshop repair route must stay retired')
  check(!workerTree.includes('MIGRATION_ENABLED'), 'retired migration/import runtime flag must not return')
  check(read('worker/index.ts').includes("deadLegacyCleanup: '1906c'"), '1906C health marker missing')
  console.log(`DATABASE SAFETY CHECK PASSED — ${migrations.length} migration files preserved; runtime legacy import/repair surface retired; package scripts contain no D1 mutation command.`)
} catch (error) {
  console.error(`DATABASE SAFETY CHECK FAILED: ${error?.message || error}`)
  process.exit(1)
}
