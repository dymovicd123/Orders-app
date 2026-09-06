from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


def git_blob_sha(text: str) -> str:
    body = text.encode('utf-8')
    return hashlib.sha1(f'blob {len(body)}\0'.encode('utf-8') + body).hexdigest()


panel_path = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
component_path = 'src/features/inventory/views/catalogPolishExecutionGroups.tsx'
inventory_path = 'src/features/sections/InventorySection.tsx'
wrapper_path = 'scripts/test-step1906b-frontend-modularization.mjs'
package_path = 'package.json'
context_path = 'docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md'

panel = read(panel_path)
component = read(component_path)
inventory = read(inventory_path)

if 'openVariantHistory={ctx.openSimpleStockHistory}' in panel:
    print('W7 history integration already applied; no source rewrite needed.')
    raise SystemExit(0)

# Freeze the accepted W6.4 runtime files before changing the protected catalog presentation boundary.
write('scripts/fixtures/renderInventoryCatalogPanel-w6-4-baseline.tsx', panel)
write('scripts/fixtures/catalogPolishExecutionGroups-w6-4-baseline.tsx', component)

panel = replace_once(
    panel,
    "  | 'openInventoryPanel'\n  | 'openOrderFromFinance'",
    "  | 'openInventoryPanel'\n  | 'openSimpleStockHistory'\n  | 'openOrderFromFinance'",
    'catalog PanelContext history callback',
)
panel = replace_once(
    panel,
    '                loadCatalogData={loadCatalogData}\n              />',
    '                loadCatalogData={loadCatalogData}\n                openVariantHistory={ctx.openSimpleStockHistory}\n              />',
    'catalog execution group history prop',
)
write(panel_path, panel)

inventory = replace_once(
    inventory,
    '        normalizeSuggestion,\n        openInventoryPanel,\n        openOrderFromFinance,',
    '        normalizeSuggestion,\n        openInventoryPanel,\n        openSimpleStockHistory,\n        openOrderFromFinance,',
    'InventorySection catalog history callback',
)
write(inventory_path, inventory)

component = replace_once(
    component,
    '  isAdmin,\n  loadCatalogData,\n}: any) {',
    '  isAdmin,\n  loadCatalogData,\n  openVariantHistory,\n}: any) {',
    'SKU component history callback prop',
)
component = replace_once(
    component,
    '''                                <div className="catalog-sku-safety-note">
                                  <strong>Идентичность позиции защищается историей.</strong>''',
    '''                                <div className="catalog-sku-actions catalog-sku-history-actions" aria-label="История точной позиции">
                                  <button
                                    className="secondary compact"
                                    type="button"
                                    onClick={() => openVariantHistory({
                                      source: 'warehouse',
                                      variantId: Number(cardVariant.id),
                                      productId: Number(selectedProduct?.id || cardVariant.productId || 0),
                                      productName: String(selectedProduct?.name || ''),
                                      color: String(cardVariant.color || colorGroup.label || ''),
                                      size: String(cardVariant.sizeLabel || ''),
                                    })}
                                  >
                                    История · Склад
                                  </button>
                                  <button
                                    className="secondary compact"
                                    type="button"
                                    onClick={() => openVariantHistory({
                                      source: 'boutique',
                                      variantId: Number(cardVariant.id),
                                      productId: Number(selectedProduct?.id || cardVariant.productId || 0),
                                      productName: String(selectedProduct?.name || ''),
                                      color: String(cardVariant.color || colorGroup.label || ''),
                                      size: String(cardVariant.sizeLabel || ''),
                                    })}
                                  >
                                    История · Бутик
                                  </button>
                                </div>

                                <div className="catalog-sku-safety-note">
                                  <strong>Идентичность позиции защищается историей.</strong>''',
    'SKU card history actions',
)
write(component_path, component)

wrapper = read(wrapper_path)
wrapper = replace_once(
    wrapper,
    "await import('./test-step1906b-frontend-modularization-w6-layer.mjs')",
    "// w7SkuHistoryPath — W7 exact-SKU history integration preservation layer\nawait import('./test-step1906b-frontend-modularization-w7-layer.mjs')",
    '1906B W7 wrapper',
)
write(wrapper_path, wrapper)

