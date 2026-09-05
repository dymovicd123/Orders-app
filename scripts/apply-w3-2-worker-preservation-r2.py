from pathlib import Path

path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
'''    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostAttentionContextHash, `192B2A4 changed 192A1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192A1-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostAttentionContextHash, `192A1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(warehouseAttentionTruthAdded)) {''',
'''    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    let acceptedPostOrderCreateHash = acceptedPostAttentionContextHash
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostAttentionContextHash, `192B2A4 changed 192A1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostOrderCreateHash = orderCreateSaveIntegrityChanged.after
    }
    const w3NaturalRecoveryWorkerChanged = w3NaturalRecoveryWorkerChanges[name]
    let acceptedPostW3NaturalRecoveryHash = acceptedPostOrderCreateHash
    if (w3NaturalRecoveryWorkerChanged) {
      check(w3NaturalRecoveryWorkerChanged.before === acceptedPostOrderCreateHash, `W3.2 natural recovery changed 192A1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostW3NaturalRecoveryHash = w3NaturalRecoveryWorkerChanged.after
    }
    check(
      sha(declarations.get(name)) === acceptedPostW3NaturalRecoveryHash,
      w3NaturalRecoveryWorkerChanged
        ? `192A1-added declaration changed beyond exact W3.2 allow-list: ${name}`
        : `192A1 added Worker declaration changed beyond accepted deltas: ${name}`,
    )
  }

  for (const [name, expectedHash] of Object.entries(warehouseAttentionTruthAdded)) {''',
'1906A 192A1-added preservation',
)

replace_once(
'''    const runtimeSqlSyntaxR1Changed = runtimeSqlSyntaxR1Changes[name]
    if (runtimeSqlSyntaxR1Changed) {
      check(runtimeSqlSyntaxR1Changed.before === acceptedPostD1ReadBudgetR54Hash, `Runtime SQL syntax R1 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === runtimeSqlSyntaxR1Changed.after, `192B1-added declaration changed beyond exact Runtime SQL syntax R1 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR54Hash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(dailyWarehouseAdded)) {''',
'''    const runtimeSqlSyntaxR1Changed = runtimeSqlSyntaxR1Changes[name]
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

  for (const [name, expectedHash] of Object.entries(dailyWarehouseAdded)) {''',
'1906A 192B1-added preservation',
)

path.write_text(text, encoding='utf-8')
print('W3.2 added-declaration Worker preservation chains patched')
