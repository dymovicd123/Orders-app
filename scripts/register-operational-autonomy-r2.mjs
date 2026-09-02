import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const mode = process.argv[2]
const statePath = path.join(root, 'scripts/.operational-autonomy-r2-baseline.json')
const manifestPath = path.join(root, 'scripts/operational-autonomy-r2-frontend-manifest.json')
const relative = 'src/features/inventory/views/renderInventoryAttentionPanel.tsx'
const functionName = 'renderInventoryAttentionPanel'

const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function panelHash() {
  const file = path.join(root, relative)
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = null
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) found = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!found?.body) throw new Error(`${functionName} not found`)
  const ret = [...found.body.statements].find((statement) => ts.isReturnStatement(statement))
  if (!ret?.expression) throw new Error(`${functionName} return expression not found`)
  let expression = ret.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return sha(normalize(expression.getText(source)))
}

if (mode === 'before') {
  fs.writeFileSync(statePath, JSON.stringify({ before: panelHash() }, null, 2) + '\n')
  console.log('Operational autonomy R2 frontend baseline captured')
} else if (mode === 'after') {
  if (!fs.existsSync(statePath)) throw new Error('Operational autonomy R2 baseline missing')
  const { before } = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  const after = panelHash()
  if (!before || before === after) throw new Error('Expected Attention panel return-expression delta')
  const manifest = {
    version: 1,
    revision: 'operational-autonomy-r2',
    frontend: {
      panelReturnChanges: {
        [functionName]: { before, after },
      },
    },
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('Operational autonomy R2 frontend manifest registered')
} else {
  throw new Error('Usage: node scripts/register-operational-autonomy-r2.mjs before|after')
}
