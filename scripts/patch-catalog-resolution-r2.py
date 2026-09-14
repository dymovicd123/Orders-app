from pathlib import Path

catalog_path = Path('worker/domains/catalog.ts')
catalog = catalog_path.read_text(encoding='utf-8')
old_alias = """  const raw = catalogValueAliasKey(rawValue);\n  const canonical = catalogValueAliasKey(canonicalValue);\n  if (!raw || !canonical || raw === canonical) return false;\n  if ((kind === 'material' || kind === 'length') && canonical === 'СТАНДАРТ') return false;\n"""
new_alias = """  const raw = catalogValueAliasKey(rawValue);\n  const canonical = catalogValueAliasKey(canonicalValue);\n  if (!raw || !canonical || raw === canonical) return false;\n  if ((kind === 'material' || kind === 'length') && (raw === 'СТАНДАРТ' || canonical === 'СТАНДАРТ')) return false;\n  if (kind === 'color' && ['БЕЗ ЦВЕТА', 'НЕТ ЦВЕТА', 'НЕ УКАЗАН'].includes(raw)) return false;\n  if ((kind === 'size' || kind === 'child_age') && ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р', 'НЕ УКАЗАН'].includes(raw)) return false;\n"""
if old_alias in catalog:
    catalog = catalog.replace(old_alias, new_alias, 1)
elif new_alias not in catalog:
    raise SystemExit('catalog alias guard anchor changed unexpectedly')
catalog_path.write_text(catalog, encoding='utf-8')

wrapper_path = Path('scripts/test-step1906a-worker-modularization.mjs')
wrapper = wrapper_path.read_text(encoding='utf-8')
anchor = """const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))\nif (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction Worker manifest invalid')\n"""
injected = """const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))\nif (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction Worker manifest invalid')\nconst contextualCatalogResolutionR2Manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/contextual-catalog-resolution-r2-worker-manifest.json'), 'utf8'))\nif (contextualCatalogResolutionR2Manifest?.version !== 1 || contextualCatalogResolutionR2Manifest?.revision !== 'contextual-catalog-resolution-r2') throw new Error('Contextual catalog resolution R2 Worker manifest invalid')\nif (Object.keys(contextualCatalogResolutionR2Manifest.changes || {}).join(',') !== 'rememberCatalogValueAlias') throw new Error('Contextual catalog resolution R2 Worker allow-list widened unexpectedly')\nconst contextualCatalogResolutionR2Change = contextualCatalogResolutionR2Manifest.changes.rememberCatalogValueAlias\nif (manifest.declarations?.rememberCatalogValueAlias !== contextualCatalogResolutionR2Change.before) throw new Error('Contextual catalog resolution R2 baseline mismatch: rememberCatalogValueAlias')\nmanifest.declarations.rememberCatalogValueAlias = contextualCatalogResolutionR2Change.after\n"""
if anchor in wrapper:
    wrapper = wrapper.replace(anchor, injected, 1)
elif "Contextual catalog resolution R2 baseline mismatch: rememberCatalogValueAlias" not in wrapper:
    raise SystemExit('1906A wrapper anchor changed unexpectedly')
wrapper_path.write_text(wrapper, encoding='utf-8')
