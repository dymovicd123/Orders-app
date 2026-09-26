import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const catalogPanel = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const catalog = read('worker/domains/catalog.ts')
const arrival = read('worker/domains/inventory-movement.ts')
const inventorySection = read('src/features/sections/InventorySection.tsx')

// Working order/exchange pickers must never surface retired base products.
check(workspace.includes("const activeCatalogProducts = (catalogData?.products || []).filter((product) => product.isActive)"), 'working product suggestions are not restricted to active Catalog products')
check(workspace.includes('const activeProductIds = new Set(activeCatalogProducts.map'), 'active Catalog product identity set missing')
check(workspace.includes('variant.isActive && activeProductIds.has(Number(variant.productId || 0))'), 'inactive-parent variants can still feed working characteristic suggestions')
check(workspace.includes('products: collect(refs.products, activeCatalogProducts.map((product) => product.name))'), 'product picker no longer uses active Catalog/reference union')

// Known characteristic vocabulary is shared between maintained references and active Catalog truth.
check(workspace.includes('const collectKnownFacts = '), 'known Catalog fact merge helper missing')
check(workspace.includes(".replace(/[‐‑‒–—-]+/g, ' ')"), 'hyphen/space identity normalization missing from working suggestions')
check(workspace.includes('colors: collectKnownFacts(refs.colors, activeVariants.map((variant) => variant.color))'), 'active Catalog colors do not supplement references')
check(workspace.includes('materials: collectKnownFacts(refs.materials, activeVariants.map((variant) => canonicalStockPositionValue(variant.material)))'), 'active Catalog materials do not supplement references')
check(workspace.includes('lengths: collectKnownFacts(refs.lengths, activeVariants.map((variant) => canonicalStockPositionValue(variant.length)))'), 'active Catalog lengths do not supplement references')
check(workspace.includes("activeVariants.filter((variant) => getCatalogVariantCategory(variant) === 'adult').map((variant) => variant.sizeLabel)"), 'active adult Catalog sizes do not supplement references')
check(workspace.includes("activeVariants.filter((variant) => getCatalogVariantCategory(variant) === 'child').map((variant) => variant.sizeLabel)"), 'active child Catalog ages do not supplement references')

// Arrival already had the ORDA safety fix and must keep it.
check(arrival.includes('if (toInt(row.is_active, 0) !== 1) continue;'), 'Arrival can again resolve through inactive products')
check(arrival.includes('const alias = lookup.byAlias.get(identityKey);') && arrival.indexOf('const alias = lookup.byAlias.get(identityKey);') < arrival.indexOf('const exact = lookup.byExact.get(upperText(item.productName));'), 'Arrival no longer prefers canonical product aliases before raw exact names')
check(inventorySection.includes('options={(catalogData?.products || []).filter((product) => product.isActive).map((product) => product.name)}'), 'Arrival UI product picker lost active-only filtering')

// Whole-product retirement is soft, guarded and explicit.
check(catalog.includes('export async function assertCatalogProductMayDeactivate'), 'product-level retirement guard missing')
for (const token of ['active_variants', 'physical_quantity', 'stock_reserved_quantity', 'active_reservation_quantity', 'open_order', 'open_workshop', 'pending_lifecycle', 'active_stocktake']) {
  check(catalog.includes(token), 'product retirement guard missing blocker: ' + token)
}
check(catalog.includes('if (deactivating) await assertCatalogProductMayDeactivate(db, id);'), 'product deactivation bypasses blocker guard')
check(catalog.includes("(name !== undefined || activating) && targetName"), 'reactivation does not re-check canonical name/alias conflicts')
check(catalog.includes('findCatalogProductByIdentity(db, targetName, id)'), 'reactivation cannot detect ORDA-style canonical alias conflicts')
check(!catalog.includes('DELETE FROM catalog_products'), 'product retirement must remain non-destructive')

// No active execution/SKU may be created under a retired product.
check(catalog.includes("'SELECT id FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1'"), 'active-product mutation guard missing')
check(catalog.includes('Нельзя создавать исполнение у товара, выведенного из активного каталога.'), 'execution creation can target retired products')
check(catalog.includes('Нельзя добавить позицию: товар не найден или выведен из активного каталога.'), 'new SKU creation can target retired products')
check(catalog.includes('Нельзя сохранить активную позицию у товара, выведенного из каталога.'), 'SKU activation/edit can target retired products')
check(catalog.includes("UPDATE catalog_variants SET is_active = 0, sort_order = ?, updated_at = ? WHERE id = ? AND is_active = 1"), 'SKU retirement is not a pure soft-deactivation path')

// Catalog admin may reuse a value already proven by active Catalog even if the helper reference drifted.
check(catalog.includes('export async function catalogActiveCharacteristicValueExists'), 'Catalog-backed characteristic validation missing')
check(catalog.includes('JOIN catalog_products p ON p.id = v.product_id') && catalog.includes('v.is_active = 1 AND p.is_active = 1'), 'Catalog-backed characteristic validation does not require active SKU + active product')
check(catalog.includes('if (await catalogActiveCharacteristicValueExists(db, dbKind, normalized)) return;'), 'Catalog admin still rejects values already used by active Catalog')

// Product retirement is exposed as a guarded admin action, not hard delete.
check(catalogPanel.includes('Вывести товар'), 'whole-product retirement action missing from Catalog UI')
check(catalogPanel.includes('disabled={selectedVariants.length > 0}'), 'whole-product retirement UI can bypass active SKU cleanup')
check(catalogPanel.includes("body: JSON.stringify({ isActive: false })"), 'whole-product retirement UI does not use soft deactivate')
check(catalogPanel.includes('Он исчезнет из форм выбора, но история останется.'), 'whole-product retirement confirmation does not explain historical preservation')

console.log('CATALOG SELECTION / RETIREMENT INTEGRITY PASSED — working pickers are active-only, known facts share Catalog truth, ORDA alias safety is preserved, and product/SKU retirement is soft and guarded')
