from pathlib import Path

path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = path.read_text(encoding='utf-8')

old = '''    const runtimeSqlSyntaxR1Changed = runtimeSqlSyntaxR1Changes[name]
    if (runtimeSqlSyntaxR1Changed) {
      check(runtimeSqlSyntaxR1Changed.before === acceptedPostD1ReadBudgetR54Hash, `Runtime SQL syntax R1 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === runtimeSqlSyntaxR1Changed.after, `192B1-added declaration changed beyond exact Runtime SQL syntax R1 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR54Hash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(dailyWarehouseAdded)) {'''

new = '''    const runtimeSqlSyntaxR1Changed = runtimeSqlSyntaxR1Changes[name]
    let acceptedPostRuntimeSqlSyntaxHash = acceptedPostD1ReadBudgetR54Hash
    if (runtimeSqlSyntaxR1Changed) {
      check(runtimeSqlSyntaxR1Changed.before === acceptedPostD1ReadBudgetR54Hash, `Runtime SQL syntax R1 baseline hash mismatch: ${name}`)
      acceptedPostRuntimeSqlSyntaxHash = runtimeSqlSyntaxR1Changed.after
    }
    const w3NaturalRecoveryWorkerChanged = w3NaturalRecoveryWorkerChanges[name]
    let acceptedPostW3NaturalRecoveryHash = acceptedPostRuntimeSqlSyntaxHash
    if (w3NaturalRecoveryWorkerChanged) {
      check(w3NaturalRecoveryWorkerChanged.before === acceptedPostRuntimeSqlSyntaxHash, `W3.2 natural recovery changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostW3NaturalRecoveryHash = w3NaturalRecoveryWorkerChanged.after
    }
    check(
      sha(declarations.get(name)) === acceptedPostW3NaturalRecoveryHash,
      w3NaturalRecoveryWorkerChanged
        ? `192B1-added declaration changed beyond exact W3.2 allow-list: ${name}`
        : `192B1 added Worker declaration changed beyond accepted deltas: ${name}`,
    )
  }

  for (const [name, expectedHash] of Object.entries(dailyWarehouseAdded)) {'''

count = text.count(old)
if count != 1:
    raise SystemExit(f'1906A 192B1-added preservation: expected 1 match, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('W3.2 192B1-added Worker preservation chain patched')
