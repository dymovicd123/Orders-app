import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const root = process.cwd()
const base = 'df662be010ec697d7eab38c768dc447b1de97727'
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const write = (p, text) => fs.writeFileSync(path.join(root, p), text)
const show = (p) => execFileSync('git', ['show', base + ':' + p], { cwd: root, encoding: 'utf8' })
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
}
const lines = (text) => text.split(/\r?\n/).length
const declarationNames = (statement) => {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
const parseWorker = (textByPath) => {
  const declarations = new Map()
  let router = ''
  for (const [file, text] of Object.entries(textByPath)) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of source.statements) {
      for (const name of declarationNames(statement)) declarations.set(name, statement.getText(source).replace(/^export\s+/, ''))
      if (file === 'worker/index.ts' && ts.isExportAssignment(statement)) router = statement.getText(source)
    }
  }
  return { declarations, router }
}
const insertedBlock = (before, after) => {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  const removed = before.slice(prefix, before.length - suffix)
  const added = after.slice(prefix, after.length - suffix)
  if (removed) throw new Error('A5 router delta is not additive-only; removed ' + removed.length + ' chars')
  if (!added.includes('exchangeFinancialCorrectionMatch') || !added.includes('correctExchangeFinancials')) throw new Error('A5 route block not detected in exact router insertion')
  return added
}

const domainNames = fs.readdirSync(path.join(root, 'worker/domains')).filter((name) => name.endsWith('.ts'))
const currentWorkerFiles = Object.fromEntries(domainNames.map((name) => ['worker/domains/' + name, read('worker/domains/' + name)]))
currentWorkerFiles['worker/index.ts'] = read('worker/index.ts')
const baseWorkerFiles = Object.fromEntries(Object.keys(currentWorkerFiles).map((file) => [file, show(file)]))
const beforeWorker = parseWorker(baseWorkerFiles)
const afterWorker = parseWorker(currentWorkerFiles)
const addedName = 'correctExchangeFinancials'
if (beforeWorker.declarations.has(addedName) || !afterWorker.declarations.has(addedName)) throw new Error('A5 declaration addition shape unexpected')
const workerManifest = {
  version: 1,
  revision: 'operational-autonomy-a5-exchange-financial-correction-r1',
  changes: {},
  added: { [addedName]: sha256(afterWorker.declarations.get(addedName)) },
  router: {
    before: sha256(beforeWorker.router),
    after: sha256(afterWorker.router),
    block: insertedBlock(beforeWorker.router, afterWorker.router),
  },
}
write('scripts/operational-autonomy-a5-worker-manifest.json', JSON.stringify(workerManifest, null, 2) + '\n')

const frontendFiles = ['src/App.tsx', 'src/features/sections/OrderExchangeSection.tsx']
const frontendManifest = { version: 1, revision: 'operational-autonomy-a5-exchange-financial-correction-r1', files: {} }
for (const file of frontendFiles) {
  const before = show(file)
  const after = read(file)
  frontendManifest.files[file] = {
    beforeGitBlob: gitBlobSha(before),
    afterGitBlob: gitBlobSha(after),
    beforeLines: lines(before),
    afterLines: lines(after),
  }
}
write('scripts/operational-autonomy-a5-frontend-manifest.json', JSON.stringify(frontendManifest, null, 2) + '\n')

