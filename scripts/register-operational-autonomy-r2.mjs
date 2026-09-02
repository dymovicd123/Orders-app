import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const mode = process.argv[2]
const statePath = path.join(root, 'scripts/.operational-autonomy-r2-baseline.json')
const manifestPath = path.join(root, 'scripts/operational-autonomy-r2-frontend-manifest.json')
const panelRelative = 'src/features/inventory/views/renderInventoryAttentionPanel.tsx'
const panelFunctionName = 'renderInventoryAttentionPanel'
const operationalRelative = 'src/app/controllers/useOperationalViewModel.ts'
const operationalFunctionName = 'useOperationalViewModel'

const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function findFunction(relative, functionName, kind = ts.ScriptKind.TS) {
  const file = path.join(root, relative)
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  let found = null
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) found = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!found?.body) throw new Error(`${functionName} not found`)
  return { source, found }
}

function panelHash() {
  const { source, found } = findFunction(panelRelative, panelFunctionName, ts.ScriptKind.TSX)
  const ret = [...found.body.statements].find((statement) => ts.isReturnStatement(statement))
  if (!ret?.expression) throw new Error(`${panelFunctionName} return expression not found`)
  let expression = ret.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return sha(normalize(expression.getText(source)))
}

function operationalPanelStatement() {
  const { source, found } = findFunction(operationalRelative, operationalFunctionName)
  const statements = [...found.body.statements]
  const index = statements.findIndex((statement) => {
    if (!ts.isVariableStatement(statement)) return false
    return statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'inventoryManagerPanels')
  })
  if (index < 0) throw new Error('inventoryManagerPanels statement not found')
  return { index, hash: sha(normalize(statements[index].getText(source))) }
}

if (mode === 'before') {
  fs.writeFileSync(statePath, JSON.stringify({ panelBefore: panelHash(), operationalBefore: operationalPanelStatement() }, null, 2) + '\n')
  console.log('Operational autonomy R2 frontend baselines captured')
} else if (mode === 'after') {
  if (!fs.existsSync(statePath)) throw new Error('Operational autonomy R2 baseline missing')
  const baseline = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  const panelAfter = panelHash()
  const operationalAfter = operationalPanelStatement()
  if (!baseline.panelBefore || baseline.panelBefore === panelAfter) throw new Error('Expected Attention panel return-expression delta')
  if (!baseline.operationalBefore?.hash || baseline.operationalBefore.hash === operationalAfter.hash) throw new Error('Expected inventoryManagerPanels statement delta')
  if (baseline.operationalBefore.index !== operationalAfter.index) throw new Error('inventoryManagerPanels statement index moved unexpectedly')
  const manifest = {
    version: 1,
    revision: 'operational-autonomy-r2',
    frontend: {
      panelReturnChanges: {
        [panelFunctionName]: { before: baseline.panelBefore, after: panelAfter },
      },
      operationalStatementChanges: [
        { index: operationalAfter.index, before: baseline.operationalBefore.hash, after: operationalAfter.hash },
      ],
    },
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('Operational autonomy R2 frontend manifest registered')
} else {
  throw new Error('Usage: node scripts/register-operational-autonomy-r2.mjs before|after')
}
