import fs from 'node:fs'

const path = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
let source = fs.readFileSync(path, 'utf8')

if (!source.includes('type PanelContext = Pick<InventoryRenderContext,')) {
  const context = `type PanelContext = Pick<InventoryRenderContext,\n  | 'catalogActiveProducts'\n  | 'catalogAdminMode'\n  | 'catalogCategoryFilter'\n  | 'catalogData'\n  | 'catalogIssueStats'\n  | 'catalogOnlyWithoutVariants'\n  | 'catalogProductDraft'\n  | 'catalogReview'\n  | 'catalogVariantDraft'\n  | 'catalogVariantsByProductId'\n  | 'expandedCatalogProducts'\n  | 'getCatalogProductEffectiveCategory'\n  | 'getCatalogVariantCategory'\n  | 'getStockQuantityForVariant'\n  | 'inventoryLifecycle'\n  | 'inventoryPanelStyle'\n  | 'inventoryQuery'\n  | 'loadCatalogData'\n  | 'loadCatalogReview'\n  | 'loadInventoryLifecycle'\n  | 'loadReferenceItems'\n  | 'openInventoryPanel'\n  | 'productCategoryLabel'\n  | 'referenceItems'\n  | 'referenceKind'\n  | 'saveCatalogProduct'\n  | 'saveCatalogVariant'\n  | 'selectReferenceKind'\n  | 'setCatalogAdminMode'\n  | 'setCatalogCategoryFilter'\n  | 'setCatalogOnlyWithoutVariants'\n  | 'setCatalogProductDraft'\n  | 'setCatalogReviewTaskIndex'\n  | 'setCatalogVariantDraft'\n  | 'setExpandedCatalogProducts'\n  | 'setInventoryLifecycleTaskIndex'\n  | 'setInventoryQuery'\n  | 'stocktakeReferenceReady'\n  | 'suggestionValues'\n>\n\n`
  const anchor = "const W6_NEW_PRODUCT = '__w6_new_product'"
  if (!source.includes(anchor)) throw new Error('W6.2 PanelContext insertion anchor missing')
  source = source.replace(anchor, `${context}${anchor}`)
}

source = source.replace(
  'export function renderInventoryCatalogPanel(ctx: InventoryRenderContext) {',
  'export function renderInventoryCatalogPanel(ctx: PanelContext) {',
)

fs.writeFileSync(path, source)
console.log('W6.2 Catalog renderer now uses an explicit Pick<InventoryRenderContext> boundary')