// 1906A: extend the accepted A4 layer with exactly one A5 declaration + one route insertion.
{
  const file = 'scripts/test-step1906a-worker-modularization.mjs'
  let text = read(file)
  const pathAnchor = "const operationalAutonomyA4ManifestPath = path.join(root, 'scripts/operational-autonomy-a4-worker-manifest.json')\n"
  if (!text.includes(pathAnchor)) throw new Error('1906A A4 manifest path anchor missing')
  text = text.replace(pathAnchor, pathAnchor + "const operationalAutonomyA5ManifestPath = path.join(root, 'scripts/operational-autonomy-a5-worker-manifest.json')\n")

  const validationAnchor = "if (Object.keys(operationalAutonomyA4Manifest.added || {}).join(',') !== 'correctMistakenOrderHandover') throw new Error('Operational Autonomy A4 Worker added allow-list widened unexpectedly')\n"
  if (!text.includes(validationAnchor)) throw new Error('1906A A4 validation anchor missing')
  text = text.replace(validationAnchor, validationAnchor
    + "const operationalAutonomyA5Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA5ManifestPath, 'utf8'))\n"
    + "if (operationalAutonomyA5Manifest?.version !== 1 || operationalAutonomyA5Manifest?.revision !== 'operational-autonomy-a5-exchange-financial-correction-r1') throw new Error('Operational Autonomy A5 Worker manifest invalid')\n"
    + "if (Object.keys(operationalAutonomyA5Manifest.changes || {}).length !== 0) throw new Error('Operational Autonomy A5 Worker changed allow-list widened unexpectedly')\n"
    + "if (Object.keys(operationalAutonomyA5Manifest.added || {}).join(',') !== 'correctExchangeFinancials') throw new Error('Operational Autonomy A5 Worker added allow-list widened unexpectedly')\n"
    + "if (!operationalAutonomyA5Manifest.router?.block) throw new Error('Operational Autonomy A5 Worker route block missing')\n")

  const writeAnchor = 'fs.writeFileSync(legacyPath, patched)\n'
  if (!text.includes(writeAnchor)) throw new Error('1906A patched-write anchor missing')
  const layerLines = [
    "const a4InjectedAnchor = 'const operationalAutonomyA4RouteBlock = ' + JSON.stringify(operationalAutonomyA4RouteBlock) + '\\n'",
    "if (!patched.includes(a4InjectedAnchor)) throw new Error('1906A A5 injected A4 anchor missing')",
    "patched = patched.replace(a4InjectedAnchor, a4InjectedAnchor + 'const operationalAutonomyA5Added = ' + JSON.stringify(operationalAutonomyA5Manifest.added || {}) + '\\n' + 'const operationalAutonomyA5Router = ' + JSON.stringify(operationalAutonomyA5Manifest.router || {}) + '\\n')",
    "patched = patched.replace(' + Object.keys(operationalAutonomyA4Added).length', ' + Object.keys(operationalAutonomyA4Added).length + Object.keys(operationalAutonomyA5Added).length')",
    "const catalogCommentAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'",
    "if (!patched.includes(catalogCommentAnchor)) throw new Error('1906A A5 added-declaration anchor missing')",
    "const a5AddedBlock = [",
    "  '  for (const [name, expectedHash] of Object.entries(operationalAutonomyA5Added)) {',",
    "  \"    check(declarations.has(name), 'Operational Autonomy A5 added Worker declaration missing: ' + name)\",",
    "  \"    check(sha(declarations.get(name)) === expectedHash, 'Operational Autonomy A5 added Worker declaration changed: ' + name)\",",
    "  '  }',",
    "  '',",
    "].join('\\n')",
    "patched = patched.replace(catalogCommentAnchor, a5AddedBlock + catalogCommentAnchor)",
    "const a4RouterAnchor = \"  check(sha(currentRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 raw Worker router changed beyond exact delta')\\n  const operationalAutonomyA4RevertedRouter = currentRouter.replace(operationalAutonomyA4RouteBlock, '')\"",
    "if (!patched.includes(a4RouterAnchor)) throw new Error('1906A A5 router anchor missing')",
    "const a5RouterBlock = [",
    "  \"  check(sha(currentRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 raw Worker router changed beyond exact delta')\",",
    "  \"  const operationalAutonomyA5RevertedRouter = currentRouter.replace(operationalAutonomyA5Router.block, '')\",",
    "  \"  check(sha(operationalAutonomyA5RevertedRouter) === operationalAutonomyA5Router.before, 'Operational Autonomy A5 Worker router reverse baseline mismatch')\",",
    "  \"  check(sha(operationalAutonomyA5RevertedRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 Worker router changed beneath A5')\",",
    "  \"  const operationalAutonomyA4RevertedRouter = operationalAutonomyA5RevertedRouter.replace(operationalAutonomyA4RouteBlock, '')\",",
    "].join('\\n')",
    "patched = patched.replace(a4RouterAnchor, a5RouterBlock)",
    '',
  ]
  text = text.replace(writeAnchor, layerLines.join('\n') + '\n' + writeAnchor)
  write(file, text)
}

