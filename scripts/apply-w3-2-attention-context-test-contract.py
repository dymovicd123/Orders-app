from pathlib import Path

path = Path('scripts/test-step192b2a2-attention-context.mjs')
text = path.read_text(encoding='utf-8')

old = '''  // One screen, separate question types: never one giant vertical list again.
  for (const marker of [
    "type AttentionCategory = 'count' | 'handover' | 'intake' | 'identify' | 'revision'",
    "{ value: 'count', label: 'Количество' }",
    "{ value: 'handover', label: 'Выдача' }",
    "{ value: 'intake', label: 'Приёмка' }",
    "{ value: 'identify', label: 'Товар' }",
    "{ value: 'revision', label: 'Проверка' }",
    "attentionCategory === 'count'",
    "attentionCategory === 'handover'",
    "attentionCategory === 'intake'",
    "attentionCategory === 'identify'",
    "attentionCategory === 'revision'",
  ]) check(attentionHook.includes(marker) || panel.includes(marker), `Attention category UI missing: ${marker}`)
  check(panel.includes('inventory-attention-tabs') && css.includes('.inventory-attention-tabs'), 'Attention category tabs are not styled/mounted')'''

new = '''  // Natural recovery keeps clarification secondary: only true ambiguity remains there.
  for (const marker of [
    "type AttentionCategory = 'handover' | 'intake' | 'identify'",
    "{ value: 'handover', label: 'Выдача' }",
    "{ value: 'identify', label: 'Товар' }",
    "attentionCategory === 'handover'",
    "attentionCategory === 'intake'",
    "attentionCategory === 'identify'",
  ]) check(attentionHook.includes(marker) || panel.includes(marker), `Attention category UI missing: ${marker}`)
  check(!panel.includes("{ value: 'count', label: 'Количество' }") && !panel.includes("{ value: 'revision', label: 'Проверка' }"), 'Routine shortage/revision returned to clarification tabs')
  check(panel.includes('inventory-attention-tabs') && css.includes('.inventory-attention-tabs'), 'Clarification tabs are not styled/mounted')
  check(panel.includes('Нехватка и ревизии решаются в своих обычных разделах.'), 'Natural-recovery routing is not explained in clarification')'''

if text.count(old) != 1:
    raise SystemExit(f'192B2A2 category contract: expected 1 match, found {text.count(old)}')
text = text.replace(old, new, 1)

old2 = "  check(panel.includes('В остальных заказах') && panel.includes('разбираются отдельно во вкладке «Выдача»'), 'UI does not explain the quantity split between count and handover')"
new2 = "  check(!panel.includes('В остальных заказах') && !panel.includes('разбираются отдельно во вкладке «Выдача»'), 'Shortage/count explanation leaked back into secondary clarification')"
if text.count(old2) != 1:
    raise SystemExit(f'192B2A2 shortage UI contract: expected 1 match, found {text.count(old2)}')
text = text.replace(old2, new2, 1)

path.write_text(text, encoding='utf-8')
print('Step192B2A2 cumulative contract updated for W3.2 natural recovery')
