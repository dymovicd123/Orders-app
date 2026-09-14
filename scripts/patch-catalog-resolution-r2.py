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
original = """const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))\nif (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction Worker manifest invalid')\n"""
injected = """const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))\nif (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction Worker manifest invalid')\nconst contextualCatalogResolutionR2Manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/contextual-catalog-resolution-r2-worker-manifest.json'), 'utf8'))\nif (contextualCatalogResolutionR2Manifest?.version !== 1 || contextualCatalogResolutionR2Manifest?.revision !== 'contextual-catalog-resolution-r2') throw new Error('Contextual catalog resolution R2 Worker manifest invalid')\nif (Object.keys(contextualCatalogResolutionR2Manifest.changes || {}).join(',') !== 'rememberCatalogValueAlias') throw new Error('Contextual catalog resolution R2 Worker allow-list widened unexpectedly')\nconst contextualCatalogResolutionR2Change = contextualCatalogResolutionR2Manifest.changes.rememberCatalogValueAlias\nif (manifest.declarations?.rememberCatalogValueAlias !== contextualCatalogResolutionR2Change.before) throw new Error('Contextual catalog resolution R2 baseline mismatch: rememberCatalogValueAlias')\nmanifest.declarations.rememberCatalogValueAlias = contextualCatalogResolutionR2Change.after\n"""
if injected in wrapper:
    wrapper = wrapper.replace(injected, original, 1)
elif original not in wrapper:
    raise SystemExit('1906A wrapper restore anchor changed unexpectedly')
wrapper_path.write_text(wrapper, encoding='utf-8')

base_manifest_path = Path('scripts/step1906a-worker-declaration-manifest.json')
base_manifest = base_manifest_path.read_text(encoding='utf-8')
before = '2fcbf079f13199164ed1ad6cf5ff880d34769919e0b052bc2b24b25728e6a377'
after = 'e5562c00d5c153c45a995f428c0bef5c8860eeaa9826f4201580dd82f557f887'
old_hash = f'"rememberCatalogValueAlias": "{before}"'
new_hash = f'"rememberCatalogValueAlias": "{after}"'
if old_hash in base_manifest:
    base_manifest = base_manifest.replace(old_hash, new_hash, 1)
elif new_hash not in base_manifest:
    raise SystemExit('1906A base manifest rememberCatalogValueAlias hash changed unexpectedly')
base_manifest_path.write_text(base_manifest, encoding='utf-8')
