import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (value) => value.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean).join('\n').replace(/^export\s+/, '')

function declarationHash(file, name, kind = ts.ScriptKind.TS) {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const statement = source.statements.find((row) => ts.isFunctionDeclaration(row) && row.name?.text === name)
  if (!statement) throw new Error(`Declaration missing: ${name}`)
  return sha(statement.getText(source).replace(/^export\s+/, ''))
}

function normalizedRouterHash() {
  const file = 'worker/index.ts'
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const assignment = source.statements.find((row) => ts.isExportAssignment(row))
  if (!assignment) throw new Error('Worker export assignment missing')
  const normalized = assignment.getText(source)
    .replace(/\n\s*orderCreateSaveIntegrity:\s*'192b2a4',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionContextFix:\s*'192b2a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseDailyAttentionUx:\s*'192b2a',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionTruthGates:\s*'192b1',\s*\n/, '\n')
    .replace(/\n\s*catalogTruthFinalizer:\s*'192a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseTruthFreshness:\s*'192a1',\s*\n/, '\n')
    .replace(/\n\s*adminSessionIntegrity:\s*'191f',\s*\n/, '\n')
    .replace(/\n\s*runtimeLimitsAtomicity:\s*'191e',\s*\n/, '\n')
    .replace(/\n\s*transferRuntimeSafety:\s*'191d',\s*\n/, '\n')
    .replace(/\n\s*typeApiBoundaryCleanup:\s*'1906e',\s*\n/, '\n')
    .replace(/\n\s*bundleLazyLoading:\s*'1906d',\s*\n/, '\n')
    .replace(/\n\s*deadLegacyCleanup:\s*'1906c',\s*\n/, '\n')
    .replace(/\n\s*frontendControllerModularization:\s*'1906b',\s*\n/, '\n')
    .replace(/\n\s*structuralModularization:\s*'1906a',\s*\n/, '\n')
  return sha(normalized)
}

function panelReturnHash() {
  const file = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = source.statements.find((row) => ts.isFunctionDeclaration(row) && row.name?.text === 'renderInventoryOverviewPanel')
  if (!fn?.body) throw new Error('Overview renderer missing')
  const ret = fn.body.statements.find((row) => ts.isReturnStatement(row))
  if (!ret?.expression) throw new Error('Overview return missing')
  let expression = ret.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return sha(normalize(expression.getText(source)))
}

const baseline = {
  declaration: declarationHash('worker/domains/inventory-stocktake.ts', 'listInventoryCycleCountSuggestions'),
  router: normalizedRouterHash(),
  overview: panelReturnHash(),
}
fs.writeFileSync('/tmp/phase2-smart-daily-stock-baseline.json', JSON.stringify(baseline, null, 2))
console.log('Captured Phase 2 baseline', baseline)
