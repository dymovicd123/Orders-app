import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const legacyPath = path.join(root, 'scripts/test-step1906a-worker-modularization-legacy.mjs')
const manifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-worker-manifest.json')

const manifest = {
  version: 1,
  revision: 'catalog-gender-scope-r1',
  router: {
    before: '9700ffcf609f2fcda79b3c10f332771d97e8c1606de7e8bf045b64743703bdeb',
    after: 'cede2b5ced45db1ac0bb9f790c7f4c41d89fa6e5c1a4258695e1e73b0b5b0c39',
  },
  changes: {
    CatalogReviewFactsInput: { before: '1c16d6041296d5467591d65aa5ef7b94ad0e83383977d12b23cf52ddd7d6226e', after: 'f25a7019eae8de366c93f57158b08b42db0b6676dc802046f7958854fbb488dc' },
    getCatalogReviewContext: { before: 'af97184886838a3213c8969e52205b2dfd5a1c4139ed06364f0facb7da801153', after: 'fb02c973cc2fe2cffd5f5809435df15dbf3801302134685ab883070c7c0652d9' },
    resolveCatalogReviewFacts: { before: '594a3d1a01046e3d57cf42ebdcba410a59e662ffe36165d25e39aa12c40ab65b', after: 'af418a1771569479c0dfc5820a7e11f2939a95aee0790a5754123012528a40f5' },
    listCatalog: { before: '2bb2b84c535ac2cf9f4739a0522329b818ae340a8b6ee8102c28dd523634f25e', after: 'f5a0ed399b89597ae4663a4cd765731b7dddd303a9d71ec5f3955c4010e5a6bf' },
    createCatalogProduct: { before: '0849eb34632a19651641c73d802c6bc5b49510ad8bb23934e8a1d83f0bb112c7', after: '5578adf1f0aa928b964168b7e4fed06fd2fe797f4570fa0205ace84ab65cdca7' },
    updateCatalogProduct: { before: 'bb43f8e1343ab711d83d8290166834880e63c7ca854d1c091e4975d114705681', after: 'ed6e8cf964b6a27eb5104e00c9940b86e3348dd8381bcb15e2f508bd6ae91dd4' },
    createCatalogVariant: { before: '9682a8deded78ccd1273a9ca8b684a7549f0dc4eb4be995745454f9b77844a06', after: 'c9bc202586ee90ea4d282f34d7d1aca0012f34a261e5a34d43b15d00e6f77827' },
    getInventoryLifecycleContext: { before: '4e74cb4911d2dc1ec4e5dbe13a8f5cfb174d40b9ee67161ed0aa000a637ea41e', after: '66a3c548a90e33a5b3b3ae76b1634b3b0c05bdfec136a5455b76641245d93cf1' },
    resolveInventoryLifecycleFacts: { before: 'f347f7188ce928e7bc549ec789bee77b9be4293db1304beb8ea2d426e0cfe2ef', after: '2dfcda1b713752e683342330766e7d0af0b8328f9516649d3a84a1501af552ec' },
    resolveCatalogProductAndVariantV2: { before: 'ae9d35ef2c4e13807a432f390ee8f17eb0b1fe3c06830eae9f82b57558a5600c', after: '7ad318fce89b6980234c271d26b78891717902eee9e9b55c5ab552c09d21e249' },
  },
  added: {
    CatalogProductGenderScope: 'bbbf681ec3debf44c0b46b0b62bedf13ecb271ae3d1db8a9be65fe4dd10c3145',
    normalizeCatalogProductGenderScope: 'e507935b301eee654d68b15e75d526330e14dc01f7c42a4c3fbf83493eb62ad8',
    catalogGenderForProductScope: '73ef5d8b7454e20f5d70aaf75c1f0f1691c595cfa514539a0d9eb23901468438',
    isCatalogProductGenderScopeEnabled: '981db6f4d818bb756c8416ac3f89cd05d63192829c4ed67b562b3837263f1328',
    getCatalogProductGenderScope: '1dc2367d77cea38667d2f10101cd1cde11e665dd45b38503fbe9f84ee5bd600e',
    resolveCatalogGenderForProduct: '3d608f189af84ee7b73998deb2ae993a479c429a55a6b1b69331321ff8dbd639',
  },
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

let source = fs.readFileSync(legacyPath, 'utf8')
function replaceOnce(oldText, newText, label) {
  const count = source.split(oldText).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 anchor, got ${count}`)
  source = source.replace(oldText, newText)
}

replaceOnce(
  "const w5FoundItemsWorkerPath = path.join(root, 'scripts/w5-5-found-items-worker-manifest.json')",
  "const w5FoundItemsWorkerPath = path.join(root, 'scripts/w5-5-found-items-worker-manifest.json')\nconst catalogGenderScopeR1Path = path.join(root, 'scripts/catalog-gender-scope-r1-worker-manifest.json')",
  'manifest path',
)
replaceOnce(
  `  const w5FoundItemsChanges = w5FoundItemsWorker?.changes || {}\n  const w5FoundItemsAdded = w5FoundItemsWorker?.added || {}`,
  `  const w5FoundItemsChanges = w5FoundItemsWorker?.changes || {}\n  const w5FoundItemsAdded = w5FoundItemsWorker?.added || {}\n  check(fs.existsSync(catalogGenderScopeR1Path), 'Catalog gender scope R1 Worker manifest missing')\n  const catalogGenderScopeR1 = JSON.parse(fs.readFileSync(catalogGenderScopeR1Path, 'utf8'))\n  check(catalogGenderScopeR1?.version === 1 && catalogGenderScopeR1?.revision === 'catalog-gender-scope-r1', 'Catalog gender scope R1 Worker manifest invalid')\n  const catalogGenderScopeR1Changes = catalogGenderScopeR1.changes || {}\n  const catalogGenderScopeR1Added = catalogGenderScopeR1.added || {}`,
  'manifest load',
)
replaceOnce(
  `  const expectedDeclarationCount = manifest.declarationCount - removedNames.length + Object.keys(warehouseTruthFreshnessAdded).length + Object.keys(warehouseAttentionTruthAdded).length + Object.keys(dailyWarehouseAdded).length + Object.keys(attentionContextAdded).length + Object.keys(orderCreateSaveIntegrityAdded).length + Object.keys(orderDeleteMobilityAdded).length + Object.keys(returnExchangeCancelAutonomyAdded).length + Object.keys(w5FoundItemsAdded).length`,
  `  const expectedDeclarationCount = manifest.declarationCount - removedNames.length + Object.keys(warehouseTruthFreshnessAdded).length + Object.keys(warehouseAttentionTruthAdded).length + Object.keys(dailyWarehouseAdded).length + Object.keys(attentionContextAdded).length + Object.keys(orderCreateSaveIntegrityAdded).length + Object.keys(orderDeleteMobilityAdded).length + Object.keys(returnExchangeCancelAutonomyAdded).length + Object.keys(w5FoundItemsAdded).length + Object.keys(catalogGenderScopeR1Added).length`,
  'declaration count',
)
replaceOnce(
  `  for (const [name, expectedHash] of Object.entries(w5FoundItemsAdded)) {\n    check(declarations.has(name), \`W5.5 added Worker declaration missing: \${name}\`)\n    check(sha(declarations.get(name)) === expectedHash, \`W5.5 added Worker declaration changed: \${name}\`)\n  }`,
  `  for (const [name, expectedHash] of Object.entries(w5FoundItemsAdded)) {\n    check(declarations.has(name), \`W5.5 added Worker declaration missing: \${name}\`)\n    check(sha(declarations.get(name)) === expectedHash, \`W5.5 added Worker declaration changed: \${name}\`)\n  }\n\n  for (const [name, expectedHash] of Object.entries(catalogGenderScopeR1Added)) {\n    check(declarations.has(name), \`Catalog gender scope R1 added Worker declaration missing: \${name}\`)\n    check(sha(declarations.get(name)) === expectedHash, \`Catalog gender scope R1 added Worker declaration changed: \${name}\`)\n  }`,
  'added declarations verification',
)

const routerAnchor = `  // Shipping hotfix 2026-09-01: normalize only this retired final-shipping blocker\n  // back to the accepted router baseline. The shipping regression requires it absent live.\n  const w5RevertedRouter = w5FoundItemsWorker ? currentRouter`
const routerLayer = `  // Catalog gender scope R1 changes only the product create/update request shapes.\n  // Reverse exactly those two type additions before feeding the router into prior W5 gates.\n  check(sha(currentRouter) === catalogGenderScopeR1.router.after, 'Catalog gender scope R1 Worker router changed beyond exact delta')\n  const catalogGenderRevertedRouter = currentRouter\n    .replace(\n      "const input = await readJson<{ name?: unknown; category?: unknown; genderScope?: unknown }>(request);",\n      "const input = await readJson<{ name?: unknown; category?: unknown }>(request);",\n    )\n    .replace(\n      "const input = await readJson<{ name?: unknown; category?: unknown; genderScope?: unknown; isActive?: unknown }>(request);",\n      "const input = await readJson<{ name?: unknown; category?: unknown; isActive?: unknown }>(request);",\n    )\n  check(sha(catalogGenderRevertedRouter) === catalogGenderScopeR1.router.before, 'Catalog gender scope R1 Worker router reverse baseline mismatch')\n\n  // Shipping hotfix 2026-09-01: normalize only this retired final-shipping blocker\n  // back to the accepted router baseline. The shipping regression requires it absent live.\n  const w5RevertedRouter = w5FoundItemsWorker ? catalogGenderRevertedRouter`
replaceOnce(routerAnchor, routerLayer, 'catalog router pre-layer')
replaceOnce(
  `    : currentRouter\n  if (w5FoundItemsWorker) {\n    check(sha(currentRouter) === w5FoundItemsWorker.router.after, 'W5.5 Worker router changed beyond exact found-items delta')`,
  `    : catalogGenderRevertedRouter\n  if (w5FoundItemsWorker) {\n    check(sha(catalogGenderRevertedRouter) === w5FoundItemsWorker.router.after, 'W5.5 Worker router changed beyond exact found-items delta')`,
  'w5 router source',
)

fs.writeFileSync(legacyPath, source)
console.log('Catalog gender scope R1 exact Step 190.6A declaration/router layer generated.')