w7_layer = r'''import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const panelPath = path.join(root, 'src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const componentPath = path.join(root, 'src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const inventoryPath = path.join(root, 'src/features/sections/InventorySection.tsx')
const baselinePanelPath = path.join(root, 'scripts/fixtures/renderInventoryCatalogPanel-w6-4-baseline.tsx')
const baselineComponentPath = path.join(root, 'scripts/fixtures/catalogPolishExecutionGroups-w6-4-baseline.tsx')
const w6LayerPath = path.join(root, 'scripts/test-step1906b-frontend-modularization-w6-layer.mjs')
const w6ManifestPath = path.join(root, 'scripts/w6-4-catalog-sku-card-frontend-manifest.json')
const manifestPath = path.join(root, 'scripts/w7-sku-history-frontend-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8')
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8')
  return crypto.createHash('sha1').update(header).update(body).digest('hex')
}

try {
  for (const required of [panelPath, componentPath, inventoryPath, baselinePanelPath, baselineComponentPath, w6LayerPath, w6ManifestPath, manifestPath]) {
    check(fs.existsSync(required), `W7 frontend structural file missing: ${path.relative(root, required)}`)
  }

  const w6Manifest = JSON.parse(fs.readFileSync(w6ManifestPath, 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  check(manifest?.version === 1 && manifest?.revision === 'w7-sku-history-price-readiness', 'W7 frontend manifest invalid')

  const panelRel = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
  const componentRel = 'src/features/inventory/views/catalogPolishExecutionGroups.tsx'
  const expectedFiles = [panelRel, componentRel]
  check(JSON.stringify(Object.keys(manifest.files || {})) === JSON.stringify(expectedFiles), 'W7 frontend file allow-list widened unexpectedly')

  const currentPanel = fs.readFileSync(panelPath, 'utf8')
  const currentComponent = fs.readFileSync(componentPath, 'utf8')
  const currentInventory = fs.readFileSync(inventoryPath, 'utf8')
  const baselinePanel = fs.readFileSync(baselinePanelPath, 'utf8')
  const baselineComponent = fs.readFileSync(baselineComponentPath, 'utf8')

  check(gitBlobSha(baselinePanel) === w6Manifest.files[panelRel].afterGitBlob, 'W7 frozen panel is not the accepted W6.4 panel')
  check(gitBlobSha(baselineComponent) === w6Manifest.files[componentRel].afterGitBlob, 'W7 frozen SKU component is not the accepted W6.4 component')
  check(manifest.files[panelRel].beforeGitBlob === w6Manifest.files[panelRel].afterGitBlob, 'W7 panel before hash does not chain from W6.4')
  check(manifest.files[componentRel].beforeGitBlob === w6Manifest.files[componentRel].afterGitBlob, 'W7 component before hash does not chain from W6.4')
  check(gitBlobSha(currentPanel) === manifest.files[panelRel].afterGitBlob, 'W7 catalog panel changed beyond exact manifest')
  check(gitBlobSha(currentComponent) === manifest.files[componentRel].afterGitBlob, 'W7 SKU component changed beyond exact manifest')

  check(currentPanel.includes("| 'openSimpleStockHistory'") && currentPanel.includes('openVariantHistory={ctx.openSimpleStockHistory}'), 'W7 catalog history callback is not explicitly wired')
  check(currentInventory.includes('openSimpleStockHistory,\n        openOrderFromFinance,'), 'W7 InventorySection does not pass its existing exact-history opener to Catalog')
  check(currentComponent.includes('История · Склад') && currentComponent.includes('История · Бутик'), 'W7 source-explicit SKU history actions are missing')
  check(currentComponent.includes("source: 'warehouse'") && currentComponent.includes("source: 'boutique'"), 'W7 SKU history actions lost explicit source semantics')
  check(currentComponent.includes('variantId: Number(cardVariant.id)'), 'W7 SKU history action lost exact variant identity')
  check(!currentPanel.includes('useState(') && !currentPanel.includes('useEffect('), 'W7 catalog renderer unexpectedly owns React lifecycle')

  fs.writeFileSync(panelPath, baselinePanel)
  fs.writeFileSync(componentPath, baselineComponent)
  let result
  try {
    result = spawnSync(process.execPath, [w6LayerPath], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  } finally {
    fs.writeFileSync(panelPath, currentPanel)
    fs.writeFileSync(componentPath, currentComponent)
  }
  if (result?.error) fail(`W6 preservation layer could not run under W7 baseline: ${result.error.message}`)
  check(result?.status === 0, `W6 preservation layer failed with code ${result?.status}`)
  check(fs.readFileSync(panelPath, 'utf8') === currentPanel && fs.readFileSync(componentPath, 'utf8') === currentComponent, 'W7 frontend structural gate failed to restore current catalog files')

  console.log('W7 FRONTEND STRUCTURAL LAYER PASSED — W6.4 baseline preserved; exact source-specific SKU history integration accepted')
} catch (error) {
  console.error(`W7 FRONTEND STRUCTURAL LAYER FAILED: ${error?.message || error}`)
  process.exit(1)
}
'''
write('scripts/test-step1906b-frontend-modularization-w7-layer.mjs', w7_layer)

