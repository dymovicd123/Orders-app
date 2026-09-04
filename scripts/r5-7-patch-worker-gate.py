from pathlib import Path

p = Path('scripts/test-step1906a-worker-modularization.mjs')
text = p.read_text(encoding='utf-8')

old = "const d1ReadBudgetR56Path = path.join(root, 'scripts/d1-read-budget-r5-6-worker-manifest.json')\nconst runtimeSqlSyntaxR1Path"
new = "const d1ReadBudgetR56Path = path.join(root, 'scripts/d1-read-budget-r5-6-worker-manifest.json')\nconst d1ReadBudgetR57Path = path.join(root, 'scripts/d1-read-budget-r5-7-worker-manifest.json')\nconst runtimeSqlSyntaxR1Path"
if text.count(old) != 1:
    raise SystemExit(f'R5.7 path anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """  check(fs.existsSync(d1ReadBudgetR56Path), 'D1 read-budget R5.6 Worker manifest missing')
  const d1ReadBudgetR56 = JSON.parse(fs.readFileSync(d1ReadBudgetR56Path, 'utf8'))
  check(d1ReadBudgetR56?.version === 1 && d1ReadBudgetR56?.revision === 'd1-read-budget-r5-6', 'D1 read-budget R5.6 Worker manifest invalid')
  const d1ReadBudgetR56Changes = d1ReadBudgetR56.changes || {}
  check(fs.existsSync(runtimeSqlSyntaxR1Path), 'Runtime SQL syntax R1 Worker manifest missing')"""
new = """  check(fs.existsSync(d1ReadBudgetR56Path), 'D1 read-budget R5.6 Worker manifest missing')
  const d1ReadBudgetR56 = JSON.parse(fs.readFileSync(d1ReadBudgetR56Path, 'utf8'))
  check(d1ReadBudgetR56?.version === 1 && d1ReadBudgetR56?.revision === 'd1-read-budget-r5-6', 'D1 read-budget R5.6 Worker manifest invalid')
  const d1ReadBudgetR56Changes = d1ReadBudgetR56.changes || {}
  check(fs.existsSync(d1ReadBudgetR57Path), 'D1 read-budget R5.7 Worker manifest missing')
  const d1ReadBudgetR57 = JSON.parse(fs.readFileSync(d1ReadBudgetR57Path, 'utf8'))
  check(d1ReadBudgetR57?.version === 1 && d1ReadBudgetR57?.revision === 'd1-read-budget-r5-7', 'D1 read-budget R5.7 Worker manifest invalid')
  const d1ReadBudgetR57Changes = d1ReadBudgetR57.changes || {}
  check(fs.existsSync(runtimeSqlSyntaxR1Path), 'Runtime SQL syntax R1 Worker manifest missing')"""
if text.count(old) != 1:
    raise SystemExit(f'R5.7 manifest load anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """    const d1ReadBudgetR56Changed = d1ReadBudgetR56Changes[name]
    if (d1ReadBudgetR56Changed) {
      check(d1ReadBudgetR56Changed.before === acceptedPostD1ReadBudgetR53Hash, `D1 read-budget R5.6 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR56Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.6 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR53Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)
    }"""
new = """    const d1ReadBudgetR56Changed = d1ReadBudgetR56Changes[name]
    let acceptedPostD1ReadBudgetR56Hash = acceptedPostD1ReadBudgetR53Hash
    if (d1ReadBudgetR56Changed) {
      check(d1ReadBudgetR56Changed.before === acceptedPostD1ReadBudgetR53Hash, `D1 read-budget R5.6 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR56Hash = d1ReadBudgetR56Changed.after
    }
    const d1ReadBudgetR57Changed = d1ReadBudgetR57Changes[name]
    if (d1ReadBudgetR57Changed) {
      check(d1ReadBudgetR57Changed.before === acceptedPostD1ReadBudgetR56Hash, `D1 read-budget R5.7 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR57Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.7 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR56Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)
    }"""
if text.count(old) != 1:
    raise SystemExit(f'R5.7 cumulative gate anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

p.write_text(text, encoding='utf-8')
print('R5.7 cumulative Worker gate patched.')
