from pathlib import Path

path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = path.read_text(encoding='utf-8')
old = """    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192B1-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostHandoverSqlAliasHash, `192B1 added Worker declaration changed: ${name}`)
    }
"""
new = """    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    let acceptedPostOrderCreateHash = acceptedPostHandoverSqlAliasHash
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostOrderCreateHash = orderCreateSaveIntegrityChanged.after
    }
    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostOrderCreateHash, `D1 read-budget R1 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetChanged.after, `192B1-added declaration changed beyond exact D1 read-budget R1 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostOrderCreateHash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
"""
if text.count(old) != 1:
    raise SystemExit(f'expected one 192B1-added structural block, got {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('D1 read-budget structural added-declaration chain patched')
