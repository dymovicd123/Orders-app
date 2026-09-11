import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync, spawnSync } from 'node:child_process'

const root = process.cwd()
const baseSha = 'f5e8e8423a101d99289b07a3afc4be20e56ef361'
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationHash(text, fileName, wantedName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    let names = []
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names = [statement.name.text]
    if (ts.isVariableStatement(statement)) names = statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
    if (names.includes(wantedName)) return sha256(normalizeMovedDeclaration(statement.getText(source)))
  }
  throw new Error(`Declaration not found: ${wantedName} in ${fileName}`)
}

const gitShow = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' })
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const deleteFile = 'worker/domains/order-delete.ts'
const reservationFile = 'worker/domains/order-reservations.ts'
const beforeDelete = declarationHash(gitShow(baseSha, deleteFile), deleteFile, 'deleteOrderSafely')
const afterDelete = declarationHash(read(deleteFile), deleteFile, 'deleteOrderSafely')
const addedCorrection = declarationHash(read(reservationFile), reservationFile, 'correctMistakenOrderHandover')
const r2 = JSON.parse(read('scripts/operational-autonomy-r2-worker-manifest.json'))
if (!r2?.router?.after) throw new Error('Operational autonomy R2 router baseline missing')

const manifestPath = path.join(root, 'scripts/operational-autonomy-a4-worker-manifest.json')
const manifest = {
  version: 1,
  revision: 'operational-autonomy-a4-mistaken-handover-r1',
  changes: {
    deleteOrderSafely: { before: beforeDelete, after: afterDelete },
  },
  added: {
    correctMistakenOrderHandover: addedCorrection,
  },
  router: {
    before: r2.router.after,
    after: '__diagnostic__',
  },
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

const wrapperPath = path.join(root, 'scripts/test-step1906a-worker-modularization.mjs')
let wrapper = fs.readFileSync(wrapperPath, 'utf8')

const r3PathLine = "const operationalAutonomyR3ManifestPath = path.join(root, 'scripts/operational-autonomy-r3-worker-manifest.json')\n"
if (!wrapper.includes(r3PathLine)) throw new Error('A4 wrapper manifest path anchor missing')
wrapper = wrapper.replace(r3PathLine, r3PathLine + "const operationalAutonomyA4ManifestPath = path.join(root, 'scripts/operational-autonomy-a4-worker-manifest.json')\n")

const r3LoadBlock = "const operationalAutonomyR3Manifest = JSON.parse(fs.readFileSync(operationalAutonomyR3ManifestPath, 'utf8'))\nif (operationalAutonomyR3Manifest?.version !== 1 || operationalAutonomyR3Manifest?.revision !== 'operational-autonomy-r3-return-exchange-capacity-r1') throw new Error('Operational Autonomy R3 Worker manifest invalid')\nif (Object.keys(operationalAutonomyR3Manifest.changes || {}).sort().join(',') !== 'cancelReturn,createExchange,createReturn') throw new Error('Operational Autonomy R3 Worker allow-list widened unexpectedly')\n"
if (!wrapper.includes(r3LoadBlock)) throw new Error('A4 wrapper manifest load anchor missing')
const a4LoadBlock = r3LoadBlock + "const operationalAutonomyA4Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA4ManifestPath, 'utf8'))\nif (operationalAutonomyA4Manifest?.version !== 1 || operationalAutonomyA4Manifest?.revision !== 'operational-autonomy-a4-mistaken-handover-r1') throw new Error('Operational Autonomy A4 Worker manifest invalid')\nif (Object.keys(operationalAutonomyA4Manifest.changes || {}).join(',') !== 'deleteOrderSafely') throw new Error('Operational Autonomy A4 Worker change allow-list widened unexpectedly')\nif (Object.keys(operationalAutonomyA4Manifest.added || {}).join(',') !== 'correctMistakenOrderHandover') throw new Error('Operational Autonomy A4 Worker added allow-list widened unexpectedly')\n"
wrapper = wrapper.replace(r3LoadBlock, a4LoadBlock)

const oldInjected = "const catalogUnisexMergeChanges = ${JSON.stringify({ findCatalogCombinationV3: catalogUnisexMergeManifest.changes.findCatalogCombinationV3, ...operationalAutonomyR3Manifest.changes })}\\n`)"
const newInjected = "const catalogUnisexMergeChanges = ${JSON.stringify({ findCatalogCombinationV3: catalogUnisexMergeManifest.changes.findCatalogCombinationV3, ...operationalAutonomyR3Manifest.changes })}\\nconst operationalAutonomyA4Changes = ${JSON.stringify(operationalAutonomyA4Manifest.changes || {})}\\nconst operationalAutonomyA4Added = ${JSON.stringify(operationalAutonomyA4Manifest.added || {})}\\nconst operationalAutonomyA4Router = ${JSON.stringify(operationalAutonomyA4Manifest.router || {})}\\n`)"
if (!wrapper.includes(oldInjected)) throw new Error('A4 injected cumulative variables anchor missing')
wrapper = wrapper.replace(oldInjected, newInjected)

if (!wrapper.includes('const patched = original')) throw new Error('A4 patched variable anchor missing')
wrapper = wrapper.replace('const patched = original', 'let patched = original')
const writeAnchor = 'fs.writeFileSync(legacyPath, patched)\n'
if (!wrapper.includes(writeAnchor)) throw new Error('A4 wrapper write anchor missing')

const extraPatch = String.raw`patched = patched
  .replace(' + Object.keys(catalogGenderScopeR1Added).length', ' + Object.keys(catalogGenderScopeR1Added).length + Object.keys(operationalAutonomyA4Added).length')
  .replace(
    '    check(\\n      sha(declarations.get(name)) === acceptedPostCatalogUnisexMergeHash,',
    '    const operationalAutonomyA4Changed = operationalAutonomyA4Changes[name]\\n    let acceptedPostOperationalAutonomyA4Hash = acceptedPostCatalogUnisexMergeHash\\n    if (operationalAutonomyA4Changed) {\\n      check(operationalAutonomyA4Changed.before === acceptedPostCatalogUnisexMergeHash, `Operational Autonomy A4 baseline hash mismatch: ${name}`)\\n      acceptedPostOperationalAutonomyA4Hash = operationalAutonomyA4Changed.after\\n    }\\n    check(\\n      sha(declarations.get(name)) === acceptedPostOperationalAutonomyA4Hash,',
  )
  .replace(
    '  // Catalog gender scope R1 changes only the product create/update request shapes.',
    '  for (const [name, expectedHash] of Object.entries(operationalAutonomyA4Added)) {\\n    check(declarations.has(name), `Operational Autonomy A4 added Worker declaration missing: ${name}`)\\n    check(sha(declarations.get(name)) === expectedHash, `Operational Autonomy A4 added Worker declaration changed: ${name}`)\\n  }\\n\\n  // Catalog gender scope R1 changes only the product create/update request shapes.',
  )
  .replace(
    "  check(sha(normalizedRouter) === operationalAutonomyR2Worker.router.after, 'Worker router changed beyond exact operational autonomy R2 delta')",
    "  check(operationalAutonomyA4Router.before === operationalAutonomyR2Worker.router.after, 'Operational Autonomy A4 router baseline hash mismatch')\\n  console.log('__A4_ROUTER_AFTER__' + sha(normalizedRouter))",
  )
`
wrapper = wrapper.replace(writeAnchor, extraPatch + '\n' + writeAnchor)
fs.writeFileSync(wrapperPath, wrapper)

const diagnostic = spawnSync(process.execPath, ['scripts/test-step1906a-worker-modularization.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(diagnostic.stdout || '')
process.stderr.write(diagnostic.stderr || '')
if (diagnostic.status !== 0) throw new Error(`A4 diagnostic 1906A run failed with ${diagnostic.status}`)
const match = (diagnostic.stdout || '').match(/__A4_ROUTER_AFTER__([a-f0-9]{64})/)
if (!match) throw new Error('A4 normalized router hash was not emitted')
manifest.router.after = match[1]
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

wrapper = fs.readFileSync(wrapperPath, 'utf8')
const diagnosticRouter = "  console.log('__A4_ROUTER_AFTER__' + sha(normalizedRouter))"
const exactRouter = "  check(sha(normalizedRouter) === operationalAutonomyA4Router.after, 'Worker router changed beyond exact Operational Autonomy A4 delta')"
if (!wrapper.includes(diagnosticRouter)) throw new Error('A4 router diagnostic anchor missing')
wrapper = wrapper.replace(diagnosticRouter, exactRouter)
fs.writeFileSync(wrapperPath, wrapper)

const exact = spawnSync(process.execPath, ['scripts/test-step1906a-worker-modularization.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(exact.stdout || '')
process.stderr.write(exact.stderr || '')
if (exact.status !== 0) throw new Error(`Exact A4 1906A run failed with ${exact.status}`)

const frontend = spawnSync(process.execPath, ['scripts/test-step1906b-frontend-modularization.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(frontend.stdout || '')
process.stderr.write(frontend.stderr || '')
fs.writeFileSync(path.join(root, 'scripts/.a4-frontend-status.txt'), `status=${frontend.status}\n`)
console.log(`A4_FRONTEND_1906B_STATUS=${frontend.status}`)
