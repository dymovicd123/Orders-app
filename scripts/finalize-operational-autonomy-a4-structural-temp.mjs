import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync, spawnSync } from 'node:child_process'

const root = process.cwd()
const baseSha = 'f5e8e8423a101d99289b07a3afc4be20e56ef361'
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function parse(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
function declarationHash(text, fileName, wantedName) {
  const source = parse(text, fileName)
  for (const statement of source.statements) {
    let names = []
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names = [statement.name.text]
    if (ts.isVariableStatement(statement)) names = statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
    if (names.includes(wantedName)) return sha256(normalizeMovedDeclaration(statement.getText(source)))
  }
  throw new Error(`Declaration not found: ${wantedName} in ${fileName}`)
}
function routerText(text, fileName) {
  const source = parse(text, fileName)
  const statement = source.statements.find((candidate) => ts.isExportAssignment(candidate))
  if (!statement) throw new Error(`Router export assignment not found: ${fileName}`)
  return statement.getText(source)
}
const gitShow = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' })
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const deleteFile = 'worker/domains/order-delete.ts'
const reservationFile = 'worker/domains/order-reservations.ts'
const indexFile = 'worker/index.ts'
const beforeDelete = declarationHash(gitShow(baseSha, deleteFile), deleteFile, 'deleteOrderSafely')
const afterDelete = declarationHash(read(deleteFile), deleteFile, 'deleteOrderSafely')
const addedCorrection = declarationHash(read(reservationFile), reservationFile, 'correctMistakenOrderHandover')
const beforeRouterText = routerText(gitShow(baseSha, indexFile), indexFile)
const afterRouterText = routerText(read(indexFile), indexFile)

const routeBlock = `\n\n      const orderShippingCorrectionMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping\\/correct$/);\n      if (orderShippingCorrectionMatch && request.method === 'POST') {\n        const id = toInt(orderShippingCorrectionMatch[1], 0);\n        const input = await readJson<{ physicalOutcome?: unknown }>(request);\n        try {\n          const result = await correctMistakenOrderHandover(env.DB, id, {\n            physicalOutcome: input.physicalOutcome,\n            actor: cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role')),\n          });\n          let updatedOrder = null;\n          try {\n            updatedOrder = await getOrder(env.DB, id);\n          } catch (error) {\n            console.warn('Order readback after handover correction failed', error);\n          }\n          return json({ ...result, ...(updatedOrder ? { order: updatedOrder } : {}), refreshRequired: !updatedOrder });\n        } catch (error) {\n          const publicError = publicApiError(error);\n          return json({ ok: false, ...(publicError.code ? { code: publicError.code } : {}), message: publicError.message }, { status: publicError.status });\n        }\n      }\n`
if (!afterRouterText.includes(routeBlock)) throw new Error('Exact A4 correction route block not found in current router')
const revertedRouterText = afterRouterText.replace(routeBlock, '')
if (revertedRouterText !== beforeRouterText) {
  throw new Error('A4 raw router contains changes beyond the exact correction route block')
}

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
    before: sha256(beforeRouterText),
    after: sha256(afterRouterText),
  },
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

const wrapperPath = path.join(root, 'scripts/test-step1906a-worker-modularization.mjs')
let wrapper = read('scripts/test-step1906a-worker-modularization.mjs')
const r3PathLine = "const operationalAutonomyR3ManifestPath = path.join(root, 'scripts/operational-autonomy-r3-worker-manifest.json')\n"
if (!wrapper.includes(r3PathLine)) throw new Error('A4 wrapper manifest path anchor missing')
wrapper = wrapper.replace(r3PathLine, r3PathLine + "const operationalAutonomyA4ManifestPath = path.join(root, 'scripts/operational-autonomy-a4-worker-manifest.json')\n")

const r3LoadBlock = "const operationalAutonomyR3Manifest = JSON.parse(fs.readFileSync(operationalAutonomyR3ManifestPath, 'utf8'))\nif (operationalAutonomyR3Manifest?.version !== 1 || operationalAutonomyR3Manifest?.revision !== 'operational-autonomy-r3-return-exchange-capacity-r1') throw new Error('Operational Autonomy R3 Worker manifest invalid')\nif (Object.keys(operationalAutonomyR3Manifest.changes || {}).sort().join(',') !== 'cancelReturn,createExchange,createReturn') throw new Error('Operational Autonomy R3 Worker allow-list widened unexpectedly')\n"
if (!wrapper.includes(r3LoadBlock)) throw new Error('A4 wrapper manifest load anchor missing')
wrapper = wrapper.replace(r3LoadBlock, r3LoadBlock + "const operationalAutonomyA4Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA4ManifestPath, 'utf8'))\nif (operationalAutonomyA4Manifest?.version !== 1 || operationalAutonomyA4Manifest?.revision !== 'operational-autonomy-a4-mistaken-handover-r1') throw new Error('Operational Autonomy A4 Worker manifest invalid')\nif (Object.keys(operationalAutonomyA4Manifest.changes || {}).join(',') !== 'deleteOrderSafely') throw new Error('Operational Autonomy A4 Worker change allow-list widened unexpectedly')\nif (Object.keys(operationalAutonomyA4Manifest.added || {}).join(',') !== 'correctMistakenOrderHandover') throw new Error('Operational Autonomy A4 Worker added allow-list widened unexpectedly')\n")

