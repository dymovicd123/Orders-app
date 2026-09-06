import fs from 'node:fs'

const path = 'src/features/sections/InventorySection.tsx'
let source = fs.readFileSync(path, 'utf8')
const anchor = `        inventoryPanelStyle,\n        inventoryProductReferenceGroups,\n        lifecycleFactsMatchExactVariant,`
if (!source.includes(anchor)) {
  if (source.includes(`        inventoryProductReferenceGroups,\n        inventoryQuery,\n        lifecycleFactsMatchExactVariant,`)) {
    console.log('W6.2 InventorySection Catalog call already passes inventoryQuery')
    process.exit(0)
  }
  throw new Error('W6.2 InventorySection Catalog call anchor missing')
}
source = source.replace(anchor, `        inventoryPanelStyle,\n        inventoryProductReferenceGroups,\n        inventoryQuery,\n        lifecycleFactsMatchExactVariant,`)
fs.writeFileSync(path, source)
console.log('W6.2 InventorySection Catalog call now passes inventoryQuery explicitly')
