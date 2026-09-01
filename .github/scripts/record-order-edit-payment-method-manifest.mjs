import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const declaration = (sourceText, name) => {
  const source = ts.createSourceFile('orders-write.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.getText(source).replace(/^export\s+/, '')
    }
  }
  throw new Error(`declaration not found: ${name}`)
}

const beforeText = execFileSync('git', ['show', 'HEAD:worker/domains/orders-write.ts'], { encoding: 'utf8' })
const afterText = fs.readFileSync('worker/domains/orders-write.ts', 'utf8')
const manifest = {
  version: 1,
  revision: 'order-edit-payment-method-r1',
  changes: {
    updateOrderCritical: {
      before: digest(declaration(beforeText, 'updateOrderCritical')),
      after: digest(declaration(afterText, 'updateOrderCritical')),
    },
  },
}
fs.writeFileSync('scripts/order-edit-payment-method-worker-manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(manifest)
