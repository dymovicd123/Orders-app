import fs from 'node:fs'

const oldLegacy = 'src/features/inventory/views/renderInventoryCatalogPanelLegacy.tsx'
const newLegacy = 'src/features/inventory/views/catalogLegacyAdminModes.tsx'

if (fs.existsSync(oldLegacy) && !fs.existsSync(newLegacy)) fs.renameSync(oldLegacy, newLegacy)

const rendererPath = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
let renderer = fs.readFileSync(rendererPath, 'utf8')
renderer = renderer.replace("from './renderInventoryCatalogPanelLegacy'", "from './catalogLegacyAdminModes'")
fs.writeFileSync(rendererPath, renderer)

const focusedPath = 'scripts/test-w6-2-catalog-master-detail.mjs'
let focused = fs.readFileSync(focusedPath, 'utf8')
focused = focused.replace(
  "read('src/features/inventory/views/renderInventoryCatalogPanelLegacy.tsx')",
  "read('src/features/inventory/views/catalogLegacyAdminModes.tsx')",
)
fs.writeFileSync(focusedPath, focused)

const docsPath = 'docs/continuation/W6_2_CATALOG_MASTER_DETAIL_20260906.md'
let docs = fs.readFileSync(docsPath, 'utf8')
docs = docs.replace('`renderInventoryCatalogPanelLegacy.tsx`', '`catalogLegacyAdminModes.tsx`')
fs.writeFileSync(docsPath, docs)

console.log('W6.2 legacy admin renderer moved outside the render*.tsx boundary set')
