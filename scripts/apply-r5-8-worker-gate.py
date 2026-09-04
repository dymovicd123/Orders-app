from pathlib import Path

path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = path.read_text()

old = "const d1ReadBudgetR57Path = path.join(root, 'scripts/d1-read-budget-r5-7-worker-manifest.json')\n"
new = old + "const d1ReadBudgetR58Path = path.join(root, 'scripts/d1-read-budget-r5-8-worker-manifest.json')\n"
if text.count(old) != 1:
    raise SystemExit(f'R57 path anchor count={text.count(old)}')
text = text.replace(old, new, 1)

old = """  const d1ReadBudgetR57 = JSON.parse(fs.readFileSync(d1ReadBudgetR57Path, 'utf8'))
  check(d1ReadBudgetR57?.version === 1 && d1ReadBudgetR57?.revision === 'd1-read-budget-r5-7', 'D1 read-budget R5.7 Worker manifest invalid')
  const d1ReadBudgetR57Changes = d1ReadBudgetR57.changes || {}
"""
new = old + """  check(fs.existsSync(d1ReadBudgetR58Path), 'D1 read-budget R5.8 Worker manifest missing')
  const d1ReadBudgetR58 = JSON.parse(fs.readFileSync(d1ReadBudgetR58Path, 'utf8'))
  check(d1ReadBudgetR58?.version === 1 && d1ReadBudgetR58?.revision === 'd1-read-budget-r5-8', 'D1 read-budget R5.8 Worker manifest invalid')
  const d1ReadBudgetR58Changes = d1ReadBudgetR58.changes || {}
"""
if text.count(old) != 1:
    raise SystemExit(f'R57 parse anchor count={text.count(old)}')
text = text.replace(old, new, 1)

old = """    const d1ReadBudgetR57Changed = d1ReadBudgetR57Changes[name]
    if (d1ReadBudgetR57Changed) {
      check(d1ReadBudgetR57Changed.before === acceptedPostD1ReadBudgetR56Hash, `D1 read-budget R5.7 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR57Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.7 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR56Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)
    }
"""
new = """    const d1ReadBudgetR57Changed = d1ReadBudgetR57Changes[name]
    let acceptedPostD1ReadBudgetR57Hash = acceptedPostD1ReadBudgetR56Hash
    if (d1ReadBudgetR57Changed) {
      check(d1ReadBudgetR57Changed.before === acceptedPostD1ReadBudgetR56Hash, `D1 read-budget R5.7 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR57Hash = d1ReadBudgetR57Changed.after
    }
    const d1ReadBudgetR58Changed = d1ReadBudgetR58Changes[name]
    if (d1ReadBudgetR58Changed) {
      check(d1ReadBudgetR58Changed.before === acceptedPostD1ReadBudgetR57Hash, `D1 read-budget R5.8 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR58Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.8 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR57Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)
    }
"""
if text.count(old) != 1:
    raise SystemExit(f'R57 final gate anchor count={text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text)
