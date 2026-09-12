import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const write = (relative, text) => fs.writeFileSync(path.join(root, relative), text)
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const lineCount = (text) => text.split(/\r?\n/).length
const mainText = (relative) => execFileSync('git', ['show', `origin/main:${relative}`], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})

function replaceOnce(relative, oldText, newText) {
  const current = read(relative)
  const count = current.split(oldText).length - 1
  if (count !== 1) throw new Error(`${relative}: replacement anchor count ${count}, expected 1`)
  write(relative, current.replace(oldText, newText))
}

// Finish the order-level Dashboard contract: if one line makes an ORD noteworthy,
// include every currently active Workshop line of that ORD in the already-loaded payload.
replaceOnce(
  'worker/domains/inventory-read.ts',
  '  const sortedWorkshopWarnings = allWorkshop.map(row => {',
  '  const allWorkshopWarningRows = allWorkshop.map(row => {',
)
replaceOnce(
  'worker/domains/inventory-read.ts',
  `  }).filter(row => row.waitingDays >= workshopAgeLimit || row.overdueDays > 0 || row.urgent || Boolean(row.dueDate))
    .sort((a, b) => {`,
  `  });
  const sortedWorkshopWarnings = allWorkshopWarningRows
    .filter(row => row.waitingDays >= workshopAgeLimit || row.overdueDays > 0 || row.urgent || Boolean(row.dueDate))
    .sort((a, b) => {`,
)
replaceOnce(
  'worker/domains/inventory-read.ts',
  `  const selectedWorkshopOrderKeys = new Set<string>();
  const workshopWarnings = sortedWorkshopWarnings.filter(row => {
    const orderKey = row.orderId > 0 ? \`id:\${row.orderId}\` : \`ref:\${row.externalOrderId || row.id}\`;
    if (selectedWorkshopOrderKeys.has(orderKey)) return true;
    if (selectedWorkshopOrderKeys.size >= 80) return false;
    selectedWorkshopOrderKeys.add(orderKey);
    return true;
  });`,
  `  const selectedWorkshopOrderKeys = new Set<string>();
  for (const row of sortedWorkshopWarnings) {
    const orderKey = row.orderId > 0 ? \`id:\${row.orderId}\` : \`ref:\${row.externalOrderId || row.id}\`;
    if (selectedWorkshopOrderKeys.has(orderKey)) continue;
    if (selectedWorkshopOrderKeys.size >= 80) break;
    selectedWorkshopOrderKeys.add(orderKey);
  }
  const workshopWarnings = allWorkshopWarningRows.filter(row => {
    const orderKey = row.orderId > 0 ? \`id:\${row.orderId}\` : \`ref:\${row.externalOrderId || row.id}\`;
    return selectedWorkshopOrderKeys.has(orderKey);
  });`,
)

replaceOnce(
  'scripts/test-stabilization-20260912-r1.mjs',
  `assert.ok(dashboard.includes('const selectedWorkshopOrderKeys = new Set<string>()'), 'Dashboard order-level attention cap missing')
assert.ok(dashboard.includes('selectedWorkshopOrderKeys.size >= 80'), 'Dashboard must cap attention by order count')
assert.ok(!dashboard.includes('.slice(0, 80);'), 'Dashboard must not truncate task rows before order grouping')`,
  `assert.ok(dashboard.includes('const allWorkshopWarningRows = allWorkshop.map'), 'Dashboard must retain all active task rows before choosing attention orders')
assert.ok(dashboard.includes('const selectedWorkshopOrderKeys = new Set<string>()'), 'Dashboard order-level attention cap missing')
assert.ok(dashboard.includes('selectedWorkshopOrderKeys.size >= 80'), 'Dashboard must cap attention by order count')
assert.ok(dashboard.includes('const workshopWarnings = allWorkshopWarningRows.filter'), 'Selected attention orders must include every active sibling Workshop line')
assert.ok(!dashboard.includes('.slice(0, 80);'), 'Dashboard must not truncate task rows before order grouping')`,
)

// Generate an exact current-main -> stabilization declaration delta using the same
// TypeScript AST representation as the historical Step 190.6A gate.
function declarationNames(statement) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
function declarationMap(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result = new Map()
  for (const statement of source.statements) {
    for (const name of declarationNames(statement)) result.set(name, statement.getText(source).replace(/^export\s+/, ''))
  }
  return result
}