focused = r'''import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const inventory = read('src/features/sections/InventorySection.tsx')
const panel = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const sku = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const history = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
const initialSchema = read('migrations/0001_init.sql')
const catalogIdentity = read('migrations/0048_v72_catalog_identity_v3.sql')
const stockChecks = read('migrations/0053_v72_inventory_cycle_counts.sql')

check(inventory.includes('function openSimpleStockHistory(detail: InventoryHistoryFilter)') && inventory.includes('setHistoryVariantFilter(detail)') && inventory.includes("setHistoryMode('movements')") && inventory.includes("openInventoryPanel('history')"), 'existing exact-position Warehouse history opener is missing')
check(inventory.includes('openSimpleStockHistory,\n        openOrderFromFinance,'), 'Catalog does not receive the existing history opener')
check(panel.includes("| 'openSimpleStockHistory'") && panel.includes('openVariantHistory={ctx.openSimpleStockHistory}'), 'Catalog renderer does not pass history through its typed presentation boundary')
check(sku.includes('История · Склад') && sku.includes('История · Бутик'), 'SKU card does not expose both source histories')
check(sku.includes("source: 'warehouse'") && sku.includes("source: 'boutique'") && sku.includes('variantId: Number(cardVariant.id)'), 'SKU history navigation is not exact source + variant')
check(history.includes('Движения') && history.includes('Ревизии и сверки') && history.includes('historyVariantFilter'), 'existing Warehouse history cannot show both movement and physical-check history for the exact filter')
check(stockChecks.includes('idx_inventory_stock_checks_source_variant_time') && stockChecks.includes('(inventory_source, variant_id, checked_at DESC, id DESC)'), 'exact-SKU physical-check history index is missing')
check(initialSchema.includes('unit_price INTEGER NOT NULL DEFAULT 0') && initialSchema.includes('variant_id INTEGER REFERENCES catalog_variants(id)'), 'historical order transaction price is not separated from exact SKU identity')
check(catalogIdentity.includes('Execution identity: product + material + length.') && catalogIdentity.includes('Stock combination identity inside an execution: audience type + gender + color + size.'), 'stable Product -> Execution -> exact SKU identity contract changed')
check(panel.includes('catalog-product-commercial-anchor'), 'future product commercial anchor was lost')
check(sku.includes('catalog-execution-commercial-anchor') && sku.includes('catalog-variant-commercial-anchor'), 'future execution/exact-SKU commercial anchors were lost')
check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')

console.log('W7 SKU HISTORY / PRICE READINESS PASSED — existing exact history reused lazily; source+variant preserved; transaction price stays separate; no price semantics invented')
'''
write('scripts/test-w7-sku-history-price-readiness.mjs', focused)

package = read(package_path)
package = replace_once(
    package,
    'node scripts/test-w6-4-catalog-sku-card.mjs && node scripts/test-w6-4a-variant-editor-visibility.mjs",',
    'node scripts/test-w6-4-catalog-sku-card.mjs && node scripts/test-w6-4a-variant-editor-visibility.mjs && node scripts/test-w7-sku-history-price-readiness.mjs",',
    'package W7 release gate',
)
write(package_path, package)

