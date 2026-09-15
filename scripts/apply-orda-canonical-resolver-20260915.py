from pathlib import Path

source_path = Path('worker/domains/inventory-movement.ts')
text = source_path.read_text(encoding='utf-8')

active_anchor = "      byId.set(id, row);\n      const exact = upperText(row.name);"
active_replacement = "      byId.set(id, row);\n      if (toInt(row.is_active, 0) !== 1) continue;\n      const exact = upperText(row.name);"
if active_anchor not in text:
    raise SystemExit('active lookup anchor missing')
text = text.replace(active_anchor, active_replacement, 1)

old_resolver = """  const resolveProduct = (item: ReturnType<typeof normalizeInventoryItem>) => {
    const explicit = item.productId > 0 ? lookup.byId.get(item.productId) : null;
    if (explicit) return explicit;
    const exact = lookup.byExact.get(item.productName);
    if (exact) return exact;
    const identityKey = normalizeCatalogProductIdentityKey(item.productName);
    if (!identityKey) return null;
    return lookup.byIdentity.get(identityKey) || lookup.byAlias.get(identityKey) || null;
  };"""
new_resolver = """  const resolveProduct = (item: ReturnType<typeof normalizeInventoryItem>) => {
    const explicit = item.productId > 0 ? lookup.byId.get(item.productId) : null;
    if (explicit && toInt(explicit.is_active, 0) === 1) return explicit;
    const identityKey = normalizeCatalogProductIdentityKey(item.productName);
    if (!identityKey) return null;
    const alias = lookup.byAlias.get(identityKey);
    if (alias) return alias;
    const exact = lookup.byExact.get(upperText(item.productName));
    if (exact) return exact;
    return lookup.byIdentity.get(identityKey) || null;
  };"""
if old_resolver not in text:
    raise SystemExit('resolver anchor missing')
text = text.replace(old_resolver, new_resolver, 1)
source_path.write_text(text, encoding='utf-8')

test_path = Path('scripts/test-arrival-canonical-product-alias-r1.mjs')
test_path.write_text("""import fs from 'node:fs'\n\nconst source = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')\nconst start = source.indexOf('export async function resolveInventoryCreatableItemsBulk(')\nconst end = source.indexOf('\\n\\nexport async function applyInventoryMovement(', start)\nif (start < 0 || end < 0) throw new Error('Cannot isolate inventory materializer')\nconst body = source.slice(start, end)\nconst check = (value, message) => { if (!value) throw new Error(message) }\n\ncheck(body.includes('if (toInt(row.is_active, 0) !== 1) continue;'), 'inactive products are excluded from name/identity lookup')\ncheck(body.includes('if (explicit && toInt(explicit.is_active, 0) === 1) return explicit;'), 'stale explicit inactive product ids cannot keep an arrival on a retired product')\ncheck(body.includes('const alias = lookup.byAlias.get(identityKey);'), 'active learned alias participates in arrival resolution')\ncheck(body.includes('if (alias) return alias;'), 'canonical alias can resolve the raw arrival product name')\nconst aliasPos = body.indexOf('const alias = lookup.byAlias.get(identityKey);')\nconst exactPos = body.indexOf('const exact = lookup.byExact.get(upperText(item.productName));')\nconst identityPos = body.indexOf('return lookup.byIdentity.get(identityKey) || null;')\ncheck(aliasPos >= 0 && exactPos > aliasPos && identityPos > exactPos, 'alias wins before active exact/identity name lookup for non-explicit arrivals')\ncheck(!body.includes('return lookup.byIdentity.get(identityKey) || lookup.byAlias.get(identityKey) || null;'), 'old alias-last resolver is gone')\nconsole.log('ARRIVAL CANONICAL PRODUCT ALIAS R1 TESTS PASSED')\n""", encoding='utf-8')

