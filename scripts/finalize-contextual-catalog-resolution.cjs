const fs = require('fs')
const crypto = require('crypto')
const cp = require('child_process')
const ts = require('typescript')

const read = (p) => fs.readFileSync(p, 'utf8')
const write = (p, v) => fs.writeFileSync(p, v)
const replaceOnce = (text, before, after, label) => {
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected one anchor, got ${count}`)
  return text.replace(before, after)
}
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const lineCount = (text) => text.split(/\r?\n/).length
const showMain = (file) => cp.execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' })

const declarationNames = (statement) => {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
const declarationHash = (file, text, target) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (!declarationNames(statement).includes(target)) continue
    return sha256(statement.getText(source).replace(/^export\s+/, ''))
  }
  throw new Error(`Declaration not found: ${target}`)
}
const routerText = (text) => {
  const source = ts.createSourceFile('worker/index.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) if (ts.isExportAssignment(statement)) return statement.getText(source)
  throw new Error('Worker router export assignment not found')
}

const mainIndex = showMain('worker/index.ts')
const currentIndex = read('worker/index.ts')
const mainRouter = routerText(mainIndex)
const currentRouter = routerText(currentIndex)

const routeStart = currentRouter.indexOf('      const orderCatalogReviewMatch = url.pathname.match(')
const routeEnd = currentRouter.indexOf("      if (url.pathname === '/api/catalog/review' && request.method === 'GET')", routeStart)
if (routeStart < 0 || routeEnd < 0) throw new Error('Contextual catalog route block not found')
const routeBlock = currentRouter.slice(routeStart, routeEnd)

const shippingStartNeedle = '        if (humanInventoryModelEnabled) {'
const shippingEndNeedle = "          const shortageBlockers = blockers.filter((row) => cleanText(row.blocker_reason) === 'insufficient_physical');\n"
const extractShippingPrefix = (router) => {
  const start = router.indexOf(shippingStartNeedle)
  const endStart = router.indexOf(shippingEndNeedle, start)
  if (start < 0 || endStart < 0) throw new Error('Shipping catalog preflight block not found')
  return router.slice(start, endStart + shippingEndNeedle.length)
}
const shippingBefore = extractShippingPrefix(mainRouter)
const shippingAfter = extractShippingPrefix(currentRouter)
let reversedRouter = currentRouter.replace(routeBlock, '').replace(shippingAfter, shippingBefore)
if (reversedRouter !== mainRouter) throw new Error('Contextual router reverse does not exactly reproduce main')

const workerManifest = {
  version: 1,
  revision: 'contextual-catalog-resolution-r1',
  added: {
    reconcileCatalogReviewOrder: declarationHash('worker/domains/catalog-review.ts', read('worker/domains/catalog-review.ts'), 'reconcileCatalogReviewOrder'),
    resolveOrderCatalogReviewExistingVariant: declarationHash('worker/domains/catalog-review.ts', read('worker/domains/catalog-review.ts'), 'resolveOrderCatalogReviewExistingVariant'),
  },
  router: {
    before: sha256(mainRouter),
    after: sha256(currentRouter),
    routeBlock,
    shippingBefore,
    shippingAfter,
  },
}
write('scripts/contextual-catalog-resolution-r1-worker-manifest.json', JSON.stringify(workerManifest, null, 2) + '\n')

const frontendManifest = { version: 1, revision: 'contextual-catalog-resolution-r1', files: {} }
for (const file of ['src/App.tsx']) {
  const before = showMain(file)
  const after = read(file)
  frontendManifest.files[file] = { beforeGitBlob: gitBlobSha(before), afterGitBlob: gitBlobSha(after), beforeLines: lineCount(before), afterLines: lineCount(after) }
}
for (const file of ['src/features/orders/OrderCatalogResolutionModal.tsx', 'src/features/orders/OrderCatalogResolutionModal.css']) {
  const after = read(file)
  frontendManifest.files[file] = { beforeGitBlob: null, afterGitBlob: gitBlobSha(after), beforeLines: 0, afterLines: lineCount(after), added: true }
}
write('scripts/contextual-catalog-resolution-r1-frontend-manifest.json', JSON.stringify(frontendManifest, null, 2) + '\n')

let workerGate = read('scripts/test-step1906a-worker-modularization.mjs')
workerGate = replaceOnce(
  workerGate,
  "const clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-worker-manifest.json')\n",
  "const clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-worker-manifest.json')\nconst contextualCatalogResolutionManifestPath = path.join(root, 'scripts/contextual-catalog-resolution-r1-worker-manifest.json')\n",
  'worker manifest path',
)
workerGate = replaceOnce(
  workerGate,
  "if (Object.keys(clientFixesManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('Client fixes Worker allow-list widened unexpectedly')\n",
  "if (Object.keys(clientFixesManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('Client fixes Worker allow-list widened unexpectedly')\nconst contextualCatalogResolutionManifest = JSON.parse(fs.readFileSync(contextualCatalogResolutionManifestPath, 'utf8'))\nif (contextualCatalogResolutionManifest?.version !== 1 || contextualCatalogResolutionManifest?.revision !== 'contextual-catalog-resolution-r1') throw new Error('Contextual catalog resolution Worker manifest invalid')\nif (Object.keys(contextualCatalogResolutionManifest.added || {}).sort().join(',') !== 'reconcileCatalogReviewOrder,resolveOrderCatalogReviewExistingVariant') throw new Error('Contextual catalog resolution Worker added allow-list widened unexpectedly')\n",
  'worker manifest validation',
)
workerGate = replaceOnce(
  workerGate,
  "  + 'const clientFixesChanges = ' + JSON.stringify(clientFixesManifest.changes || {}) + '\\n')",
  "  + 'const clientFixesChanges = ' + JSON.stringify(clientFixesManifest.changes || {}) + '\\n'\n  + 'const contextualCatalogResolutionAdded = ' + JSON.stringify(contextualCatalogResolutionManifest.added || {}) + '\\n'\n  + 'const contextualCatalogResolutionRouter = ' + JSON.stringify(contextualCatalogResolutionManifest.router || {}) + '\\n')",
  'worker injected contextual values',
)
workerGate = replaceOnce(
  workerGate,
  "patched = patched.replace(physicalCountAnchor, physicalCountAnchor + ' + Object.keys(returnsPhysicalIntakeAdded).length')",
  "patched = patched.replace(physicalCountAnchor, physicalCountAnchor + ' + Object.keys(returnsPhysicalIntakeAdded).length + Object.keys(contextualCatalogResolutionAdded).length')",
  'worker declaration count',
)
const addedAnchor = "const physicalAddedAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'"
const addedInsertion = [
  "const contextualAddedBlock = [",
  "  '  for (const [name, expectedHash] of Object.entries(contextualCatalogResolutionAdded)) {',",
  "  \"    check(declarations.has(name), 'Contextual catalog resolution added Worker declaration missing: ' + name)\",",
  "  \"    check(sha(declarations.get(name)) === expectedHash, 'Contextual catalog resolution added Worker declaration changed: ' + name)\",",
  "  '  }',",
  "  '',",
  "].join('\\n')",
  '',
].join('\n')
if (!workerGate.includes(addedAnchor)) throw new Error('worker added declaration anchor missing')
workerGate = workerGate.replace(addedAnchor, addedInsertion + addedAnchor)
workerGate = replaceOnce(
  workerGate,
  "patched = patched.replace(physicalAddedAnchor, physicalAddedBlock + physicalAddedAnchor)",
  "patched = patched.replace(physicalAddedAnchor, physicalAddedBlock + contextualAddedBlock + physicalAddedAnchor)",
  'worker added declaration checks',
)
const physicalRouterNeedle = "  \"  check(sha(currentRouter) === returnsPhysicalIntakeRouter.after, 'Returns physical intake R1 raw Worker router changed beyond exact delta')\",\n  \"  let returnsPhysicalIntakeRevertedRouter = currentRouter.replace(returnsPhysicalIntakeRouter.block, '')\","
const contextualRouterNeedle = "  \"  check(sha(currentRouter) === contextualCatalogResolutionRouter.after, 'Contextual catalog resolution Worker router changed beyond exact delta')\",\n  \"  const contextualCatalogResolutionRevertedRouter = currentRouter.replace(contextualCatalogResolutionRouter.routeBlock, '').replace(contextualCatalogResolutionRouter.shippingAfter, contextualCatalogResolutionRouter.shippingBefore)\",\n  \"  check(sha(contextualCatalogResolutionRevertedRouter) === contextualCatalogResolutionRouter.before, 'Contextual catalog resolution Worker router reverse baseline mismatch')\",\n  \"  check(sha(contextualCatalogResolutionRevertedRouter) === returnsPhysicalIntakeRouter.after, 'Returns physical intake router changed beneath contextual catalog resolution')\",\n  \"  let returnsPhysicalIntakeRevertedRouter = contextualCatalogResolutionRevertedRouter.replace(returnsPhysicalIntakeRouter.block, '')\","
workerGate = replaceOnce(workerGate, physicalRouterNeedle, contextualRouterNeedle, 'worker router contextual layer')
write('scripts/test-step1906a-worker-modularization.mjs', workerGate)

let frontendGate = read('scripts/test-step1906b-frontend-modularization.mjs')
frontendGate = replaceOnce(
  frontendGate,
  "const clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-frontend-manifest.json')\n",
  "const clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-frontend-manifest.json')\nconst contextualCatalogResolutionManifestPath = path.join(root, 'scripts/contextual-catalog-resolution-r1-frontend-manifest.json')\n",
  'frontend manifest path',
)
frontendGate = replaceOnce(
  frontendGate,
  "if (JSON.stringify(Object.keys(clientFixesManifest.files || {})) !== JSON.stringify(clientFixesExpectedFiles)) throw new Error('Client fixes frontend allow-list widened unexpectedly')\n",
  "if (JSON.stringify(Object.keys(clientFixesManifest.files || {})) !== JSON.stringify(clientFixesExpectedFiles)) throw new Error('Client fixes frontend allow-list widened unexpectedly')\nconst contextualCatalogResolutionManifest = JSON.parse(fs.readFileSync(contextualCatalogResolutionManifestPath, 'utf8'))\nif (contextualCatalogResolutionManifest?.version !== 1 || contextualCatalogResolutionManifest?.revision !== 'contextual-catalog-resolution-r1') throw new Error('Contextual catalog resolution frontend manifest invalid')\nconst contextualCatalogResolutionExpectedFiles = ['src/App.tsx','src/features/orders/OrderCatalogResolutionModal.tsx','src/features/orders/OrderCatalogResolutionModal.css']\nif (JSON.stringify(Object.keys(contextualCatalogResolutionManifest.files || {})) !== JSON.stringify(contextualCatalogResolutionExpectedFiles)) throw new Error('Contextual catalog resolution frontend allow-list widened unexpectedly')\n",
  'frontend manifest validation',
)
const contextualIndependentChecks = `
for (const file of ['src/features/orders/OrderCatalogResolutionModal.tsx', 'src/features/orders/OrderCatalogResolutionModal.css']) {
  const delta = contextualCatalogResolutionManifest.files[file]
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (!delta?.added || delta.beforeGitBlob !== null || gitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\\r?\\n/).length !== delta.afterLines) throw new Error('Contextual catalog resolution added frontend file changed beyond exact manifest: ' + file)
}
`
frontendGate = replaceOnce(
  frontendGate,
  "const gitBlobSha = (text) => { const bytes = Buffer.from(text); return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\\0')).update(bytes).digest('hex') }\n",
  "const gitBlobSha = (text) => { const bytes = Buffer.from(text); return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\\0')).update(bytes).digest('hex') }\n" + contextualIndependentChecks,
  'frontend added file checks',
)
frontendGate = replaceOnce(
  frontendGate,
  "    const clientFixesDelta = clientFixesManifest.files?.[file]\n    let acceptedGitBlob = delta.afterGitBlob",
  "    const clientFixesDelta = clientFixesManifest.files?.[file]\n    const contextualCatalogResolutionDelta = contextualCatalogResolutionManifest.files?.[file]\n    let acceptedGitBlob = delta.afterGitBlob",
  'frontend expected file delta variable',
)
frontendGate = replaceOnce(
  frontendGate,
  "    if (clientFixesDelta) {\n      if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)\n      acceptedGitBlob = clientFixesDelta.afterGitBlob\n      acceptedLines = clientFixesDelta.afterLines\n    }\n    if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) {\n      throw new Error(clientFixesDelta",
  "    if (clientFixesDelta) {\n      if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)\n      acceptedGitBlob = clientFixesDelta.afterGitBlob\n      acceptedLines = clientFixesDelta.afterLines\n    }\n    if (contextualCatalogResolutionDelta) {\n      if (contextualCatalogResolutionDelta.beforeGitBlob !== acceptedGitBlob || contextualCatalogResolutionDelta.beforeLines !== acceptedLines) throw new Error('Contextual catalog resolution frontend predecessor drifted: ' + file)\n      acceptedGitBlob = contextualCatalogResolutionDelta.afterGitBlob\n      acceptedLines = contextualCatalogResolutionDelta.afterLines\n    }\n    if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) {\n      throw new Error(contextualCatalogResolutionDelta\n        ? 'Contextual catalog resolution frontend file changed beyond exact manifest: ' + file\n        : clientFixesDelta",
  'frontend App final exact layer',
)
write('scripts/test-step1906b-frontend-modularization.mjs', frontendGate)

console.log('Contextual catalog preservation manifests and exact gates generated')
