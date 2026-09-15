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
