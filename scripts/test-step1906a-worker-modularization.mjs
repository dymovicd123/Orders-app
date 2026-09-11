import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const legacyPath = path.join(root, 'scripts/test-step1906a-worker-modularization-legacy.mjs')
const manifestPath = path.join(root, 'scripts/order-edit-safe-payment-corrections-worker-manifest.json')
const catalogGenderManifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-worker-manifest.json')
const orderHistoryManifestPath = path.join(root, 'scripts/catalog-order-history-preservation-worker-manifest.json')
const original = fs.readFileSync(legacyPath, 'utf8')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction Worker manifest invalid')
if (Object.keys(manifest.changes || {}).join(',') !== 'OrderInput,updateOrderCritical') throw new Error('Safe payment correction Worker declaration allow-list widened unexpectedly')
const catalogGenderManifest = JSON.parse(fs.readFileSync(catalogGenderManifestPath, 'utf8'))
if (catalogGenderManifest?.version !== 1 || catalogGenderManifest?.revision !== 'catalog-gender-scope-r1') throw new Error('Catalog gender scope R1 Worker manifest invalid')
const orderHistoryManifest = JSON.parse(fs.readFileSync(orderHistoryManifestPath, 'utf8'))
if (orderHistoryManifest?.version !== 1 || orderHistoryManifest?.revision !== 'catalog-order-history-preservation-r1') throw new Error('Catalog order-history preservation Worker manifest invalid')
if (Object.keys(orderHistoryManifest.changes || {}).sort().join(',') !== 'getOrder,listOpenDebtOrders,listOrders') throw new Error('Catalog order-history preservation Worker allow-list widened unexpectedly')

const o1Anchor = "const o1Changes = JSON.parse(fs.readFileSync(path.join(root, 'scripts/o1-worker-manifest.json'), 'utf8')).changed\n"
const oldBlock = `    const o1Changed = o1Changes[name]\n    if (o1Changed) check(o1Changed.before === acceptedPostW5FoundItemsHash, \`O1 baseline mismatch: \${name}\`)\n    check(\n      sha(declarations.get(name)) === (o1Changed ? o1Changed.after : acceptedPostW5FoundItemsHash),\n      w5FoundItemsChanged\n        ? \`Worker declaration changed beyond exact W5.5 found-items allow-list: \${name}\`\n        : \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`,\n    )\n`
const newBlock = `    const o1Changed = o1Changes[name]\n    let acceptedPostO1Hash = acceptedPostW5FoundItemsHash\n    if (o1Changed) {\n      check(o1Changed.before === acceptedPostW5FoundItemsHash, \`O1 baseline mismatch: \${name}\`)\n      acceptedPostO1Hash = o1Changed.after\n    }\n    const safePaymentCorrectionChanged = safePaymentCorrectionChanges[name]\n    let acceptedPostSafePaymentCorrectionHash = acceptedPostO1Hash\n    if (safePaymentCorrectionChanged) {\n      check(safePaymentCorrectionChanged.before === acceptedPostO1Hash, \`Safe payment correction baseline hash mismatch: \${name}\`)\n      acceptedPostSafePaymentCorrectionHash = safePaymentCorrectionChanged.after\n    }\n    const catalogGenderScopeR1Changed = catalogGenderScopeR1Changes[name]\n    let acceptedPostCatalogGenderScopeR1Hash = acceptedPostSafePaymentCorrectionHash\n    if (catalogGenderScopeR1Changed) {\n      check(catalogGenderScopeR1Changed.before === acceptedPostSafePaymentCorrectionHash, \`Catalog gender scope R1 baseline hash mismatch: \${name}\`)\n      acceptedPostCatalogGenderScopeR1Hash = catalogGenderScopeR1Changed.after\n    }\n    const orderHistoryPreservationChanged = orderHistoryPreservationChanges[name]\n    let acceptedPostOrderHistoryPreservationHash = acceptedPostCatalogGenderScopeR1Hash\n    if (orderHistoryPreservationChanged) {\n      check(orderHistoryPreservationChanged.before === acceptedPostCatalogGenderScopeR1Hash, \`Order-history preservation baseline hash mismatch: \${name}\`)\n      acceptedPostOrderHistoryPreservationHash = orderHistoryPreservationChanged.after\n    }\n    check(\n      sha(declarations.get(name)) === acceptedPostOrderHistoryPreservationHash,\n      orderHistoryPreservationChanged\n        ? \`Worker declaration changed beyond exact order-history preservation allow-list: \${name}\`\n        : (catalogGenderScopeR1Changed\n          ? \`Worker declaration changed beyond exact catalog gender scope R1 allow-list: \${name}\`\n          : (safePaymentCorrectionChanged\n            ? \`Worker declaration changed beyond exact safe-payment-correction allow-list: \${name}\`\n            : (w5FoundItemsChanged\n              ? \`Worker declaration changed beyond exact W5.5 found-items allow-list: \${name}\`\n              : \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`))),\n    )\n`
if (!original.includes(o1Anchor) || !original.includes(oldBlock)) throw new Error('1906A safe-payment/catalog-gender/order-history layer anchors not found')
const patched = original
  .replace(o1Anchor, `${o1Anchor}const safePaymentCorrectionChanges = ${JSON.stringify(manifest.changes)}\nconst orderHistoryPreservationChanges = ${JSON.stringify(orderHistoryManifest.changes)}\n`)
  .replace(oldBlock, newBlock)
fs.writeFileSync(legacyPath, patched)
try {
  await import('./test-step1906a-worker-modularization-w6-layer.mjs')
} finally {
  fs.writeFileSync(legacyPath, original)
}
