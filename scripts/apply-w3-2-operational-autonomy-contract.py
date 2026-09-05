from pathlib import Path

path = Path('scripts/test-operational-autonomy-r2.mjs')
text = path.read_text(encoding='utf-8')

old = '''check(attention.includes('<button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>Продолжить проверку</button>'), 'unfinished stocktake must be resumable in working mode')
check(!attention.includes('{isAdmin ? <button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>'), 'stocktake attention action still admin-gated')'''
new = '''check(!attention.includes('openAttentionStocktake(item)'), 'routine stocktake leaked back into secondary clarification')
check(!attention.includes('Продолжить проверку'), 'unfinished stocktake must stay in the normal Проверка workflow, not clarification')'''

if text.count(old) != 1:
    raise SystemExit(f'operational autonomy W3.2 contract: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Operational autonomy contract updated for W3.2 natural recovery')

refresh_path = Path('scripts/test-w2-attention-refresh-r1.mjs')
refresh = refresh_path.read_text(encoding='utf-8')
old_refresh = "  check(intake.includes('result?.warehouseAttention || await loadWarehouseAttention(true)'), 'Intake still unconditionally performs a second detailed Attention read')"
new_refresh = "  check(intake.includes('else if (!result?.warehouseAttention) await loadWarehouseAttention(true)'), 'Intake still performs a second detailed Attention read when reconciliation already returned refreshed data')"
if refresh.count(old_refresh) != 1:
    raise SystemExit(f'W2 Attention refresh W3.2 contract: expected 1 match, found {refresh.count(old_refresh)}')
refresh_path.write_text(refresh.replace(old_refresh, new_refresh, 1), encoding='utf-8')
print('W2 Attention refresh contract updated for W3.2 returned-payload reuse')
