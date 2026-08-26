import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const file = 'worker/domains/returns-exchanges.ts'
const sourceText = fs.readFileSync(file, 'utf8')
const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const wanted = new Set(['createReturn', 'createExchange'])
const hashes = {}

for (const statement of source.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name && wanted.has(statement.name.text)) {
    hashes[statement.name.text] = sha(statement.getText(source).replace(/^export\s+/, ''))
  }
}
for (const name of wanted) {
  if (!hashes[name]) throw new Error(`Declaration not found for manifest refresh: ${name}`)
}

// createReturn/createExchange were changed after 192B2A4 by Finance F2.
// Phase 1B is applied to the current branch2 source, so its declaration baseline
// must be the last accepted pre-Phase1B hash in the cumulative chain.
const baselinePath = 'scripts/finance-f2-trace-worker-manifest.json'
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const changes = {}
for (const name of wanted) {
  const before = baseline?.changes?.[name]?.after
  if (!before) throw new Error(`Finance F2 baseline hash missing for ${name}`)
  changes[name] = { before, after: hashes[name] }
}

const manifest = {
  version: 1,
  revision: 'phase1b-workshop-return-disposition-r1',
  changes,
}
const manifestPath = 'scripts/phase1b-workshop-return-disposition-worker-manifest.json'
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('Created Phase 1B declaration manifest:', manifest)
