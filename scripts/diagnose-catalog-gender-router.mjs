import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
function router(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find((node) => ts.isExportAssignment(node))
  if (!statement) throw new Error(`router export missing: ${fileName}`)
  return statement.getText(source)
}
const currentText = fs.readFileSync(path.join(root, 'worker/index.ts'), 'utf8')
const baseText = execFileSync('git', ['show', 'origin/main:worker/index.ts'], { cwd: root, encoding: 'utf8' })
const current = router(currentText, 'worker/index.ts')
const base = router(baseText, 'worker/index.ts@main')
console.log(JSON.stringify({ before: sha(base), after: sha(current), changed: base !== current }, null, 2))
