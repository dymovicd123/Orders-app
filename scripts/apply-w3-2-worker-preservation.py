from pathlib import Path

path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'1906A preservation: expected 1 match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)

replace_once(
    "const financeF9DatePriorityPath = path.join(root, 'scripts/finance-f9-date-priority-worker-manifest.json')",
    "const financeF9DatePriorityPath = path.join(root, 'scripts/finance-f9-date-priority-worker-manifest.json')\nconst w3NaturalRecoveryWorkerPath = path.join(root, 'scripts/w3-2-natural-recovery-worker-manifest.json')",
)

replace_once(
    "  const financeF9DatePriorityChanges = financeF9DatePriority?.version === 1 ? (financeF9DatePriority.changes || {}) : {}\n",
    "  const financeF9DatePriorityChanges = financeF9DatePriority?.version === 1 ? (financeF9DatePriority.changes || {}) : {}\n  const w3NaturalRecoveryWorker = fs.existsSync(w3NaturalRecoveryWorkerPath) ? JSON.parse(fs.readFileSync(w3NaturalRecoveryWorkerPath, 'utf8')) : null\n  if (w3NaturalRecoveryWorker) check(w3NaturalRecoveryWorker.version === 1 && w3NaturalRecoveryWorker.revision === 'w3-2-natural-recovery', 'W3.2 natural recovery Worker manifest invalid')\n  const w3NaturalRecoveryWorkerChanges = w3NaturalRecoveryWorker?.changes || {}\n",
)

old = '''    const d1ReadBudgetR510Changed = d1ReadBudgetR510Changes[name]
    if (d1ReadBudgetR510Changed) {
      check(d1ReadBudgetR510Changed.before === acceptedPostD1ReadBudgetR59Hash, `D1 read-budget R5.10 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR510Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.10 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR59Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)
    }'''
new = '''    const d1ReadBudgetR510Changed = d1ReadBudgetR510Changes[name]
    let acceptedPostD1ReadBudgetR510Hash = acceptedPostD1ReadBudgetR59Hash
    if (d1ReadBudgetR510Changed) {
      check(d1ReadBudgetR510Changed.before === acceptedPostD1ReadBudgetR59Hash, `D1 read-budget R5.10 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR510Hash = d1ReadBudgetR510Changed.after
    }
    const w3NaturalRecoveryWorkerChanged = w3NaturalRecoveryWorkerChanges[name]
    let acceptedPostW3NaturalRecoveryHash = acceptedPostD1ReadBudgetR510Hash
    if (w3NaturalRecoveryWorkerChanged) {
      check(w3NaturalRecoveryWorkerChanged.before === acceptedPostD1ReadBudgetR510Hash, `W3.2 natural recovery Worker baseline hash mismatch: ${name}`)
      acceptedPostW3NaturalRecoveryHash = w3NaturalRecoveryWorkerChanged.after
    }
    check(
      sha(declarations.get(name)) === acceptedPostW3NaturalRecoveryHash,
      w3NaturalRecoveryWorkerChanged
        ? `Worker declaration changed beyond exact W3.2 natural recovery allow-list: ${name}`
        : `Worker declaration body changed beyond accepted cumulative deltas: ${name}`,
    )'''
replace_once(old, new)

path.write_text(text, encoding='utf-8')
print('W3.2 Worker preservation chain patched')