const workerFiles = [
  'worker/domains/inventory-read.ts',
  'worker/domains/returns-exchanges.ts',
  'worker/domains/workshop.ts',
]
const workerChanges = {}
for (const relative of workerFiles) {
  const before = declarationMap(relative, mainText(relative))
  const after = declarationMap(relative, read(relative))
  const names = new Set([...before.keys(), ...after.keys()])
  for (const name of names) {
    const left = before.get(name)
    const right = after.get(name)
    if (left === right) continue
    if (left == null || right == null) throw new Error(`Unexpected added/removed Worker declaration: ${name}`)
    workerChanges[name] = { before: sha256(left), after: sha256(right) }
  }
}
const expectedWorkerNames = ['createReturn', 'getDashboardInsights', 'listWorkshopTasks', 'readWorkshopCounts', 'workshopStandaloneReturnOrdersCte']
const actualWorkerNames = Object.keys(workerChanges).sort()
if (JSON.stringify(actualWorkerNames) !== JSON.stringify(expectedWorkerNames)) {
  throw new Error(`Unexpected Worker stabilization declaration set: ${actualWorkerNames.join(',')}`)
}
write('scripts/stabilization-20260912-r1-worker-manifest.json', JSON.stringify({
  version: 1,
  revision: 'stabilization-20260912-r1',
  changes: Object.fromEntries(expectedWorkerNames.map((name) => [name, workerChanges[name]])),
}, null, 2) + '\n')

// Pin the three frontend files touched by this stabilization against current main.
const frontendFiles = [
  'src/features/sections/DashboardSection.tsx',
  'src/features/sections/OrderExchangeSection.tsx',
  'src/features/sections/OrderReturnsSection.tsx',
]
const frontendManifest = { version: 1, revision: 'stabilization-20260912-r1', files: {} }
for (const relative of frontendFiles) {
  const before = mainText(relative)
  const after = read(relative)
  if (before === after) throw new Error(`Expected frontend stabilization delta missing: ${relative}`)
  frontendManifest.files[relative] = {
    beforeGitBlob: gitBlobSha(before),
    afterGitBlob: gitBlobSha(after),
    beforeLines: lineCount(before),
    afterLines: lineCount(after),
  }
}
write('scripts/stabilization-20260912-r1-frontend-manifest.json', JSON.stringify(frontendManifest, null, 2) + '\n')

// Add one final narrow Worker hash layer after the already accepted physical-intake layer.
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  "const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-worker-manifest.json')",
  "const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-worker-manifest.json')\nconst stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-worker-manifest.json')",
)
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  "if (!returnsPhysicalIntakeManifest.router?.block) throw new Error('Returns physical intake R1 Worker route block missing')",
  "if (!returnsPhysicalIntakeManifest.router?.block) throw new Error('Returns physical intake R1 Worker route block missing')\nconst stabilizationManifest = JSON.parse(fs.readFileSync(stabilizationManifestPath, 'utf8'))\nif (stabilizationManifest?.version !== 1 || stabilizationManifest?.revision !== 'stabilization-20260912-r1') throw new Error('September 12 stabilization Worker manifest invalid')\nif (Object.keys(stabilizationManifest.changes || {}).sort().join(',') !== 'createReturn,getDashboardInsights,listWorkshopTasks,readWorkshopCounts,workshopStandaloneReturnOrdersCte') throw new Error('September 12 stabilization Worker allow-list widened unexpectedly')",
)
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  `  + 'const returnsPhysicalIntakeRouter = ' + JSON.stringify(returnsPhysicalIntakeManifest.router || {}) + '\\n')`,
  `  + 'const returnsPhysicalIntakeRouter = ' + JSON.stringify(returnsPhysicalIntakeManifest.router || {}) + '\\n'
  + 'const stabilizationChanges = ' + JSON.stringify(stabilizationManifest.changes || {}) + '\\n')`,
)
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  `  '        return sha(declarations.get(name)) === acceptedPostReturnsPhysicalIntakeHash',`,
  `  '        const stabilizationChanged = stabilizationChanges[name]',
  '        let acceptedPostStabilizationHash = acceptedPostReturnsPhysicalIntakeHash',
  '        if (stabilizationChanged) {',
  "          check(stabilizationChanged.before === acceptedPostReturnsPhysicalIntakeHash, 'September 12 stabilization baseline hash mismatch: ' + name)",
  '          acceptedPostStabilizationHash = stabilizationChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostStabilizationHash',`,
)

