import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (text) => text.replace(/^export\s+/, '')

function declaration(file, name) {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return normalize(statement.getText(source))
  }
  throw new Error(`Declaration not found: ${name} in ${file}`)
}

const before = declaration('/tmp/d1-http-before.ts', 'publicApiError')
const after = declaration('worker/core/http.ts', 'publicApiError')
if (before === after) throw new Error('publicApiError did not change')

const manifest = {
  version: 1,
  revision: 'd1-capacity-autonomy-r1',
  changes: {
    publicApiError: { before: sha(before), after: sha(after) },
  },
}
fs.writeFileSync('scripts/d1-capacity-autonomy-worker-manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
