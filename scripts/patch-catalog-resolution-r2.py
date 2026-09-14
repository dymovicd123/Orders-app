from pathlib import Path

path = Path('worker/domains/catalog.ts')
text = path.read_text(encoding='utf-8')
old = """  const raw = catalogValueAliasKey(rawValue);\n  const canonical = catalogValueAliasKey(canonicalValue);\n  if (!raw || !canonical || raw === canonical) return false;\n  if ((kind === 'material' || kind === 'length') && canonical === 'СТАНДАРТ') return false;\n"""
new = """  const raw = catalogValueAliasKey(rawValue);\n  const canonical = catalogValueAliasKey(canonicalValue);\n  if (!raw || !canonical || raw === canonical) return false;\n  if ((kind === 'material' || kind === 'length') && (raw === 'СТАНДАРТ' || canonical === 'СТАНДАРТ')) return false;\n  if (kind === 'color' && ['БЕЗ ЦВЕТА', 'НЕТ ЦВЕТА', 'НЕ УКАЗАН'].includes(raw)) return false;\n  if ((kind === 'size' || kind === 'child_age') && ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р', 'НЕ УКАЗАН'].includes(raw)) return false;\n"""
if old not in text:
    raise SystemExit('alias guard anchor not found or already changed')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