w7_doc = '''# W7 — Exact SKU history + price-readiness audit\n\nDate: 2026-09-06\n\n## Goal\n\nConnect the stable W6 exact-SKU card to truthful Warehouse history and verify that future pricing can be added later without redesigning SKU identity. Prices themselves are explicitly out of scope.\n\n## Audit result\n\nNo new history table or backend endpoint is needed. The project already has exact-variant Warehouse history:\n\n- `inventory_movements` stores exact `variant_id`, source, delta, resulting quantity, reference and time;\n- `inventory_stock_checks` stores exact source + `variant_id` physical checks, including successful zero-difference confirmations;\n- completed stocktakes feed that physical-check history;\n- transfer documents/items preserve exact variants and transfer direction;\n- the existing `История склада` UI already separates `Движения` from `Ревизии и сверки`, supports exact source+variant filtering and paginated reads.\n\nTherefore W7 reuses the existing history path instead of creating parallel history infrastructure.\n\n## User-facing integration\n\nThe exact SKU card now exposes two explicit read-only actions:\n\n- `История · Склад`;\n- `История · Бутик`.\n\nBoth pass the exact `variant_id` and explicit inventory source into the already existing history opener. History remains lazy: ordinary Catalog browsing performs no new history read. The read only happens after a person requests one source history.\n\nThe history screen keeps its existing two modes, so the same exact SKU can be inspected for movements and for physical checks/revisions.\n\n## Price-readiness contract (no prices yet)\n\nW7 deliberately adds no `price` column, no pricing API, no migration and no price UI.\n\nThe system is already structurally ready for a later pricing decision because:\n\n1. product identity is stable;\n2. execution identity is `product + material + length`;\n3. exact SKU identity is execution + audience/type + gender + color + size, represented by stable `variant_id`;\n4. W6 keeps product / execution / exact-SKU commercial presentation anchors;\n5. historical order transaction price already lives on `order_items.unit_price`, separately from catalog identity.\n\nFuture master/catalog pricing must remain separate from historical transaction prices. Changing a future catalog price must never rewrite `order_items.unit_price` for past orders.\n\nThe future business rule — product base price, execution price, exact-SKU override, inheritance, effective dates — is intentionally not invented now. When pricing is actually requested, that rule should be agreed first and only then should schema/API changes be designed.\n\n## Safety / adjacent checks\n\n- no Production D1 read/write for implementation;\n- no migration;\n- no new polling/background read;\n- Warehouse history remains read-only for managers; destructive reverse remains under its existing admin boundary;\n- SKU correction/create-similar/soft-retirement behavior is unchanged;\n- transfer/stocktake/reservation mathematics is unchanged;\n- Arrival remains frozen;\n- Branch2 is untouched.\n\nW7 adds a focused regression gate and a new 1906B preservation layer so the W6.4 catalog baseline continues to be checked exactly rather than weakening old guards.\n\n## Next action\n\nAfter W7 passes cumulative CI/build and Production deploy acceptance, begin W8 with a read-only/interface audit of the daily `Остатки` screen, then polish Warehouse presentation without reopening working stock mathematics.\n'''
write('docs/continuation/W7_SKU_HISTORY_PRICE_READINESS_20260906.md', w7_doc)

context = read(context_path)
checkpoint_marker = '## Checkpoint 2026-09-06 — W7 exact-SKU history / price readiness'
if checkpoint_marker not in context:
    checkpoint = '''## Checkpoint 2026-09-06 — W7 exact-SKU history / price readiness\n\nBaseline entering W7: `main` `246dfea9fb999fd10b68ad2b4a6d716f2d3792a8` (W6.4A). Work branch: `w7-sku-history-price-readiness-audit`.\n\nCurrent conclusion: exact SKU history already exists and must be reused rather than rebuilt. Catalog SKU cards route lazily to the existing Warehouse history with explicit `source + variant_id`; no history reads are added to ordinary Catalog browsing. Pricing remains deferred: no price fields/API/migration/UI are introduced. Stable product/execution/variant identity and existing commercial anchors are preserved; historical `order_items.unit_price` remains a transaction snapshot that future catalog-price changes must never rewrite.\n\nNext after green W7 acceptance: W8 Warehouse interface completion, starting from `Остатки`. Arrival remains frozen.\n\n---\n\n'''
    context = replace_once(context, '## Mandatory continuation protocol\n', checkpoint + '## Mandatory continuation protocol\n', 'Warehouse current context W7 checkpoint')
    write(context_path, context)

# Generate the exact W7 protected-file manifest only after all protected changes are final.
w6_manifest = json.loads(read('scripts/w6-4-catalog-sku-card-frontend-manifest.json'))
panel_before = git_blob_sha(read('scripts/fixtures/renderInventoryCatalogPanel-w6-4-baseline.tsx'))
component_before = git_blob_sha(read('scripts/fixtures/catalogPolishExecutionGroups-w6-4-baseline.tsx'))
panel_after = git_blob_sha(read(panel_path))
component_after = git_blob_sha(read(component_path))

if panel_before != w6_manifest['files'][panel_path]['afterGitBlob']:
    raise RuntimeError('W7 panel baseline does not match accepted W6.4 manifest')
if component_before != w6_manifest['files'][component_path]['afterGitBlob']:
    raise RuntimeError('W7 component baseline does not match accepted W6.4 manifest')

manifest = {
    'version': 1,
    'revision': 'w7-sku-history-price-readiness',
    'files': {
        panel_path: {'beforeGitBlob': panel_before, 'afterGitBlob': panel_after},
        component_path: {'beforeGitBlob': component_before, 'afterGitBlob': component_after},
    },
}
write('scripts/w7-sku-history-frontend-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

print('W7 exact-SKU history + price-readiness integration applied.')
