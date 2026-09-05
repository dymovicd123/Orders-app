from pathlib import Path

path = Path('scripts/test-w2-attention-refresh-r1.mjs')
text = path.read_text(encoding='utf-8')
old = "  check(intake.includes('result?.warehouseAttention || await loadWarehouseAttention(true)'), 'Intake still unconditionally performs a second detailed Attention read')"
new = "  check(intake.includes('else if (!result?.warehouseAttention) await loadWarehouseAttention(true)'), 'Intake still performs a second detailed Attention read when reconciliation already returned refreshed data')"
if text.count(old) != 1:
    raise SystemExit(f'W2 Attention refresh W3.2 contract: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('W2 Attention refresh contract updated for W3.2 returned-payload reuse')
