import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const mode = process.argv[2]
if (!['before', 'after'].includes(mode)) throw new Error('Use before or after')
const relative = 'src/features/inventory/views/renderInventoryStocktakePanel.tsx'
const text = fs.readFileSync(relative, 'utf8')
const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let fn = null
const visit = (node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'renderInventoryStocktakePanel') fn = node
  ts.forEachChild(node, visit)
}
source.forEachChild(visit)
if (!fn?.body) throw new Error('renderInventoryStocktakePanel not found')
const ret = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
if (!ret?.expression) throw new Error('stocktake return missing')
let expression = ret.expression
while (ts.isParenthesizedExpression(expression)) expression = expression.expression
const normalize = (value) => value.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean).join('\n').replace(/^export\s+/, '')
const hash = crypto.createHash('sha256').update(normalize(expression.getText(source))).digest('hex')

if (mode === 'before') {
  const w53r = JSON.parse(fs.readFileSync('scripts/w5-3r-unified-check-frontend-manifest.json', 'utf8'))
  const expected = w53r.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.after
  if (hash !== expected) throw new Error(`W5.4 baseline mismatch: ${hash} != ${expected}`)
  fs.writeFileSync('/tmp/w5-4-stocktake-before', hash)
  console.log(`W5.4 baseline: ${hash}`)
} else {
  const before = fs.readFileSync('/tmp/w5-4-stocktake-before', 'utf8').trim()
  fs.writeFileSync('scripts/w5-4-full-stocktake-frontend-manifest.json', JSON.stringify({
    version: 1,
    revision: 'w5-4-full-stocktake',
    frontend: { panelReturnChanges: { renderInventoryStocktakePanel: { before, after: hash } } },
  }, null, 2) + '\n')
  console.log(`W5.4 preservation: ${before} -> ${hash}`)
}
