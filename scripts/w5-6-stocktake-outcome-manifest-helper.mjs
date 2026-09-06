import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const relative = 'src/features/inventory/views/renderInventoryStocktakePanel.tsx'
const text = fs.readFileSync(relative, 'utf8')
const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let fn = null
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'renderInventoryStocktakePanel') fn = node
  ts.forEachChild(node, visit)
}
source.forEachChild(visit)
if (!fn?.body) throw new Error('renderInventoryStocktakePanel not found')
const ret = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
if (!ret?.expression) throw new Error('renderInventoryStocktakePanel return missing')
let expression = ret.expression
while (ts.isParenthesizedExpression(expression)) expression = expression.expression
const after = sha(normalize(expression.getText(source)))
const previous = JSON.parse(fs.readFileSync('scripts/w5-5-found-items-frontend-manifest.json', 'utf8'))
const before = previous?.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.after
if (!before) throw new Error('W5.5 stocktake panel hash missing')
fs.writeFileSync('scripts/w5-6-stocktake-outcome-frontend-manifest.json', JSON.stringify({
  version: 1,
  revision: 'w5-6-stocktake-outcome',
  frontend: { panelReturnChanges: { renderInventoryStocktakePanel: { before, after } } },
}, null, 2) + '\n')
console.log(JSON.stringify({ before, after }, null, 2))