// Chain exact frontend files after physical intake without weakening any predecessor layer.
replaceOnce(
  'scripts/test-step1906b-frontend-modularization.mjs',
  "const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-frontend-manifest.json')",
  "const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-frontend-manifest.json')\nconst stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-frontend-manifest.json')",
)
replaceOnce(
  'scripts/test-step1906b-frontend-modularization.mjs',
  "if (JSON.stringify(Object.keys(returnsPhysicalIntakeManifest.files || {})) !== JSON.stringify(returnsPhysicalIntakeExpectedFiles)) throw new Error('Returns physical intake R1 frontend allow-list widened unexpectedly')",
  "if (JSON.stringify(Object.keys(returnsPhysicalIntakeManifest.files || {})) !== JSON.stringify(returnsPhysicalIntakeExpectedFiles)) throw new Error('Returns physical intake R1 frontend allow-list widened unexpectedly')\nconst stabilizationManifest = JSON.parse(fs.readFileSync(stabilizationManifestPath, 'utf8'))\nif (stabilizationManifest?.version !== 1 || stabilizationManifest?.revision !== 'stabilization-20260912-r1') throw new Error('September 12 stabilization frontend manifest invalid')\nconst stabilizationExpectedFiles = ['src/features/sections/DashboardSection.tsx','src/features/sections/OrderExchangeSection.tsx','src/features/sections/OrderReturnsSection.tsx']\nif (JSON.stringify(Object.keys(stabilizationManifest.files || {})) !== JSON.stringify(stabilizationExpectedFiles)) throw new Error('September 12 stabilization frontend allow-list widened unexpectedly')",
)
replaceOnce(
  'scripts/test-step1906b-frontend-modularization.mjs',
  `for (const file of ['src/app/utils.ts', 'src/features/sections/OrderReturnsSection.tsx']) {
  const delta = returnsPhysicalIntakeManifest.files[file]
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (!delta || gitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\\r?\\n/).length !== delta.afterLines) throw new Error('Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)
}`,
  `for (const file of ['src/app/utils.ts', 'src/features/sections/OrderReturnsSection.tsx']) {
  const delta = returnsPhysicalIntakeManifest.files[file]
  const stabilizationDelta = stabilizationManifest.files?.[file]
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  let acceptedGitBlob = delta?.afterGitBlob
  let acceptedLines = delta?.afterLines
  if (stabilizationDelta) {
    if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)
    acceptedGitBlob = stabilizationDelta.afterGitBlob
    acceptedLines = stabilizationDelta.afterLines
  }
  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) throw new Error(stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)
}`,
)
replaceOnce(
  'scripts/test-step1906b-frontend-modularization.mjs',
  `    if (returnsPhysicalIntakeDelta) {
      if (returnsPhysicalIntakeDelta.beforeGitBlob !== acceptedGitBlob || returnsPhysicalIntakeDelta.beforeLines !== acceptedLines) throw new Error('Returns physical intake R1 frontend predecessor drifted: ' + file)
      acceptedGitBlob = returnsPhysicalIntakeDelta.afterGitBlob
      acceptedLines = returnsPhysicalIntakeDelta.afterLines
    }`,
  `    if (returnsPhysicalIntakeDelta) {
      if (returnsPhysicalIntakeDelta.beforeGitBlob !== acceptedGitBlob || returnsPhysicalIntakeDelta.beforeLines !== acceptedLines) throw new Error('Returns physical intake R1 frontend predecessor drifted: ' + file)
      acceptedGitBlob = returnsPhysicalIntakeDelta.afterGitBlob
      acceptedLines = returnsPhysicalIntakeDelta.afterLines
    }
    const stabilizationDelta = stabilizationManifest.files?.[file]
    if (stabilizationDelta) {
      if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)
      acceptedGitBlob = stabilizationDelta.afterGitBlob
      acceptedLines = stabilizationDelta.afterLines
    }`,
)
replaceOnce(
  'scripts/test-step1906b-frontend-modularization.mjs',
  `      throw new Error(returnsPhysicalIntakeDelta
        ? 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file`,
  `      throw new Error(stabilizationDelta
        ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file
        : returnsPhysicalIntakeDelta
        ? 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file`,
)
const frontendWrapper = read('scripts/test-step1906b-frontend-modularization.mjs')
const dashboardCheckAnchor = 'const current = new Map()'
if (!frontendWrapper.includes(dashboardCheckAnchor)) throw new Error('1906B dashboard stabilization anchor missing')
const dashboardCheck = `const stabilizationDashboardFile = 'src/features/sections/DashboardSection.tsx'
const stabilizationDashboardDelta = stabilizationManifest.files[stabilizationDashboardFile]
const stabilizationDashboardActual = fs.readFileSync(path.join(root, stabilizationDashboardFile), 'utf8')
if (!stabilizationDashboardDelta || gitBlobSha(stabilizationDashboardActual) !== stabilizationDashboardDelta.afterGitBlob || stabilizationDashboardActual.split(/\\r?\\n/).length !== stabilizationDashboardDelta.afterLines) throw new Error('September 12 Dashboard frontend changed beyond exact stabilization manifest')

`
write('scripts/test-step1906b-frontend-modularization.mjs', frontendWrapper.replace(dashboardCheckAnchor, dashboardCheck + dashboardCheckAnchor))

console.log('September 12 stabilization structural finalizer applied.')
