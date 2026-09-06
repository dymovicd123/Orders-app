import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function rendererHash(path, name) {
  const text = fs.readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let fn = null
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!fn?.body) throw new Error(`${name} not found in ${path}`)
  const returned = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
  if (!returned?.expression) throw new Error(`return not found in ${path}`)
  let expression = returned.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return sha(normalize(expression.getText(source)))
}

const rendererPath = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
let source = fs.readFileSync(rendererPath, 'utf8')
if (source.includes("from './catalogPolishExecutionGroups'")) {
  console.log('W6.3 extraction already applied')
  process.exit(0)
}

source = source.replace(
  "import { renderInventoryCatalogPanel as renderLegacyInventoryCatalogPanel } from './catalogLegacyAdminModes'\n",
  "import { renderInventoryCatalogPanel as renderLegacyInventoryCatalogPanel } from './catalogLegacyAdminModes'\nimport { CatalogPolishExecutionGroups, pluralRu } from './catalogPolishExecutionGroups'\n",
)

const pluralStart = source.indexOf('  const pluralRu = (value: number, one: string, few: string, many: string) => {')
const pluralEnd = source.indexOf('  const variantMatchesCategory =', pluralStart)
if (pluralStart < 0 || pluralEnd < 0) throw new Error('W6.3 plural extraction anchors missing')
source = source.slice(0, pluralStart) + source.slice(pluralEnd)

const groupStart = source.indexOf('  const colorGroupsFor = (variants: any[]) => {')
const groupEnd = source.indexOf('  const browseProducts = activeProducts.filter', groupStart)
if (groupStart < 0 || groupEnd < 0) throw new Error('W6.3 group helper extraction anchors missing')
source = source.slice(0, groupStart) + source.slice(groupEnd)

const executionStart = source.indexOf('              <div className="catalog-execution-list">')
const executionEnd = source.indexOf('              {showVariantEditor ? (', executionStart)
if (executionStart < 0 || executionEnd < 0) throw new Error('W6.3 execution JSX extraction anchors missing')
const executionCall = `              <CatalogPolishExecutionGroups\n                executionGroups={executionGroups}\n                selectedVariants={selectedVariants}\n                selectedProduct={selectedProduct}\n                getStockQuantityForVariant={getStockQuantityForVariant}\n                getCatalogVariantCategory={getCatalogVariantCategory}\n                productCategoryLabel={productCategoryLabel}\n                catalogVariantDraft={catalogVariantDraft}\n                showVariantEditor={showVariantEditor}\n                openVariantEditor={openVariantEditor}\n                stocktakeReferenceReady={stocktakeReferenceReady}\n                openNewVariant={openNewVariant}\n              />\n\n`
source = source.slice(0, executionStart) + executionCall + source.slice(executionEnd)
fs.writeFileSync(rendererPath, source)

const helperPath = 'src/features/inventory/views/catalogPolishExecutionGroups.tsx'
const w62Path = 'scripts/test-w6-2-catalog-master-detail.mjs'
let w62 = fs.readFileSync(w62Path, 'utf8')
if (!w62.includes("const polish = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')")) {
  w62 = w62.replace(
    "const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')\n",
    "const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')\nconst polish = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')\n",
  )
  w62 = w62.replace(
    "check(catalog.includes('executionGroups') && catalog.includes('catalog-execution-card') && (catalog.includes('catalog-variation-row') || catalog.includes('catalog-color-group')), 'Product -> Execution -> Variations hierarchy missing')",
    "check(catalog.includes('executionGroups') && (catalog.includes('CatalogPolishExecutionGroups') || catalog.includes('catalog-variation-row')) && (polish.includes('catalog-execution-card') || catalog.includes('catalog-execution-card')), 'Product -> Execution -> Variations hierarchy missing')",
  )
  fs.writeFileSync(w62Path, w62)
}

const focusedPath = 'scripts/test-w6-3-catalog-polish.mjs'
let focused = fs.readFileSync(focusedPath, 'utf8')
if (!focused.includes("const polish = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')")) {
  focused = focused.replace(
    "const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')\n",
    "const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')\nconst polish = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')\n",
  )
  focused = focused.replace(
    "check(catalog.includes('colorGroupsFor') && catalog.includes('catalog-color-group') && catalog.includes('catalog-size-grid'), 'Execution -> Color -> Size hierarchy missing')",
    "check(polish.includes('colorGroupsFor') && polish.includes('catalog-color-group') && polish.includes('catalog-size-grid'), 'Execution -> Color -> Size hierarchy missing')",
  )
  focused = focused.replace(
    "check(catalog.includes('catalog-size-tile') && catalog.includes('catalog-size-value') && catalog.includes('catalog-size-stock'), 'large size-first variant tile missing')",
    "check(polish.includes('catalog-size-tile') && polish.includes('catalog-size-value') && polish.includes('catalog-size-stock'), 'large size-first variant tile missing')",
  )
  focused = focused.replace(
    "check(catalog.includes('data-variant-id={variant.id}') && catalog.includes('openVariantEditor(selectedProduct, variant)'), 'exact variant identity/edit path was lost during grouping')",
    "check(polish.includes('data-variant-id={variant.id}') && polish.includes('openVariantEditor(selectedProduct, variant)'), 'exact variant identity/edit path was lost during grouping')",
  )
  focused = focused.replace(
    "check(!catalog.includes('>Править</button>'), 'repeated per-SKU Править buttons returned')",
    "check(!catalog.includes('>Править</button>') && !polish.includes('>Править</button>'), 'repeated per-SKU Править buttons returned')",
  )
  focused = focused.replace(
    "check(catalog.includes('catalog-product-commercial-anchor') && catalog.includes('catalog-execution-commercial-anchor') && catalog.includes('catalog-variant-commercial-anchor'), 'future pricing anchors are missing at product/execution/variant levels')",
    "check(catalog.includes('catalog-product-commercial-anchor') && polish.includes('catalog-execution-commercial-anchor') && polish.includes('catalog-variant-commercial-anchor'), 'future pricing anchors are missing at product/execution/variant levels')",
  )
  fs.writeFileSync(focusedPath, focused)
}

const manifestPath = 'scripts/w6-3-catalog-polish-frontend-manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.frontend.panelReturnChanges.renderInventoryCatalogPanel.after = rendererHash(rendererPath, 'renderInventoryCatalogPanel')
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const docsPath = 'docs/continuation/W6_3_CATALOG_POLISH_20260906.md'
let docs = fs.readFileSync(docsPath, 'utf8')
if (!docs.includes('catalogPolishExecutionGroups.tsx')) {
  docs += `\n## Modularization note\n\nThe color/size presentation is isolated in \`catalogPolishExecutionGroups.tsx\`, keeping the main Catalog controller/view below the existing 190.6B renderer-size boundary. The helper owns no React hooks and receives the exact variant/edit callbacks explicitly.\n`
  fs.writeFileSync(docsPath, docs)
}

console.log(`W6.3 Catalog polish extracted; renderer now ${source.split(/\\r?\\n/).length} lines; helper ${fs.readFileSync(helperPath, 'utf8').split(/\\r?\\n/).length} lines`)
