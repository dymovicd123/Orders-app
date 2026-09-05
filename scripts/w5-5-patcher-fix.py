from pathlib import Path
p = Path('scripts/w5-5-patcher.py')
s = p.read_text(encoding='utf-8')

old = '''needle = "return {\\n      ok: true,\\n      changed,\\n"
count = s.count(needle)
if count != 2:
    raise SystemExit(f'completion success return count: expected 2, got {count}')
s = s.replace(needle, "return {\\n      ok: true,\\n      changed,\\n      unresolvedFoundCount: await countUnresolvedFound(),\\n", 2)
'''
new = '''needle_replay = "return {\\n      ok: true,\\n      changed,\\n"
if s.count(needle_replay) != 1:
    raise SystemExit(f'completed replay return count: expected 1, got {s.count(needle_replay)}')
s = s.replace(needle_replay, "return {\\n      ok: true,\\n      changed,\\n      unresolvedFoundCount: await countUnresolvedFound(),\\n", 1)
needle_final = "  return {\\n    ok: true,\\n    changed,\\n"
if s.count(needle_final) != 1:
    raise SystemExit(f'final completion return count: expected 1, got {s.count(needle_final)}')
s = s.replace(needle_final, "  return {\\n    ok: true,\\n    changed,\\n    unresolvedFoundCount: await countUnresolvedFound(),\\n", 1)
'''
if old not in s:
    raise SystemExit('old completion patch block not found')
s = s.replace(old, new, 1)

old = '''s = one(s,\n"         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`\\n",\n"         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count,\\n         (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id IS NULL AND s.quantity > 0 AND s.last_source_ref LIKE 'stocktake-unresolved:%') AS found_count`\\n",\n'found summary count')\n'''
new = '''old_found_count_sql = "         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`\\n"\nnew_found_count_sql = "         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count,\\n         (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id IS NULL AND s.quantity > 0 AND s.last_source_ref LIKE 'stocktake-unresolved:%') AS found_count`\\n"\nif s.count(old_found_count_sql) < 1:\n    raise SystemExit('found summary stocktake_count SQL anchor missing')\ns = s.replace(old_found_count_sql, new_found_count_sql, 1)\n'''
if old not in s:
    raise SystemExit('old found summary SQL patch block not found')
s = s.replace(old, new, 1)

old = '''pattern = re.compile(r"(  async function addInventoryStocktakeCombination\\([\\s\\S]*?\\n  }\\n)(\\n\\n  async function loadInventoryCycleCounts)")'''
new = '''pattern = re.compile(r"(  async function addInventoryStocktakeCombination\\([\\s\\S]*?\\n  }\\n)(\\n  async function loadInventoryCycleCounts)")'''
if old not in s:
    raise SystemExit('old App insertion regex not found')
s = s.replace(old, new, 1)

old = """             AND last_source_ref LIKE ?
           ORDER BY id ASC LIMIT 1`
        ).bind(source, productId, gender || null, color || null, material, length, size || null, `stocktake-unresolved:${category}:%`).first<Record<string, unknown>>();"""
new = """             AND INSTR(last_source_ref, ?) = 1
           ORDER BY id ASC LIMIT 1`
        ).bind(source, productId, gender || null, color || null, material, length, size || null, `stocktake-unresolved:${category}:`).first<Record<string, unknown>>();"""
if old not in s:
    raise SystemExit('parameterized unresolved marker LIKE not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Repair the temporary preservation-gate patcher before it is executed.
g = Path('scripts/w5-5-gate-patcher.py')
gs = g.read_text(encoding='utf-8')

# The first router normalizer stopped before the found-route closing brace because its
# generic lookahead accepted any closing brace. Replace only that normalizer fragment,
# using stable start/end markers rather than trying to reproduce all escape levels.
start_marker = r"    .replace(/\n\s*const inventoryFoundStockReconcileMatch"
start = gs.find(start_marker)
if start < 0:
    raise SystemExit('W5.5 router normalizer start not found')
end = gs.find(", '')", start)
if end < 0:
    raise SystemExit('W5.5 router normalizer end not found')
end += len(", '')")
replacement = r"    .replace(/\n\s*const inventoryFoundStockReconcileMatch = url\.pathname\.match\(\/\^\\\/api\\\/inventory\\\/found-stock\\\/\(\\d\+\)\\\/reconcile\$\/\);[\s\S]*?(?=\n\s*const inventoryStocktakeAddItemMatch)/, '')"
gs = gs[:start] + replacement + gs[end:]

# The 1906B gate has a second, dedicated hash check for the Attention renderer.
# Register the exact W5.5 manifest delta there as well; otherwise the generic panel
# allow-list passes but this older W2/W3.2-only check rejects the intentional UI change.
anchor = "'1906b W5.5 panel chain')\n"
if gs.count(anchor) != 1:
    raise SystemExit(f'W5.5 panel-chain insertion anchor: expected 1, got {gs.count(anchor)}')
attention_patch = r'''s = one(s,
"    check(sha(normalize(expression.getText(parsed.source))) === expectedAttentionHash, w3NaturalRecovery ? 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2/W3.2 deltas' : 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2 delta')\n",
"    const w5FoundItemsAttention = w5FoundItems?.frontend?.panelReturnChanges?.renderInventoryAttentionPanel\n    if (w5FoundItemsAttention) {\n      check(w5FoundItemsAttention.before === expectedAttentionHash, 'W5.5 Attention baseline must match accepted W3.2 Attention delta')\n      expectedAttentionHash = w5FoundItemsAttention.after\n    }\n    check(sha(normalize(expression.getText(parsed.source))) === expectedAttentionHash, w5FoundItems ? 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2/W3.2/W5.5 deltas' : (w3NaturalRecovery ? 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2/W3.2 deltas' : 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2 delta'))\n",
'1906b W5.5 dedicated Attention chain')
'''
gs = gs.replace(anchor, anchor + attention_patch, 1)
g.write_text(gs, encoding='utf-8')

print('W5.5 temporary patcher fixes applied')
