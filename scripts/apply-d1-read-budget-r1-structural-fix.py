from pathlib import Path

structural_path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = structural_path.read_text(encoding='utf-8')
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
structural_path.write_text(text.replace(old, new, 1), encoding='utf-8')

attention_test = Path('scripts/test-step192b1-warehouse-truth-attention.mjs')
attention = attention_test.read_text(encoding='utf-8')
old_check = "  check(handoverRows.includes('options: { allActive?: boolean }') && handoverRows.includes(\"r.status = 'active'\"), 'Attention handover count must reuse canonical resolver without a separate capped SQL implementation')\n"
new_check = "  check(handoverRows.includes('options: { allActive?: boolean; listFlagsOnly?: boolean }') && handoverRows.includes(\"r.status = 'active'\"), 'Attention handover count must reuse canonical resolver while list mode stays compact')\n"
if attention.count(old_check) != 1:
    raise SystemExit(f'expected one canonical resolver signature assertion, got {attention.count(old_check)}')
attention_test.write_text(attention.replace(old_check, new_check, 1), encoding='utf-8')

print('D1 read-budget structural and canonical-resolver preservation checks patched')
