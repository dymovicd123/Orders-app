import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')
const git = (args) => execFileSync('git', args, { encoding: 'utf8' })
function declarationNames(statement) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
function list(ref) {
  return git(['ls-tree', '-r', '--name-only', ref, 'worker']).split(/\r?\n/).filter((p) => p.endsWith('.ts')).sort()
}
function read(ref, file) {
  return ref === 'HEAD' ? fs.readFileSync(file, 'utf8') : git(['show', `${ref}:${file}`])
}
function collect(ref) {
  const declarations = new Map()
  let router = ''
  for (const file of list(ref)) {
    const text = read(ref, file)
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of source.statements) {
      for (const name of declarationNames(statement)) {
        if (declarations.has(name)) throw new Error(`Duplicate Worker declaration: ${name}`)
        declarations.set(name, normalizeMovedDeclaration(statement.getText(source)))
      }
      if (file === 'worker/index.ts' && ts.isExportAssignment(statement)) router = statement.getText(source)
    }
  }
  return { declarations, router }
}
function contiguousInsertedBlock(before, after) {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const block = after.slice(prefix, after.length - suffix)
  const reverted = after.slice(0, prefix) + after.slice(after.length - suffix)
  if (!block || reverted !== before) throw new Error('Worker router delta is not one exact inserted block')
  return block
}

const before = collect('origin/main')
const after = collect('HEAD')
const changes = {}
const added = {}
const removed = {}
for (const [name, text] of before.declarations) {
  const next = after.declarations.get(name)
  if (next === undefined) removed[name] = sha(text)
  else if (next !== text) changes[name] = { before: sha(text), after: sha(next) }
}
for (const [name, text] of after.declarations) if (!before.declarations.has(name)) added[name] = sha(text)

const changeNames = Object.keys(changes).sort()
const expectedChanges = ['createExchange', 'createReturn', 'listExchanges', 'listReturnHistory']
if (changeNames.join(',') !== expectedChanges.join(',')) throw new Error(`Unexpected Worker changed declaration scope: ${changeNames.join(',')}`)
if (Object.keys(added).join(',') !== 'receiveReturnedItem') throw new Error(`Unexpected Worker added declaration scope: ${Object.keys(added).join(',')}`)
if (Object.keys(removed).length) throw new Error(`Unexpected Worker removed declarations: ${Object.keys(removed).join(',')}`)
if (after.declarations.size !== before.declarations.size + 1) throw new Error(`Unexpected Worker declaration count delta: ${before.declarations.size} -> ${after.declarations.size}`)

const routerBlock = contiguousInsertedBlock(before.router, after.router)
if (!routerBlock.includes("url.pathname === '/api/returned-items/receive'")) throw new Error('Exact router delta is not the returned-item receive route')
if (!routerBlock.includes('receiveReturnedItem(env.DB, input)')) throw new Error('Returned-item receive route does not call the expected domain action')

const manifest = {
  version: 1,
  revision: 'returns-physical-intake-r1',
  changes,
  added,
  router: { before: sha(before.router), after: sha(after.router), block: routerBlock },
}
fs.writeFileSync('scripts/returns-physical-intake-r1-worker-manifest.json', JSON.stringify(manifest, null, 2) + '\n')

const gatePath = 'scripts/test-step1906a-worker-modularization.mjs'
let gate = fs.readFileSync(gatePath, 'utf8')
const pathAnchor = "const dashboardWorkshopAttentionManifestPath = path.join(root, 'scripts/dashboard-workshop-attention-r1-worker-manifest.json')\n"
if (!gate.includes(pathAnchor)) throw new Error('1906A physical intake manifest path anchor missing')
gate = gate.replace(pathAnchor, pathAnchor + "const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-worker-manifest.json')\n")

const dashboardValidation = "if (Object.keys(dashboardWorkshopAttentionManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listWorkshopTasks') throw new Error('Dashboard workshop attention R1 Worker allow-list widened unexpectedly')\n"
if (!gate.includes(dashboardValidation)) throw new Error('1906A physical intake validation anchor missing')
const physicalValidation = [
  "const returnsPhysicalIntakeManifest = JSON.parse(fs.readFileSync(returnsPhysicalIntakeManifestPath, 'utf8'))",
  "if (returnsPhysicalIntakeManifest?.version !== 1 || returnsPhysicalIntakeManifest?.revision !== 'returns-physical-intake-r1') throw new Error('Returns physical intake R1 Worker manifest invalid')",
  "if (Object.keys(returnsPhysicalIntakeManifest.changes || {}).sort().join(',') !== 'createExchange,createReturn,listExchanges,listReturnHistory') throw new Error('Returns physical intake R1 Worker change allow-list widened unexpectedly')",
  "if (Object.keys(returnsPhysicalIntakeManifest.added || {}).join(',') !== 'receiveReturnedItem') throw new Error('Returns physical intake R1 Worker added allow-list widened unexpectedly')",
  "if (!returnsPhysicalIntakeManifest.router?.block) throw new Error('Returns physical intake R1 Worker route block missing')",
  '',
].join('\n')
gate = gate.replace(dashboardValidation, dashboardValidation + physicalValidation)

