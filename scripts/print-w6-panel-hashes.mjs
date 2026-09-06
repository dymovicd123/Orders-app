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

function rendererHash(path, name) {
  const text = fs.readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let fn = null
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!fn?.body) throw new Error(`${name} not found in ${path}`)
  const returned = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
  if (!returned?.expression) throw new Error(`return not found in ${path}`)
  let expression = returned.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return sha(normalize(expression.getText(source)))
}

console.log(`W6_LEGACY_CATALOG_HASH=${rendererHash('src/features/inventory/views/renderInventoryCatalogPanelLegacy.tsx', 'renderInventoryCatalogPanel')}`)
console.log(`W6_NEW_CATALOG_HASH=${rendererHash('src/features/inventory/views/renderInventoryCatalogPanel.tsx', 'renderInventoryCatalogPanel')}`)