// 1906B: accept only App + OrderExchangeSection exact A5 blobs over the prior chain.
{
  const file = 'scripts/test-step1906b-frontend-modularization.mjs'
  let text = read(file)
  const pathAnchor = "const operationalAutonomyA4ManifestPath = path.join(root, 'scripts/operational-autonomy-a4-frontend-manifest.json')\n"
  if (!text.includes(pathAnchor)) throw new Error('1906B A4 manifest path anchor missing')
  text = text.replace(pathAnchor, pathAnchor + "const operationalAutonomyA5ManifestPath = path.join(root, 'scripts/operational-autonomy-a5-frontend-manifest.json')\n")

  const validationAnchor = "if (Object.keys(operationalAutonomyA4Manifest.files || {}).join(',') !== 'src/App.tsx') throw new Error('Operational Autonomy A4 frontend allow-list widened unexpectedly')\n"
  if (!text.includes(validationAnchor)) throw new Error('1906B A4 validation anchor missing')
  text = text.replace(validationAnchor, validationAnchor
    + "const operationalAutonomyA5Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA5ManifestPath, 'utf8'))\n"
    + "if (operationalAutonomyA5Manifest?.version !== 1 || operationalAutonomyA5Manifest?.revision !== 'operational-autonomy-a5-exchange-financial-correction-r1') throw new Error('Operational Autonomy A5 frontend manifest invalid')\n"
    + "if (Object.keys(operationalAutonomyA5Manifest.files || {}).join(',') !== 'src/App.tsx,src/features/sections/OrderExchangeSection.tsx') throw new Error('Operational Autonomy A5 frontend allow-list widened unexpectedly')\n")

  const deltaAnchor = "    const operationalAutonomyA4Delta = operationalAutonomyA4Manifest.files?.[file]\n"
  if (!text.includes(deltaAnchor)) throw new Error('1906B A4 delta anchor missing')
  text = text.replace(deltaAnchor, deltaAnchor + "    const operationalAutonomyA5Delta = operationalAutonomyA5Manifest.files?.[file]\n")

  const a4Block = "    if (operationalAutonomyA4Delta) {\n      if (operationalAutonomyA4Delta.beforeGitBlob !== acceptedGitBlob || operationalAutonomyA4Delta.beforeLines !== acceptedLines) throw new Error('Operational Autonomy A4 frontend predecessor drifted: ' + file)\n      acceptedGitBlob = operationalAutonomyA4Delta.afterGitBlob\n      acceptedLines = operationalAutonomyA4Delta.afterLines\n    }\n"
  if (!text.includes(a4Block)) throw new Error('1906B A4 acceptance block missing')
  text = text.replace(a4Block, a4Block
    + "    if (operationalAutonomyA5Delta) {\n      if (operationalAutonomyA5Delta.beforeGitBlob !== acceptedGitBlob || operationalAutonomyA5Delta.beforeLines !== acceptedLines) throw new Error('Operational Autonomy A5 frontend predecessor drifted: ' + file)\n      acceptedGitBlob = operationalAutonomyA5Delta.afterGitBlob\n      acceptedLines = operationalAutonomyA5Delta.afterLines\n    }\n")

  const errorAnchor = "      throw new Error(operationalAutonomyA4Delta\n        ? 'Operational Autonomy A4 frontend file changed beyond exact manifest: ' + file\n        : mergeDelta"
  if (!text.includes(errorAnchor)) throw new Error('1906B A4 error anchor missing')
  text = text.replace(errorAnchor,
    "      throw new Error(operationalAutonomyA5Delta\n        ? 'Operational Autonomy A5 frontend file changed beyond exact manifest: ' + file\n        : operationalAutonomyA4Delta\n          ? 'Operational Autonomy A4 frontend file changed beyond exact manifest: ' + file\n          : mergeDelta")
  write(file, text)
}

console.log(JSON.stringify({ workerManifest, frontendManifest }, null, 2))
