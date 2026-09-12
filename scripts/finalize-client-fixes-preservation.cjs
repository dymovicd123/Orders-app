const fs = require('fs')
const crypto = require('crypto')
const cp = require('child_process')
const ts = require('typescript')

const read = (p) => fs.readFileSync(p, 'utf8')
const write = (p, v) => fs.writeFileSync(p, v)
const replaceOnce = (text, before, after, label) => {
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, got ${count}`)
  return text.replace(before, after)
}
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const lines = (text) => text.split(/\r?\n/).length
const declarationNames = (statement) => {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
const declarationHashFromText = (file, text, targetName) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (!declarationNames(statement).includes(targetName)) continue
    const normalized = statement.getText(source).replace(/^export\s+/, '')
    return sha256(normalized)
  }
  throw new Error(`Declaration not found: ${targetName} in ${file}`)
}
const showMain = (file) => cp.execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' })

const finance = read('worker/domains/finance-reports.ts')
if (!finance.includes('r.return_date, r.amount, r.payment_method, r.status')) throw new Error('Return payment_method is missing from finance return query')
if (!finance.includes('canonicalPaymentMethodName(row.payment_method)')) throw new Error('Return payment_method is not used by reconciliation')
if (!finance.includes("financeWorkspaceOnly || reportType === 'payments'")) throw new Error('Selected payments report is not reusing operation rows for daily totals')

let focused = read('scripts/test-client-fixes-20260912-r1.mjs')
focused = replaceOnce(
  focused,
  "  check(financeWorker.includes('paymentMethodReconciliation') && financeWorker.includes('paymentReconciliationByDay'), 'Finance API must expose method/day reconciliation')\n",
  "  check(financeWorker.includes('paymentMethodReconciliation') && financeWorker.includes('paymentReconciliationByDay'), 'Finance API must expose method/day reconciliation')\n  check(financeWorker.includes('r.return_date, r.amount, r.payment_method, r.status') && financeWorker.includes('canonicalPaymentMethodName(row.payment_method)'), 'Refund reconciliation must use the recorded return payment method instead of collapsing refunds into an unknown method')\n",
  'focused return payment method guard',
)
write('scripts/test-client-fixes-20260912-r1.mjs', focused)

const workerTargets = [
  ['worker/domains/inventory-read.ts', 'getDashboardInsights'],
  ['worker/domains/finance-reports.ts', 'listFinanceReports'],
]
const workerChanges = {}
for (const [file, name] of workerTargets) {
  workerChanges[name] = {
    before: declarationHashFromText(file, showMain(file), name),
    after: declarationHashFromText(file, read(file), name),
  }
}
const acceptedR2 = JSON.parse(read('scripts/stabilization-20260912-r2-manager-date-worker-manifest.json')).changes
if (workerChanges.getDashboardInsights.before !== acceptedR2.getDashboardInsights.after) throw new Error('Client Dashboard Worker predecessor is not accepted R2')
if (workerChanges.listFinanceReports.before !== acceptedR2.listFinanceReports.after) throw new Error('Client finance Worker predecessor is not accepted R2')
write('scripts/client-fixes-20260912-r1-worker-manifest.json', JSON.stringify({
  version: 1,
  revision: 'client-fixes-20260912-r1',
  changes: workerChanges,
}, null, 2) + '\n')

const frontendFiles = [
  'src/App.tsx',
  'src/app/types.ts',
  'src/app/utils.ts',
  'src/features/renderers/FinanceReportContentRenderer.tsx',
  'src/features/sections/DashboardSection.tsx',
  'src/features/sections/OrderExchangeSection.tsx',
]
const frontendManifest = { version: 1, revision: 'client-fixes-20260912-r1', files: {} }
for (const file of frontendFiles) {
  const before = showMain(file)
  const after = read(file)
  frontendManifest.files[file] = {
    beforeGitBlob: gitBlobSha(before),
    afterGitBlob: gitBlobSha(after),
    beforeLines: lines(before),
    afterLines: lines(after),
  }
}
write('scripts/client-fixes-20260912-r1-frontend-manifest.json', JSON.stringify(frontendManifest, null, 2) + '\n')

let workerGate = read('scripts/test-step1906a-worker-modularization.mjs')
workerGate = replaceOnce(
  workerGate,
  "const businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-worker-manifest.json')\n",
  "const businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-worker-manifest.json')\nconst clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-worker-manifest.json')\n",
  '1906A client manifest path',
)
workerGate = replaceOnce(
  workerGate,
  "if (Object.keys(businessDateBoundaryManifest.changes || {}).sort().join(',') !== 'normalizeDate,normalizeMonthParam,parseArchiveRules,parseReportDateRange,resolveWorkshopPeriod') throw new Error('Business date boundary Worker allow-list widened unexpectedly')\n",
  "if (Object.keys(businessDateBoundaryManifest.changes || {}).sort().join(',') !== 'normalizeDate,normalizeMonthParam,parseArchiveRules,parseReportDateRange,resolveWorkshopPeriod') throw new Error('Business date boundary Worker allow-list widened unexpectedly')\nconst clientFixesManifest = JSON.parse(fs.readFileSync(clientFixesManifestPath, 'utf8'))\nif (clientFixesManifest?.version !== 1 || clientFixesManifest?.revision !== 'client-fixes-20260912-r1') throw new Error('Client fixes Worker manifest invalid')\nif (Object.keys(clientFixesManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('Client fixes Worker allow-list widened unexpectedly')\n",
  '1906A client manifest validation',
)
workerGate = replaceOnce(
  workerGate,
  "  + 'const businessDateBoundaryChanges = ' + JSON.stringify(businessDateBoundaryManifest.changes || {}) + '\\n')",
  "  + 'const businessDateBoundaryChanges = ' + JSON.stringify(businessDateBoundaryManifest.changes || {}) + '\\n'\n  + 'const clientFixesChanges = ' + JSON.stringify(clientFixesManifest.changes || {}) + '\\n')",
  '1906A injected client changes',
)
workerGate = replaceOnce(
  workerGate,
  "  '        return sha(declarations.get(name)) === acceptedPostBusinessDateBoundaryHash',\n",
  "  '        const clientFixesChanged = clientFixesChanges[name]',\n  '        let acceptedPostClientFixesHash = acceptedPostBusinessDateBoundaryHash',\n  '        if (clientFixesChanged) {',\n  \"          check(clientFixesChanged.before === acceptedPostBusinessDateBoundaryHash, 'Client fixes baseline hash mismatch: ' + name)\",\n  '          acceptedPostClientFixesHash = clientFixesChanged.after',\n  '        }',\n  '        return sha(declarations.get(name)) === acceptedPostClientFixesHash',\n",
  '1906A final client hash layer',
)
write('scripts/test-step1906a-worker-modularization.mjs', workerGate)

let frontendGate = read('scripts/test-step1906b-frontend-modularization.mjs')
frontendGate = replaceOnce(
  frontendGate,
  "const businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-frontend-manifest.json')\n",
  "const businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-frontend-manifest.json')\nconst clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-frontend-manifest.json')\n",
  '1906B client manifest path',
)
frontendGate = replaceOnce(
  frontendGate,
  "if (JSON.stringify(Object.keys(businessDateBoundaryManifest.files || {})) !== JSON.stringify(businessDateBoundaryExpectedFiles)) throw new Error('Business date boundary frontend allow-list widened unexpectedly')\n",
  "if (JSON.stringify(Object.keys(businessDateBoundaryManifest.files || {})) !== JSON.stringify(businessDateBoundaryExpectedFiles)) throw new Error('Business date boundary frontend allow-list widened unexpectedly')\nconst clientFixesManifest = JSON.parse(fs.readFileSync(clientFixesManifestPath, 'utf8'))\nif (clientFixesManifest?.version !== 1 || clientFixesManifest?.revision !== 'client-fixes-20260912-r1') throw new Error('Client fixes frontend manifest invalid')\nconst clientFixesExpectedFiles = ['src/App.tsx','src/app/types.ts','src/app/utils.ts','src/features/renderers/FinanceReportContentRenderer.tsx','src/features/sections/DashboardSection.tsx','src/features/sections/OrderExchangeSection.tsx']\nif (JSON.stringify(Object.keys(clientFixesManifest.files || {})) !== JSON.stringify(clientFixesExpectedFiles)) throw new Error('Client fixes frontend allow-list widened unexpectedly')\n",
  '1906B client manifest validation',
)
frontendGate = replaceOnce(
  frontendGate,
  "  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) throw new Error(businessDateBoundaryDelta ? 'Business date boundary frontend file changed beyond exact manifest: ' + file : stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)\n",
  "  const clientFixesDelta = clientFixesManifest.files?.[file]\n  if (clientFixesDelta) {\n    if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)\n    acceptedGitBlob = clientFixesDelta.afterGitBlob\n    acceptedLines = clientFixesDelta.afterLines\n  }\n  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) throw new Error(clientFixesDelta ? 'Client fixes frontend file changed beyond exact manifest: ' + file : businessDateBoundaryDelta ? 'Business date boundary frontend file changed beyond exact manifest: ' + file : stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)\n",
  '1906B utility/client chain',
)
frontendGate = replaceOnce(
  frontendGate,
  "if (gitBlobSha(stabilizationDashboardActual) !== businessDateBoundaryDashboardDelta.afterGitBlob || stabilizationDashboardActual.split(/\\r?\\n/).length !== businessDateBoundaryDashboardDelta.afterLines) throw new Error('Business date boundary Dashboard frontend changed beyond exact manifest')\n",
  "const clientFixesDashboardDelta = clientFixesManifest.files[stabilizationDashboardFile]\nif (!clientFixesDashboardDelta || clientFixesDashboardDelta.beforeGitBlob !== businessDateBoundaryDashboardDelta.afterGitBlob || clientFixesDashboardDelta.beforeLines !== businessDateBoundaryDashboardDelta.afterLines) throw new Error('Client fixes Dashboard predecessor drifted')\nif (gitBlobSha(stabilizationDashboardActual) !== clientFixesDashboardDelta.afterGitBlob || stabilizationDashboardActual.split(/\\r?\\n/).length !== clientFixesDashboardDelta.afterLines) throw new Error('Client fixes Dashboard frontend changed beyond exact manifest')\nconst clientFixesRendererFile = 'src/features/renderers/FinanceReportContentRenderer.tsx'\nconst clientFixesRendererDelta = clientFixesManifest.files[clientFixesRendererFile]\nconst clientFixesRendererActual = fs.readFileSync(path.join(root, clientFixesRendererFile), 'utf8')\nif (!clientFixesRendererDelta || gitBlobSha(clientFixesRendererActual) !== clientFixesRendererDelta.afterGitBlob || clientFixesRendererActual.split(/\\r?\\n/).length !== clientFixesRendererDelta.afterLines) throw new Error('Client fixes Finance renderer changed beyond exact manifest')\n",
  '1906B dashboard/renderer exact client layer',
)
frontendGate = replaceOnce(
  frontendGate,
  "    const businessDateBoundaryDelta = businessDateBoundaryManifest.files?.[file]\n",
  "    const businessDateBoundaryDelta = businessDateBoundaryManifest.files?.[file]\n    const clientFixesDelta = clientFixesManifest.files?.[file]\n",
  '1906B expected-files client delta',
)
frontendGate = replaceOnce(
  frontendGate,
  "    if (businessDateBoundaryDelta) {\n      if (businessDateBoundaryDelta.beforeGitBlob !== acceptedGitBlob || businessDateBoundaryDelta.beforeLines !== acceptedLines) throw new Error('Business date boundary frontend predecessor drifted: ' + file)\n      acceptedGitBlob = businessDateBoundaryDelta.afterGitBlob\n      acceptedLines = businessDateBoundaryDelta.afterLines\n    }\n    if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) {\n      throw new Error(businessDateBoundaryDelta\n",
  "    if (businessDateBoundaryDelta) {\n      if (businessDateBoundaryDelta.beforeGitBlob !== acceptedGitBlob || businessDateBoundaryDelta.beforeLines !== acceptedLines) throw new Error('Business date boundary frontend predecessor drifted: ' + file)\n      acceptedGitBlob = businessDateBoundaryDelta.afterGitBlob\n      acceptedLines = businessDateBoundaryDelta.afterLines\n    }\n    if (clientFixesDelta) {\n      if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)\n      acceptedGitBlob = clientFixesDelta.afterGitBlob\n      acceptedLines = clientFixesDelta.afterLines\n    }\n    if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) {\n      throw new Error(clientFixesDelta\n        ? 'Client fixes frontend file changed beyond exact manifest: ' + file\n        : businessDateBoundaryDelta\n",
  '1906B expected-files final client chain',
)
write('scripts/test-step1906b-frontend-modularization.mjs', frontendGate)
