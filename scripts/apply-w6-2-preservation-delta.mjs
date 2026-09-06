import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const replaceOnce = (text, before, after, label) => {
  if (!text.includes(before)) throw new Error(`W6.2 preservation anchor missing: ${label}`)
  return text.replace(before, after)
}

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
let renderer = fs.readFileSync(rendererPath, 'utf8')
renderer = renderer.replace(
  "catalog-master-detail ${selectedNumericId ? 'has-explicit-selection' : ''}",
  "catalog-master-detail ${explicitSelectedProduct ? 'has-explicit-selection' : ''}",
)
fs.writeFileSync(rendererPath, renderer)

const testPath = 'scripts/test-step1906b-frontend-modularization.mjs'
let test = fs.readFileSync(testPath, 'utf8')
if (!test.includes('w6CatalogMasterDetailPath')) {
  test = replaceOnce(
    test,
    "const w5StocktakeOutcomePath = path.join(root, 'scripts/w5-6-stocktake-outcome-frontend-manifest.json')",
    "const w5StocktakeOutcomePath = path.join(root, 'scripts/w5-6-stocktake-outcome-frontend-manifest.json')\nconst w6CatalogMasterDetailPath = path.join(root, 'scripts/w6-2-catalog-master-detail-frontend-manifest.json')",
    'manifest path',
  )
  test = replaceOnce(
    test,
    "  const w5StocktakeOutcome = fs.existsSync(w5StocktakeOutcomePath) ? JSON.parse(fs.readFileSync(w5StocktakeOutcomePath, 'utf8')) : null",
    "  const w5StocktakeOutcome = fs.existsSync(w5StocktakeOutcomePath) ? JSON.parse(fs.readFileSync(w5StocktakeOutcomePath, 'utf8')) : null\n  const w6CatalogMasterDetail = fs.existsSync(w6CatalogMasterDetailPath) ? JSON.parse(fs.readFileSync(w6CatalogMasterDetailPath, 'utf8')) : null",
    'manifest read',
  )
  test = replaceOnce(
    test,
    "  if (w5StocktakeOutcome) check(w5StocktakeOutcome.version === 1 && w5StocktakeOutcome.revision === 'w5-6-stocktake-outcome', 'W5.6 stocktake outcome frontend manifest invalid')",
    "  if (w5StocktakeOutcome) check(w5StocktakeOutcome.version === 1 && w5StocktakeOutcome.revision === 'w5-6-stocktake-outcome', 'W5.6 stocktake outcome frontend manifest invalid')\n  if (w6CatalogMasterDetail) check(w6CatalogMasterDetail.version === 1 && w6CatalogMasterDetail.revision === 'w6-2-catalog-master-detail', 'W6.2 Catalog master-detail frontend manifest invalid')",
    'manifest validation',
  )
  test = replaceOnce(
    test,
    "    const w5StocktakeOutcomeChange = w5StocktakeOutcome?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5StocktakeOutcomeChange) {\n      check(w5StocktakeOutcomeChange.before === expectedPanelHash, `${panel.func}: W5.6 stocktake outcome panel baseline hash mismatch`)\n      expectedPanelHash = w5StocktakeOutcomeChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash,",
    "    const w5StocktakeOutcomeChange = w5StocktakeOutcome?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5StocktakeOutcomeChange) {\n      check(w5StocktakeOutcomeChange.before === expectedPanelHash, `${panel.func}: W5.6 stocktake outcome panel baseline hash mismatch`)\n      expectedPanelHash = w5StocktakeOutcomeChange.after\n    }\n    const w6CatalogMasterDetailChange = w6CatalogMasterDetail?.frontend?.panelReturnChanges?.[panel.func]\n    if (w6CatalogMasterDetailChange) {\n      check(w6CatalogMasterDetailChange.before === expectedPanelHash, `${panel.func}: W6.2 Catalog master-detail panel baseline hash mismatch`)\n      expectedPanelHash = w6CatalogMasterDetailChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash,",
    'panel allow-list',
  )
  test = test.replace(
    '/manager-access/W5.4/W5.5/W5.6 delta`)',
    '/manager-access/W5.4/W5.5/W5.6/W6.2 delta`)',
  )
  test = test.replace(
    "${w5ManagerWarehouseAccess ? ', exact W5 manager Warehouse access delta accepted' : ''}`)",
    "${w5ManagerWarehouseAccess ? ', exact W5 manager Warehouse access delta accepted' : ''}${w6CatalogMasterDetail ? ', exact W6.2 Catalog master-detail delta accepted' : ''}`)",
  )
  fs.writeFileSync(testPath, test)
}

const legacyHash = rendererHash('src/features/inventory/views/renderInventoryCatalogPanelLegacy.tsx', 'renderInventoryCatalogPanel')
const newHash = rendererHash(rendererPath, 'renderInventoryCatalogPanel')
const manifest = {
  version: 1,
  revision: 'w6-2-catalog-master-detail',
  frontend: {
    panelReturnChanges: {
      renderInventoryCatalogPanel: {
        before: legacyHash,
        after: newHash,
      },
    },
  },
}
fs.writeFileSync('scripts/w6-2-catalog-master-detail-frontend-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

const focusedPath = 'scripts/test-w6-2-catalog-master-detail.mjs'
let focused = fs.readFileSync(focusedPath, 'utf8')
if (!focused.includes("explicitSelectedProduct ? 'has-explicit-selection'")) {
  focused = replaceOnce(
    focused,
    "check(catalog.includes('Нет вариантов') && !catalog.includes(\"'Взрослые: 0'\"), 'compact product list must not repeat zero-heavy technical counters')",
    "check(catalog.includes('Нет вариантов') && !catalog.includes(\"'Взрослые: 0'\"), 'compact product list must not repeat zero-heavy technical counters')\ncheck(catalog.includes(\"explicitSelectedProduct ? 'has-explicit-selection'\"), 'mobile detail mode must only activate when the selected product still belongs to the current filter')",
    'focused mobile selection assertion',
  )
  fs.writeFileSync(focusedPath, focused)
}

console.log(`W6.2 exact preservation delta prepared: ${legacyHash} -> ${newHash}`)
