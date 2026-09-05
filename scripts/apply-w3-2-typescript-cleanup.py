from pathlib import Path

path = Path('src/features/inventory/useInventoryAttentionActions.ts')
text = path.read_text(encoding='utf-8')

helper = '''function attentionCategoryCount(data: any, category: AttentionCategory) {
  if (!data?.counts) return 0
  if (category === 'handover') return Number(data.counts.handover || 0)
  if (category === 'intake') return Number(data.counts.intake || 0)
  return Number(data.counts.lifecycle || 0) + Number(data.counts.catalog || 0)
}

'''
if text.count(helper) != 1:
    raise SystemExit(f'attentionCategoryCount cleanup: expected 1 match, found {text.count(helper)}')
text = text.replace(helper, '', 1)

unused_destructure = '    setQuickStocktakeOpen,\n'
if text.count(unused_destructure) != 1:
    raise SystemExit(f'setQuickStocktakeOpen destructure cleanup: expected 1 match, found {text.count(unused_destructure)}')
text = text.replace(unused_destructure, '', 1)

path.write_text(text, encoding='utf-8')
print('W3.2 TypeScript unused declarations removed')