const oldInjected = "const catalogUnisexMergeChanges = ${JSON.stringify({ findCatalogCombinationV3: catalogUnisexMergeManifest.changes.findCatalogCombinationV3, ...operationalAutonomyR3Manifest.changes })}\\n`)"
const newInjected = "const catalogUnisexMergeChanges = ${JSON.stringify({ findCatalogCombinationV3: catalogUnisexMergeManifest.changes.findCatalogCombinationV3, ...operationalAutonomyR3Manifest.changes })}\\nconst operationalAutonomyA4Changes = ${JSON.stringify(operationalAutonomyA4Manifest.changes || {})}\\nconst operationalAutonomyA4Added = ${JSON.stringify(operationalAutonomyA4Manifest.added || {})}\\nconst operationalAutonomyA4Router = ${JSON.stringify(operationalAutonomyA4Manifest.router || {})}\\nconst operationalAutonomyA4RouteBlock = ${JSON.stringify(routeBlock)}\\n`)"
if (!wrapper.includes(oldInjected)) throw new Error('A4 cumulative variable injection anchor missing')
wrapper = wrapper.replace(oldInjected, newInjected)

if (!wrapper.includes('const patched = original')) throw new Error('A4 patched variable anchor missing')
wrapper = wrapper.replace('const patched = original', 'let patched = original')
const writeAnchor = 'fs.writeFileSync(legacyPath, patched)\n'
if (!wrapper.includes(writeAnchor)) throw new Error('A4 wrapper write anchor missing')

const patchCode = String.raw`patched = patched
  .replace(
    ' + Object.keys(catalogGenderScopeR1Added).length',
    ' + Object.keys(catalogGenderScopeR1Added).length + Object.keys(operationalAutonomyA4Added).length',
  )
  .replace(
    [
      '  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {',
      '    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)',
      '    check(sha(declarations.get(name)) === expectedHash, `Order delete mobility declaration changed beyond exact allow-list: ${name}`)',
      '  }',
    ].join('\n'),
    [
      '  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {',
      '    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)',
      '    const operationalAutonomyA4Changed = operationalAutonomyA4Changes[name]',
      '    let acceptedHash = expectedHash',
      '    if (operationalAutonomyA4Changed) {',
      '      check(operationalAutonomyA4Changed.before === acceptedHash, `Operational Autonomy A4 order-delete baseline hash mismatch: ${name}`)',
      '      acceptedHash = operationalAutonomyA4Changed.after',
      '    }',
      '    check(sha(declarations.get(name)) === acceptedHash, operationalAutonomyA4Changed',
      '      ? `Order delete mobility declaration changed beyond exact Operational Autonomy A4 allow-list: ${name}`',
      '      : `Order delete mobility declaration changed beyond exact allow-list: ${name}`)',
      '  }',
    ].join('\n'),
  )
  .replace(
    '  // Catalog gender scope R1 changes only the product create/update request shapes.',
    [
      '  for (const [name, expectedHash] of Object.entries(operationalAutonomyA4Added)) {',
      '    check(declarations.has(name), `Operational Autonomy A4 added Worker declaration missing: ${name}`)',
      '    check(sha(declarations.get(name)) === expectedHash, `Operational Autonomy A4 added Worker declaration changed: ${name}`)',
      '  }',
      '',
      '  // Catalog gender scope R1 changes only the product create/update request shapes.',
    ].join('\n'),
  )
  .replace(
    [
      "  check(sha(currentRouter) === catalogGenderScopeR1.router.after, 'Catalog gender scope R1 Worker router changed beyond exact delta')",
      '  const catalogGenderRevertedRouter = currentRouter',
    ].join('\n'),
    [
      "  check(sha(currentRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 raw Worker router changed beyond exact delta')",
      "  const operationalAutonomyA4RevertedRouter = currentRouter.replace(operationalAutonomyA4RouteBlock, '')",
      "  check(sha(operationalAutonomyA4RevertedRouter) === operationalAutonomyA4Router.before, 'Operational Autonomy A4 Worker router reverse baseline mismatch')",
      "  check(sha(operationalAutonomyA4RevertedRouter) === catalogGenderScopeR1.router.after, 'Catalog gender scope R1 Worker router changed beyond exact delta')",
      '  const catalogGenderRevertedRouter = operationalAutonomyA4RevertedRouter',
    ].join('\n'),
  )
`
wrapper = wrapper.replace(writeAnchor, patchCode + '\n' + writeAnchor)
fs.writeFileSync(wrapperPath, wrapper)

const workerCheck = spawnSync(process.execPath, ['scripts/test-step1906a-worker-modularization.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(workerCheck.stdout || '')
process.stderr.write(workerCheck.stderr || '')
if (workerCheck.status !== 0) throw new Error(`Exact A4 1906A run failed with ${workerCheck.status}`)

const frontend = spawnSync(process.execPath, ['scripts/test-step1906b-frontend-modularization.mjs'], { cwd: root, encoding: 'utf8' })
process.stdout.write(frontend.stdout || '')
process.stderr.write(frontend.stderr || '')
fs.writeFileSync(path.join(root, 'scripts/.a4-frontend-status.txt'), `status=${frontend.status}\n`)
console.log(`A4_FRONTEND_1906B_STATUS=${frontend.status}`)