const writeAnchor = 'fs.writeFileSync(legacyPath, patched)\n'
if (!gate.includes(writeAnchor)) throw new Error('1906A final write anchor missing')
const layer = String.raw`
// Returns physical intake R1 is a final narrow layer over the accepted dashboard baseline.
const physicalChangesLine = /const dashboardWorkshopAttentionChanges = [^\n]+\n/
if (!physicalChangesLine.test(patched)) throw new Error('1906A physical intake injected dashboard changes anchor missing')
patched = patched.replace(physicalChangesLine, (match) => match
  + 'const returnsPhysicalIntakeChanges = ' + JSON.stringify(returnsPhysicalIntakeManifest.changes || {}) + '\n'
  + 'const returnsPhysicalIntakeAdded = ' + JSON.stringify(returnsPhysicalIntakeManifest.added || {}) + '\n'
  + 'const returnsPhysicalIntakeRouter = ' + JSON.stringify(returnsPhysicalIntakeManifest.router || {}) + '\n')

const physicalCountAnchor = ' + Object.keys(operationalAutonomyA5Added).length'
if (!patched.includes(physicalCountAnchor)) throw new Error('1906A physical intake declaration-count anchor missing')
patched = patched.replace(physicalCountAnchor, physicalCountAnchor + ' + Object.keys(returnsPhysicalIntakeAdded).length')

const dashboardHashReturn = '        return sha(declarations.get(name)) === acceptedPostDashboardAttentionHash\n'
if (!patched.includes(dashboardHashReturn)) throw new Error('1906A physical intake dashboard hash anchor missing')
patched = patched.replace(dashboardHashReturn, [
  '        const returnsPhysicalIntakeChanged = returnsPhysicalIntakeChanges[name]',
  '        let acceptedPostReturnsPhysicalIntakeHash = acceptedPostDashboardAttentionHash',
  '        if (returnsPhysicalIntakeChanged) {',
  "          check(returnsPhysicalIntakeChanged.before === acceptedPostDashboardAttentionHash, 'Returns physical intake R1 baseline hash mismatch: ' + name)",
  '          acceptedPostReturnsPhysicalIntakeHash = returnsPhysicalIntakeChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostReturnsPhysicalIntakeHash',
  '',
].join('\n'))

const physicalAddedAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'
if (!patched.includes(physicalAddedAnchor)) throw new Error('1906A physical intake added-declaration anchor missing')
const physicalAddedBlock = [
  '  for (const [name, expectedHash] of Object.entries(returnsPhysicalIntakeAdded)) {',
  "    check(declarations.has(name), 'Returns physical intake R1 added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Returns physical intake R1 added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
patched = patched.replace(physicalAddedAnchor, physicalAddedBlock + physicalAddedAnchor)

const a5RouterAnchor = [
  "  check(sha(currentRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 raw Worker router changed beyond exact delta')",
  "  const operationalAutonomyA5RevertedRouter = currentRouter.replace(operationalAutonomyA5Router.block, '')",
].join('\n')
if (!patched.includes(a5RouterAnchor)) throw new Error('1906A physical intake A5 router anchor missing')
const physicalRouterBlock = [
  "  check(sha(currentRouter) === returnsPhysicalIntakeRouter.after, 'Returns physical intake R1 raw Worker router changed beyond exact delta')",
  "  const returnsPhysicalIntakeRevertedRouter = currentRouter.replace(returnsPhysicalIntakeRouter.block, '')",
  "  check(sha(returnsPhysicalIntakeRevertedRouter) === returnsPhysicalIntakeRouter.before, 'Returns physical intake R1 Worker router reverse baseline mismatch')",
  "  check(sha(returnsPhysicalIntakeRevertedRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 Worker router changed beneath physical intake R1')",
  "  const operationalAutonomyA5RevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(operationalAutonomyA5Router.block, '')",
].join('\n')
patched = patched.replace(a5RouterAnchor, physicalRouterBlock)

`
gate = gate.replace(writeAnchor, layer + writeAnchor)
fs.writeFileSync(gatePath, gate)
console.log('1906A physical intake manifest and exact structural layer finalized')
