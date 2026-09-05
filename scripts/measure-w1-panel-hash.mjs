import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const relative = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
const text = fs.readFileSync(relative, 'utf8')
const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
let fn = null
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'renderInventoryCatalogPanel') fn = node
  ts.forEachChild(node, visit)
}
source.forEachChild(visit)
if (!fn?.body) throw new Error('renderInventoryCatalogPanel not found')
const ret = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
if (!ret?.expression) throw new Error('return expression missing')
let expression = ret.expression
while (ts.isParenthesizedExpression(expression)) expression = expression.expression
console.log(`W1_CATALOG_PANEL_HASH=${sha(normalize(expression.getText(source)))}`)
