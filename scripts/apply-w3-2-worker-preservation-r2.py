from pathlib import Path

path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = path.read_text(encoding='utf-8')

old = '''    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostAttentionContextHash, `192B2A4 changed 192A1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192A1-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostAttentionContextHash, `192A1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(warehouseAttentionTruthAdded)) {'''

new = '''    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
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

  for (const [name, expectedHash] of Object.entries(warehouseAttentionTruthAdded)) {'''

count = text.count(old)
if count != 1:
    raise SystemExit(f'1906A 192A1-added preservation: expected 1 match, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('W3.2 192A1-added Worker preservation chain patched')
