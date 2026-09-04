import fs from 'node:fs'

const path = 'scripts/test-step1906a-worker-modularization.mjs'
let text = fs.readFileSync(path, 'utf8')

function once(oldText, newText, label) {
  const parts = text.split(oldText)
  if (parts.length !== 2) throw new Error(`${label}: expected one anchor, found ${parts.length - 1}`)
  text = parts[0] + newText + parts[1]
}

once(
  "const d1ReadBudgetR58Path = path.join(root, 'scripts/d1-read-budget-r5-8-worker-manifest.json')\nconst runtimeSqlSyntaxR1Path",
  "const d1ReadBudgetR58Path = path.join(root, 'scripts/d1-read-budget-r5-8-worker-manifest.json')\nconst d1ReadBudgetR59Path = path.join(root, 'scripts/d1-read-budget-r5-9-worker-manifest.json')\nconst runtimeSqlSyntaxR1Path",
  'path',
)

once(
  "  const d1ReadBudgetR58Changes = d1ReadBudgetR58.changes || {}\n  check(fs.existsSync(runtimeSqlSyntaxR1Path)",
  "  const d1ReadBudgetR58Changes = d1ReadBudgetR58.changes || {}\n  check(fs.existsSync(d1ReadBudgetR59Path), 'D1 read-budget R5.9 Worker manifest missing')\n  const d1ReadBudgetR59 = JSON.parse(fs.readFileSync(d1ReadBudgetR59Path, 'utf8'))\n  check(d1ReadBudgetR59?.version === 1 && d1ReadBudgetR59?.revision === 'd1-read-budget-r5-9', 'D1 read-budget R5.9 Worker manifest invalid')\n  const d1ReadBudgetR59Changes = d1ReadBudgetR59.changes || {}\n  check(fs.existsSync(runtimeSqlSyntaxR1Path)",
  'parse',
)

once(
`    const d1ReadBudgetR58Changed = d1ReadBudgetR58Changes[name]
    if (d1ReadBudgetR58Changed) {
      check(d1ReadBudgetR58Changed.before === acceptedPostD1ReadBudgetR57Hash, \`D1 read-budget R5.8 baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === d1ReadBudgetR58Changed.after, \`Worker declaration changed beyond exact D1 read-budget R5.8 allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR57Hash, \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`)
    }
`,
`    const d1ReadBudgetR58Changed = d1ReadBudgetR58Changes[name]
    let acceptedPostD1ReadBudgetR58Hash = acceptedPostD1ReadBudgetR57Hash
    if (d1ReadBudgetR58Changed) {
      check(d1ReadBudgetR58Changed.before === acceptedPostD1ReadBudgetR57Hash, \`D1 read-budget R5.8 baseline hash mismatch: \${name}\`)
      acceptedPostD1ReadBudgetR58Hash = d1ReadBudgetR58Changed.after
    }
    const d1ReadBudgetR59Changed = d1ReadBudgetR59Changes[name]
    if (d1ReadBudgetR59Changed) {
      check(d1ReadBudgetR59Changed.before === acceptedPostD1ReadBudgetR58Hash, \`D1 read-budget R5.9 baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === d1ReadBudgetR59Changed.after, \`Worker declaration changed beyond exact D1 read-budget R5.9 allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR58Hash, \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`)
    }
`,
  'final chain',
)

fs.writeFileSync(path, text)
console.log('R5.9 Worker gate registration patched')