package_path = Path('package.json')
pkg = package_path.read_text(encoding='utf-8')
anchor = 'node scripts/test-arrival-materialization-reliability.mjs && '
addition = 'node scripts/test-arrival-canonical-product-alias-r1.mjs && '
if addition not in pkg:
    if anchor not in pkg:
        raise SystemExit('package release:check anchor missing')
    pkg = pkg.replace(anchor, anchor + addition, 1)
package_path.write_text(pkg, encoding='utf-8')

wrapper_path = Path('scripts/test-step1906a-worker-modularization.mjs')
wrapper = wrapper_path.read_text(encoding='utf-8')
path_anchor = "const contextualCatalogResolutionManifestPath = path.join(root, 'scripts/contextual-catalog-resolution-r1-worker-manifest.json')\n"
path_addition = path_anchor + "const arrivalCanonicalProductAliasManifestPath = path.join(root, 'scripts/arrival-canonical-product-alias-r1-worker-manifest.json')\n"
if path_anchor not in wrapper:
    raise SystemExit('worker manifest path anchor missing')
wrapper = wrapper.replace(path_anchor, path_addition, 1)

validation_anchor = "if (Object.keys(contextualCatalogResolutionManifest.added || {}).sort().join(',') !== 'reconcileCatalogReviewOrder,resolveOrderCatalogReviewExistingVariant') throw new Error('Contextual catalog resolution Worker added allow-list widened unexpectedly')\n"
validation_addition = validation_anchor + "const arrivalCanonicalProductAliasManifest = JSON.parse(fs.readFileSync(arrivalCanonicalProductAliasManifestPath, 'utf8'))\nif (arrivalCanonicalProductAliasManifest?.version !== 1 || arrivalCanonicalProductAliasManifest?.revision !== 'arrival-canonical-product-alias-r1') throw new Error('Arrival canonical product alias R1 Worker manifest invalid')\nif (Object.keys(arrivalCanonicalProductAliasManifest.changes || {}).join(',') !== 'resolveInventoryCreatableItemsBulk') throw new Error('Arrival canonical product alias R1 Worker allow-list widened unexpectedly')\n"
if validation_anchor not in wrapper:
    raise SystemExit('worker manifest validation anchor missing')
wrapper = wrapper.replace(validation_anchor, validation_addition, 1)

injection_anchor = "  + 'const contextualCatalogResolutionRouter = ' + JSON.stringify(contextualCatalogResolutionManifest.router || {}) + '\\n')"
injection_replacement = "  + 'const contextualCatalogResolutionRouter = ' + JSON.stringify(contextualCatalogResolutionManifest.router || {}) + '\\n'\n  + 'const arrivalCanonicalProductAliasChanges = ' + JSON.stringify(arrivalCanonicalProductAliasManifest.changes || {}) + '\\n')"
if injection_anchor not in wrapper:
    raise SystemExit('worker manifest runtime injection anchor missing')
wrapper = wrapper.replace(injection_anchor, injection_replacement, 1)

hash_anchor = "  '        return sha(declarations.get(name)) === acceptedPostClientFixesHash',\n"
hash_replacement = "  '        const arrivalCanonicalProductAliasChanged = arrivalCanonicalProductAliasChanges[name]',\n  '        let acceptedPostArrivalCanonicalProductAliasHash = acceptedPostClientFixesHash',\n  '        if (arrivalCanonicalProductAliasChanged) {',\n  \"          check(arrivalCanonicalProductAliasChanged.before === acceptedPostClientFixesHash, 'Arrival canonical product alias R1 baseline hash mismatch: ' + name)\",\n  '          acceptedPostArrivalCanonicalProductAliasHash = arrivalCanonicalProductAliasChanged.after',\n  '        }',\n  '        return sha(declarations.get(name)) === acceptedPostArrivalCanonicalProductAliasHash',\n"
if hash_anchor not in wrapper:
    raise SystemExit('worker manifest final hash anchor missing')
wrapper = wrapper.replace(hash_anchor, hash_replacement, 1)
wrapper_path.write_text(wrapper, encoding='utf-8')
