from pathlib import Path

p = Path('scripts/test-step1906a-worker-modularization.mjs')
text = p.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    "const d1ReadBudgetR59Path = path.join(root, 'scripts/d1-read-budget-r5-9-worker-manifest.json')\n",
    "const d1ReadBudgetR59Path = path.join(root, 'scripts/d1-read-budget-r5-9-worker-manifest.json')\nconst d1ReadBudgetR510Path = path.join(root, 'scripts/d1-read-budget-r5-10-worker-manifest.json')\n",
    'R5.10 manifest path',
)

replace_once(
    "  const d1ReadBudgetR59Changes = d1ReadBudgetR59.changes || {}\n",
    "  const d1ReadBudgetR59Changes = d1ReadBudgetR59.changes || {}\n  check(fs.existsSync(d1ReadBudgetR510Path), 'D1 read-budget R5.10 Worker manifest missing')\n  const d1ReadBudgetR510 = JSON.parse(fs.readFileSync(d1ReadBudgetR510Path, 'utf8'))\n  check(d1ReadBudgetR510?.version === 1 && d1ReadBudgetR510?.revision === 'd1-read-budget-r5-10', 'D1 read-budget R5.10 Worker manifest invalid')\n  const d1ReadBudgetR510Changes = d1ReadBudgetR510.changes || {}\n",
    'R5.10 manifest load',
)

old = """    const d1ReadBudgetR59Changed = d1ReadBudgetR59Changes[name]\n    if (d1ReadBudgetR59Changed) {\n      check(d1ReadBudgetR59Changed.before === acceptedPostD1ReadBudgetR58Hash, `D1 read-budget R5.9 baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === d1ReadBudgetR59Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.9 allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR58Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)\n    }\n"""
new = """    const d1ReadBudgetR59Changed = d1ReadBudgetR59Changes[name]\n    let acceptedPostD1ReadBudgetR59Hash = acceptedPostD1ReadBudgetR58Hash\n    if (d1ReadBudgetR59Changed) {\n      check(d1ReadBudgetR59Changed.before === acceptedPostD1ReadBudgetR58Hash, `D1 read-budget R5.9 baseline hash mismatch: ${name}`)\n      acceptedPostD1ReadBudgetR59Hash = d1ReadBudgetR59Changed.after\n    }\n    const d1ReadBudgetR510Changed = d1ReadBudgetR510Changes[name]\n    if (d1ReadBudgetR510Changed) {\n      check(d1ReadBudgetR510Changed.before === acceptedPostD1ReadBudgetR59Hash, `D1 read-budget R5.10 baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === d1ReadBudgetR510Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.10 allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR59Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)\n    }\n"""
replace_once(old, new, 'R5.9/R5.10 cumulative declaration check')

p.write_text(text, encoding='utf-8')
