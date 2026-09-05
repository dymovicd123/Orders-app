import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const normalize = (value) => value.replace(/^export\s+/, '').replace(/\r\n/g, '\n')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function functionText(path, name) {
  const text = fs.readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let found = null
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!found) throw new Error(`Missing function ${name} in ${path}`)
  return normalize(found.getText(source))
}

function routerText() {
  const path = 'worker/index.ts'
  const text = fs.readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const node = source.statements.find((statement) => ts.isExportAssignment(statement))
  if (!node) throw new Error('Worker router export missing')
  return node.getText(source)
}

function panelReturn(path, name) {
  const text = fs.readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = null
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!found?.body) throw new Error(`Missing renderer ${name}`)
  const ret = [...found.body.statements].find((statement) => ts.isReturnStatement(statement))
  if (!ret?.expression) throw new Error(`Missing return ${name}`)
  let expression = ret.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return expression.getText(source).replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean).join('\n').replace(/^export\s+/, '')
}

const mode = process.argv[2]
const snapshot = {
  worker: {
    addInventoryStocktakeCombination: sha(functionText('worker/domains/inventory-stocktake.ts', 'addInventoryStocktakeCombination')),
    completeInventoryStocktakeSession: sha(functionText('worker/domains/inventory-stocktake.ts', 'completeInventoryStocktakeSession')),
    cancelInventoryStocktakeSession: sha(functionText('worker/domains/inventory-stocktake.ts', 'cancelInventoryStocktakeSession')),
    getWarehouseAttentionSummary: sha(functionText('worker/domains/warehouse-attention.ts', 'getWarehouseAttentionSummary')),
    router: sha(routerText()),
  },
  frontend: {
    renderInventoryStocktakePanel: sha(panelReturn('src/features/inventory/views/renderInventoryStocktakePanel.tsx', 'renderInventoryStocktakePanel')),
    renderInventoryAttentionPanel: sha(panelReturn('src/features/inventory/views/renderInventoryAttentionPanel.tsx', 'renderInventoryAttentionPanel')),
  },
}

if (mode === 'before') {
  fs.writeFileSync('/tmp/w5-5-before.json', JSON.stringify(snapshot, null, 2))
  console.log(JSON.stringify(snapshot, null, 2))
} else if (mode === 'after') {
  const before = JSON.parse(fs.readFileSync('/tmp/w5-5-before.json', 'utf8'))
  const addedText = functionText('worker/domains/inventory-stocktake.ts', 'reconcileFoundInventoryStock')
  fs.writeFileSync('scripts/w5-5-found-items-worker-manifest.json', JSON.stringify({
    version: 1,
    revision: 'w5-5-found-items',
    changes: Object.fromEntries(Object.keys(before.worker).filter((name) => name !== 'router').map((name) => [name, { before: before.worker[name], after: snapshot.worker[name] }])),
    added: { reconcileFoundInventoryStock: sha(addedText) },
    router: { before: before.worker.router, after: snapshot.worker.router },
  }, null, 2) + '\n')
  fs.writeFileSync('scripts/w5-5-found-items-frontend-manifest.json', JSON.stringify({
    version: 1,
    revision: 'w5-5-found-items',
    frontend: { panelReturnChanges: {
      renderInventoryStocktakePanel: { before: before.frontend.renderInventoryStocktakePanel, after: snapshot.frontend.renderInventoryStocktakePanel },
      renderInventoryAttentionPanel: { before: before.frontend.renderInventoryAttentionPanel, after: snapshot.frontend.renderInventoryAttentionPanel },
    } },
  }, null, 2) + '\n')
  console.log(JSON.stringify(snapshot, null, 2))
} else {
  throw new Error('Use before|after')
}
