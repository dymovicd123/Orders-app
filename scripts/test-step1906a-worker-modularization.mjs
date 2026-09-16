import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const legacyPath = path.join(root, 'scripts/test-step1906a-worker-modularization-legacy.mjs')
const manifestPath = path.join(root, 'scripts/order-edit-safe-payment-corrections-worker-manifest.json')
const catalogGenderManifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-worker-manifest.json')
const orderHistoryManifestPath = path.join(root, 'scripts/catalog-order-history-preservation-worker-manifest.json')
const catalogIntegrityDeadendsManifestPath = path.join(root, 'scripts/catalog-integrity-deadends-r1-worker-manifest.json')
const catalogUnisexMergeManifestPath = path.join(root, 'scripts/catalog-unisex-merge-r1-worker-manifest.json')
const operationalAutonomyR3ManifestPath = path.join(root, 'scripts/operational-autonomy-r3-worker-manifest.json')
const operationalAutonomyA4ManifestPath = path.join(root, 'scripts/operational-autonomy-a4-worker-manifest.json')
const operationalAutonomyA5ManifestPath = path.join(root, 'scripts/operational-autonomy-a5-worker-manifest.json')
const d1ReadBudgetR63ManifestPath = path.join(root, 'scripts/d1-read-budget-r6-3-worker-manifest.json')
const dashboardWorkshopAttentionManifestPath = path.join(root, 'scripts/dashboard-workshop-attention-r1-worker-manifest.json')
const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-worker-manifest.json')
const stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-worker-manifest.json')
const stabilizationR2ManifestPath = path.join(root, 'scripts/stabilization-20260912-r2-manager-date-worker-manifest.json')
const businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-worker-manifest.json')
const clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-worker-manifest.json')
const contextualCatalogResolutionManifestPath = path.join(root, 'scripts/contextual-catalog-resolution-r1-worker-manifest.json')
const arrivalCanonicalProductAliasManifestPath = path.join(root, 'scripts/arrival-canonical-product-alias-r1-worker-manifest.json')
const original = fs.readFileSync(legacyPath, 'utf8')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction Worker manifest invalid')
if (Object.keys(manifest.changes || {}).join(',') !== 'OrderInput,updateOrderCritical') throw new Error('Safe payment correction Worker declaration allow-list widened unexpectedly')
const catalogGenderManifest = JSON.parse(fs.readFileSync(catalogGenderManifestPath, 'utf8'))
if (catalogGenderManifest?.version !== 1 || catalogGenderManifest?.revision !== 'catalog-gender-scope-r1') throw new Error('Catalog gender scope R1 Worker manifest invalid')
const orderHistoryManifest = JSON.parse(fs.readFileSync(orderHistoryManifestPath, 'utf8'))
if (orderHistoryManifest?.version !== 1 || orderHistoryManifest?.revision !== 'catalog-order-history-preservation-r1') throw new Error('Catalog order-history preservation Worker manifest invalid')
if (Object.keys(orderHistoryManifest.changes || {}).sort().join(',') !== 'getOrder,listOpenDebtOrders,listOrders') throw new Error('Catalog order-history preservation Worker allow-list widened unexpectedly')
const catalogIntegrityDeadendsManifest = JSON.parse(fs.readFileSync(catalogIntegrityDeadendsManifestPath, 'utf8'))
if (catalogIntegrityDeadendsManifest?.version !== 1 || catalogIntegrityDeadendsManifest?.revision !== 'catalog-integrity-deadends-r1') throw new Error('Catalog integrity dead-ends R1 Worker manifest invalid')
if (Object.keys(catalogIntegrityDeadendsManifest.changes || {}).sort().join(',') !== 'listInventory,resolveInventoryCreatableItemsBulk') throw new Error('Catalog integrity dead-ends R1 Worker allow-list widened unexpectedly')
const catalogUnisexMergeManifest = JSON.parse(fs.readFileSync(catalogUnisexMergeManifestPath, 'utf8'))
if (catalogUnisexMergeManifest?.version !== 1 || catalogUnisexMergeManifest?.revision !== 'catalog-unisex-merge-r1') throw new Error('Catalog unisex merge R1 Worker manifest invalid')
if (Object.keys(catalogUnisexMergeManifest.changes || {}).sort().join(',') !== 'findCatalogCombinationV3,updateCatalogVariant') throw new Error('Catalog unisex merge R1 Worker allow-list widened unexpectedly')
const operationalAutonomyR3Manifest = JSON.parse(fs.readFileSync(operationalAutonomyR3ManifestPath, 'utf8'))
if (operationalAutonomyR3Manifest?.version !== 1 || operationalAutonomyR3Manifest?.revision !== 'operational-autonomy-r3-return-exchange-capacity-r1') throw new Error('Operational Autonomy R3 Worker manifest invalid')
if (Object.keys(operationalAutonomyR3Manifest.changes || {}).sort().join(',') !== 'cancelReturn,createExchange,createReturn') throw new Error('Operational Autonomy R3 Worker allow-list widened unexpectedly')
const operationalAutonomyA4Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA4ManifestPath, 'utf8'))
if (operationalAutonomyA4Manifest?.version !== 1 || operationalAutonomyA4Manifest?.revision !== 'operational-autonomy-a4-mistaken-handover-r1') throw new Error('Operational Autonomy A4 Worker manifest invalid')
if (Object.keys(operationalAutonomyA4Manifest.changes || {}).join(',') !== 'deleteOrderSafely') throw new Error('Operational Autonomy A4 Worker change allow-list widened unexpectedly')
if (Object.keys(operationalAutonomyA4Manifest.added || {}).join(',') !== 'correctMistakenOrderHandover') throw new Error('Operational Autonomy A4 Worker added allow-list widened unexpectedly')
const operationalAutonomyA5Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA5ManifestPath, 'utf8'))
if (operationalAutonomyA5Manifest?.version !== 1 || operationalAutonomyA5Manifest?.revision !== 'operational-autonomy-a5-exchange-financial-correction-r1') throw new Error('Operational Autonomy A5 Worker manifest invalid')
if (Object.keys(operationalAutonomyA5Manifest.changes || {}).length !== 0) throw new Error('Operational Autonomy A5 Worker changed allow-list widened unexpectedly')
if (Object.keys(operationalAutonomyA5Manifest.added || {}).join(',') !== 'correctExchangeFinancials') throw new Error('Operational Autonomy A5 Worker added allow-list widened unexpectedly')
if (!operationalAutonomyA5Manifest.router?.block) throw new Error('Operational Autonomy A5 Worker route block missing')
const d1ReadBudgetR63Manifest = JSON.parse(fs.readFileSync(d1ReadBudgetR63ManifestPath, 'utf8'))
if (d1ReadBudgetR63Manifest?.version !== 1 || d1ReadBudgetR63Manifest?.revision !== 'd1-read-budget-r6-3-manager-summary-reuse-r1') throw new Error('D1 read budget R6.3 Worker manifest invalid')
if (Object.keys(d1ReadBudgetR63Manifest.changes || {}).join(',') !== 'listFinanceReports') throw new Error('D1 read budget R6.3 Worker allow-list widened unexpectedly')
const dashboardWorkshopAttentionManifest = JSON.parse(fs.readFileSync(dashboardWorkshopAttentionManifestPath, 'utf8'))
if (dashboardWorkshopAttentionManifest?.version !== 1 || dashboardWorkshopAttentionManifest?.revision !== 'dashboard-workshop-attention-r1') throw new Error('Dashboard workshop attention R1 Worker manifest invalid')
if (Object.keys(dashboardWorkshopAttentionManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listWorkshopTasks') throw new Error('Dashboard workshop attention R1 Worker allow-list widened unexpectedly')
const returnsPhysicalIntakeManifest = JSON.parse(fs.readFileSync(returnsPhysicalIntakeManifestPath, 'utf8'))
if (returnsPhysicalIntakeManifest?.version !== 1 || returnsPhysicalIntakeManifest?.revision !== 'returns-physical-intake-r1') throw new Error('Returns physical intake R1 Worker manifest invalid')
if (Object.keys(returnsPhysicalIntakeManifest.changes || {}).sort().join(',') !== 'createExchange,createReturn,listExchanges,listReturnHistory') throw new Error('Returns physical intake R1 Worker change allow-list widened unexpectedly')
if (Object.keys(returnsPhysicalIntakeManifest.added || {}).join(',') !== 'receiveReturnedItem') throw new Error('Returns physical intake R1 Worker added allow-list widened unexpectedly')
if (!returnsPhysicalIntakeManifest.router?.block) throw new Error('Returns physical intake R1 Worker route block missing')
const stabilizationManifest = JSON.parse(fs.readFileSync(stabilizationManifestPath, 'utf8'))
if (stabilizationManifest?.version !== 1 || stabilizationManifest?.revision !== 'stabilization-20260912-r1') throw new Error('September 12 stabilization Worker manifest invalid')
if (Object.keys(stabilizationManifest.changes || {}).sort().join(',') !== 'createReturn,getDashboardInsights,listWorkshopTasks,readWorkshopCounts,workshopStandaloneReturnOrdersCte') throw new Error('September 12 stabilization Worker allow-list widened unexpectedly')
const stabilizationR2Manifest = JSON.parse(fs.readFileSync(stabilizationR2ManifestPath, 'utf8'))
if (stabilizationR2Manifest?.version !== 1 || stabilizationR2Manifest?.revision !== 'stabilization-20260912-r2-manager-date') throw new Error('September 12 R2 manager/date Worker manifest invalid')
if (Object.keys(stabilizationR2Manifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('September 12 R2 manager/date Worker allow-list widened unexpectedly')
const businessDateBoundaryManifest = JSON.parse(fs.readFileSync(businessDateBoundaryManifestPath, 'utf8'))
if (businessDateBoundaryManifest?.version !== 1 || businessDateBoundaryManifest?.revision !== 'business-date-boundaries-r1') throw new Error('Business date boundary Worker manifest invalid')
if (Object.keys(businessDateBoundaryManifest.changes || {}).sort().join(',') !== 'normalizeDate,normalizeMonthParam,parseArchiveRules,parseReportDateRange,resolveWorkshopPeriod') throw new Error('Business date boundary Worker allow-list widened unexpectedly')
const clientFixesManifest = JSON.parse(fs.readFileSync(clientFixesManifestPath, 'utf8'))
if (clientFixesManifest?.version !== 1 || clientFixesManifest?.revision !== 'client-fixes-20260912-r1') throw new Error('Client fixes Worker manifest invalid')
if (Object.keys(clientFixesManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('Client fixes Worker allow-list widened unexpectedly')
const contextualCatalogResolutionManifest = JSON.parse(fs.readFileSync(contextualCatalogResolutionManifestPath, 'utf8'))
if (contextualCatalogResolutionManifest?.version !== 1 || contextualCatalogResolutionManifest?.revision !== 'contextual-catalog-resolution-r1') throw new Error('Contextual catalog resolution Worker manifest invalid')
if (Object.keys(contextualCatalogResolutionManifest.added || {}).sort().join(',') !== 'reconcileCatalogReviewOrder,resolveOrderCatalogReviewExistingVariant') throw new Error('Contextual catalog resolution Worker added allow-list widened unexpectedly')
const arrivalCanonicalProductAliasManifest = JSON.parse(fs.readFileSync(arrivalCanonicalProductAliasManifestPath, 'utf8'))
if (arrivalCanonicalProductAliasManifest?.version !== 1 || arrivalCanonicalProductAliasManifest?.revision !== 'arrival-canonical-product-alias-r1') throw new Error('Arrival canonical product alias R1 Worker manifest invalid')
if (Object.keys(arrivalCanonicalProductAliasManifest.changes || {}).join(',') !== 'resolveInventoryCreatableItemsBulk') throw new Error('Arrival canonical product alias R1 Worker allow-list widened unexpectedly')
const operationalAutonomyA4RouteBlock = "\n\n      const orderShippingCorrectionMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping\\/correct$/);\n      if (orderShippingCorrectionMatch && request.method === 'POST') {\n        const id = toInt(orderShippingCorrectionMatch[1], 0);\n        const input = await readJson<{ physicalOutcome?: unknown }>(request);\n        try {\n          const result = await correctMistakenOrderHandover(env.DB, id, {\n            physicalOutcome: input.physicalOutcome,\n            actor: cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role')),\n          });\n          let updatedOrder = null;\n          try {\n            updatedOrder = await getOrder(env.DB, id);\n          } catch (error) {\n            console.warn('Order readback after handover correction failed', error);\n          }\n          return json({ ...result, ...(updatedOrder ? { order: updatedOrder } : {}), refreshRequired: !updatedOrder });\n        } catch (error) {\n          const publicError = publicApiError(error);\n          return json({ ok: false, ...(publicError.code ? { code: publicError.code } : {}), message: publicError.message }, { status: publicError.status });\n        }\n      }\n"

const o1Anchor = "const o1Changes = JSON.parse(fs.readFileSync(path.join(root, 'scripts/o1-worker-manifest.json'), 'utf8')).changed\n"
const oldBlock = `    const o1Changed = o1Changes[name]\n    if (o1Changed) check(o1Changed.before === acceptedPostW5FoundItemsHash, \`O1 baseline mismatch: \${name}\`)\n    check(\n      sha(declarations.get(name)) === (o1Changed ? o1Changed.after : acceptedPostW5FoundItemsHash),\n      w5FoundItemsChanged\n        ? \`Worker declaration changed beyond exact W5.5 found-items allow-list: \${name}\`\n        : \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`,\n    )\n`
const newBlock = `    const o1Changed = o1Changes[name]\n    let acceptedPostO1Hash = acceptedPostW5FoundItemsHash\n    if (o1Changed) {\n      check(o1Changed.before === acceptedPostW5FoundItemsHash, \`O1 baseline mismatch: \${name}\`)\n      acceptedPostO1Hash = o1Changed.after\n    }\n    const safePaymentCorrectionChanged = safePaymentCorrectionChanges[name]\n    let acceptedPostSafePaymentCorrectionHash = acceptedPostO1Hash\n    if (safePaymentCorrectionChanged) {\n      check(safePaymentCorrectionChanged.before === acceptedPostO1Hash, \`Safe payment correction baseline hash mismatch: \${name}\`)\n      acceptedPostSafePaymentCorrectionHash = safePaymentCorrectionChanged.after\n    }\n    const catalogGenderScopeR1Changed = catalogGenderScopeR1Changes[name]\n    let acceptedPostCatalogGenderScopeR1Hash = acceptedPostSafePaymentCorrectionHash\n    if (catalogGenderScopeR1Changed) {\n      check(catalogGenderScopeR1Changed.before === acceptedPostSafePaymentCorrectionHash, \`Catalog gender scope R1 baseline hash mismatch: \${name}\`)\n      acceptedPostCatalogGenderScopeR1Hash = catalogGenderScopeR1Changed.after\n    }\n    const orderHistoryPreservationChanged = orderHistoryPreservationChanges[name]\n    let acceptedPostOrderHistoryPreservationHash = acceptedPostCatalogGenderScopeR1Hash\n    if (orderHistoryPreservationChanged) {\n      check(orderHistoryPreservationChanged.before === acceptedPostCatalogGenderScopeR1Hash, \`Order-history preservation baseline hash mismatch: \${name}\`)\n      acceptedPostOrderHistoryPreservationHash = orderHistoryPreservationChanged.after\n    }\n    const catalogIntegrityDeadendsChanged = catalogIntegrityDeadendsChanges[name]\n    let acceptedPostCatalogIntegrityDeadendsHash = acceptedPostOrderHistoryPreservationHash\n    if (catalogIntegrityDeadendsChanged) {\n      check(catalogIntegrityDeadendsChanged.before === acceptedPostOrderHistoryPreservationHash, \`Catalog integrity dead-ends R1 baseline hash mismatch: \${name}\`)\n      acceptedPostCatalogIntegrityDeadendsHash = catalogIntegrityDeadendsChanged.after\n    }\n    const catalogUnisexMergeChanged = catalogUnisexMergeChanges[name]\n    let acceptedPostCatalogUnisexMergeHash = acceptedPostCatalogIntegrityDeadendsHash\n    if (catalogUnisexMergeChanged) {\n      check(catalogUnisexMergeChanged.before === acceptedPostCatalogIntegrityDeadendsHash, \`Catalog unisex merge R1 baseline hash mismatch: \${name}\`)\n      acceptedPostCatalogUnisexMergeHash = catalogUnisexMergeChanged.after\n    }\n    check(\n      sha(declarations.get(name)) === acceptedPostCatalogUnisexMergeHash,\n      catalogUnisexMergeChanged\n        ? \`Worker declaration changed beyond exact catalog unisex merge R1 allow-list: \${name}\`\n        : (catalogIntegrityDeadendsChanged\n          ? \`Worker declaration changed beyond exact catalog integrity dead-ends R1 allow-list: \${name}\`\n          : (orderHistoryPreservationChanged\n            ? \`Worker declaration changed beyond exact order-history preservation allow-list: \${name}\`\n            : (catalogGenderScopeR1Changed\n              ? \`Worker declaration changed beyond exact catalog gender scope R1 allow-list: \${name}\`\n              : (safePaymentCorrectionChanged\n                ? \`Worker declaration changed beyond exact safe-payment-correction allow-list: \${name}\`\n                : (w5FoundItemsChanged\n                  ? \`Worker declaration changed beyond exact W5.5 found-items allow-list: \${name}\`\n                  : \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`))))),\n    )\n`
if (!original.includes(o1Anchor) || !original.includes(oldBlock)) throw new Error('1906A safe-payment/catalog-gender/order-history/catalog-integrity/unisex-merge layer anchors not found')
let patched = original
  .replace(o1Anchor, `${o1Anchor}const safePaymentCorrectionChanges = ${JSON.stringify(manifest.changes)}\nconst orderHistoryPreservationChanges = ${JSON.stringify(orderHistoryManifest.changes)}\nconst catalogIntegrityDeadendsChanges = ${JSON.stringify(catalogIntegrityDeadendsManifest.changes)}\nconst catalogUnisexMergeChanges = ${JSON.stringify({ findCatalogCombinationV3: catalogUnisexMergeManifest.changes.findCatalogCombinationV3, ...operationalAutonomyR3Manifest.changes })}\nconst operationalAutonomyA4Changes = ${JSON.stringify(operationalAutonomyA4Manifest.changes || {})}\nconst operationalAutonomyA4Added = ${JSON.stringify(operationalAutonomyA4Manifest.added || {})}\nconst operationalAutonomyA4Router = ${JSON.stringify(operationalAutonomyA4Manifest.router || {})}\nconst operationalAutonomyA4RouteBlock = ${JSON.stringify(operationalAutonomyA4RouteBlock)}\n`)
  .replace(oldBlock, newBlock)
patched = patched
  .replace(" + Object.keys(catalogGenderScopeR1Added).length", " + Object.keys(catalogGenderScopeR1Added).length + Object.keys(operationalAutonomyA4Added).length")
  .replace("  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {\n    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)\n    check(sha(declarations.get(name)) === expectedHash, `Order delete mobility declaration changed beyond exact allow-list: ${name}`)\n  }", "  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {\n    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)\n    const operationalAutonomyA4Changed = operationalAutonomyA4Changes[name]\n    let acceptedHash = expectedHash\n    if (operationalAutonomyA4Changed) {\n      check(operationalAutonomyA4Changed.before === acceptedHash, `Operational Autonomy A4 order-delete baseline hash mismatch: ${name}`)\n      acceptedHash = operationalAutonomyA4Changed.after\n    }\n    check(sha(declarations.get(name)) === acceptedHash, operationalAutonomyA4Changed\n      ? `Order delete mobility declaration changed beyond exact Operational Autonomy A4 allow-list: ${name}`\n      : `Order delete mobility declaration changed beyond exact allow-list: ${name}`)\n  }")
  .replace("  // Catalog gender scope R1 changes only the product create/update request shapes.", "  for (const [name, expectedHash] of Object.entries(operationalAutonomyA4Added)) {\n    check(declarations.has(name), `Operational Autonomy A4 added Worker declaration missing: ${name}`)\n    check(sha(declarations.get(name)) === expectedHash, `Operational Autonomy A4 added Worker declaration changed: ${name}`)\n  }\n\n  // Catalog gender scope R1 changes only the product create/update request shapes.")
  .replace("  check(sha(currentRouter) === catalogGenderScopeR1.router.after, 'Catalog gender scope R1 Worker router changed beyond exact delta')\n  const catalogGenderRevertedRouter = currentRouter", "  check(sha(currentRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 raw Worker router changed beyond exact delta')\n  const operationalAutonomyA4RevertedRouter = currentRouter.replace(operationalAutonomyA4RouteBlock, '')\n  check(sha(operationalAutonomyA4RevertedRouter) === operationalAutonomyA4Router.before, 'Operational Autonomy A4 Worker router reverse baseline mismatch')\n  check(sha(operationalAutonomyA4RevertedRouter) === catalogGenderScopeR1.router.after, 'Catalog gender scope R1 Worker router changed beyond exact delta')\n  const catalogGenderRevertedRouter = operationalAutonomyA4RevertedRouter")
const a4InjectedAnchor = 'const operationalAutonomyA4RouteBlock = ' + JSON.stringify(operationalAutonomyA4RouteBlock) + '\n'
if (!patched.includes(a4InjectedAnchor)) throw new Error('1906A A5 injected A4 anchor missing')
patched = patched.replace(a4InjectedAnchor, a4InjectedAnchor + 'const operationalAutonomyA5Added = ' + JSON.stringify(operationalAutonomyA5Manifest.added || {}) + '\n' + 'const operationalAutonomyA5Router = ' + JSON.stringify(operationalAutonomyA5Manifest.router || {}) + '\n')
patched = patched.replace(' + Object.keys(operationalAutonomyA4Added).length', ' + Object.keys(operationalAutonomyA4Added).length + Object.keys(operationalAutonomyA5Added).length')
const catalogCommentAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'
if (!patched.includes(catalogCommentAnchor)) throw new Error('1906A A5 added-declaration anchor missing')
const a5AddedBlock = [
  '  for (const [name, expectedHash] of Object.entries(operationalAutonomyA5Added)) {',
  "    check(declarations.has(name), 'Operational Autonomy A5 added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Operational Autonomy A5 added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
patched = patched.replace(catalogCommentAnchor, a5AddedBlock + catalogCommentAnchor)
const a4RouterAnchor = "  check(sha(currentRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 raw Worker router changed beyond exact delta')\n  const operationalAutonomyA4RevertedRouter = currentRouter.replace(operationalAutonomyA4RouteBlock, '')"
if (!patched.includes(a4RouterAnchor)) throw new Error('1906A A5 router anchor missing')
const a5RouterBlock = [
  "  check(sha(currentRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 raw Worker router changed beyond exact delta')",
  "  const operationalAutonomyA5RevertedRouter = currentRouter.replace(operationalAutonomyA5Router.block, '')",
  "  check(sha(operationalAutonomyA5RevertedRouter) === operationalAutonomyA5Router.before, 'Operational Autonomy A5 Worker router reverse baseline mismatch')",
  "  check(sha(operationalAutonomyA5RevertedRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 Worker router changed beneath A5')",
  "  const operationalAutonomyA4RevertedRouter = operationalAutonomyA5RevertedRouter.replace(operationalAutonomyA4RouteBlock, '')",
].join('\n')
patched = patched.replace(a4RouterAnchor, a5RouterBlock)

const r63InjectedAnchor = 'const operationalAutonomyA4RouteBlock = ' + JSON.stringify(operationalAutonomyA4RouteBlock) + '\n'
if (!patched.includes(r63InjectedAnchor)) throw new Error('1906A R6.3 injected anchor missing')
patched = patched.replace(r63InjectedAnchor, r63InjectedAnchor + 'const d1ReadBudgetR63Changes = ' + JSON.stringify(d1ReadBudgetR63Manifest.changes || {}) + '\n' + 'const dashboardWorkshopAttentionChanges = ' + JSON.stringify(dashboardWorkshopAttentionManifest.changes || {}) + '\n')
const r63CheckAnchor = '    check(\n      sha(declarations.get(name)) === acceptedPostCatalogUnisexMergeHash,\n'
if (!patched.includes(r63CheckAnchor)) throw new Error('1906A R6.3 declaration check anchor missing')
const r63CheckReplacement = [
  '    check(',
  '      (() => {',
  '        const d1ReadBudgetR63Changed = d1ReadBudgetR63Changes[name]',
  '        let acceptedPostR63Hash = acceptedPostCatalogUnisexMergeHash',
  '        if (d1ReadBudgetR63Changed) {',
  "          check(d1ReadBudgetR63Changed.before === acceptedPostCatalogUnisexMergeHash, 'D1 read budget R6.3 baseline hash mismatch: ' + name)",
  '          acceptedPostR63Hash = d1ReadBudgetR63Changed.after',
  '        }',
  '        const dashboardWorkshopAttentionChanged = dashboardWorkshopAttentionChanges[name]',
  '        let acceptedPostDashboardAttentionHash = acceptedPostR63Hash',
  '        if (dashboardWorkshopAttentionChanged) {',
  "          check(dashboardWorkshopAttentionChanged.before === acceptedPostR63Hash, 'Dashboard workshop attention R1 baseline hash mismatch: ' + name)",
  '          acceptedPostDashboardAttentionHash = dashboardWorkshopAttentionChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostDashboardAttentionHash',
  '      })(),',
].join('\n') + '\n'
patched = patched.replace(r63CheckAnchor, r63CheckReplacement)

// Returns physical intake R1 is a final narrow layer over the accepted dashboard baseline.
const physicalChangesLine = /const dashboardWorkshopAttentionChanges = [^\n]+\n/
if (!physicalChangesLine.test(patched)) throw new Error('1906A physical intake injected dashboard changes anchor missing')
patched = patched.replace(physicalChangesLine, (match) => match
  + 'const returnsPhysicalIntakeChanges = ' + JSON.stringify(returnsPhysicalIntakeManifest.changes || {}) + '\n'
  + 'const returnsPhysicalIntakeAdded = ' + JSON.stringify(returnsPhysicalIntakeManifest.added || {}) + '\n'
  + 'const returnsPhysicalIntakeRouter = ' + JSON.stringify(returnsPhysicalIntakeManifest.router || {}) + '\n'
  + 'const stabilizationChanges = ' + JSON.stringify(stabilizationManifest.changes || {}) + '\n'
  + 'const stabilizationR2Changes = ' + JSON.stringify(stabilizationR2Manifest.changes || {}) + '\n'
  + 'const businessDateBoundaryChanges = ' + JSON.stringify(businessDateBoundaryManifest.changes || {}) + '\n'
  + 'const clientFixesChanges = ' + JSON.stringify(clientFixesManifest.changes || {}) + '\n'
  + 'const contextualCatalogResolutionAdded = ' + JSON.stringify(contextualCatalogResolutionManifest.added || {}) + '\n'
  + 'const contextualCatalogResolutionRouter = ' + JSON.stringify(contextualCatalogResolutionManifest.router || {}) + '\n'
  + 'const arrivalCanonicalProductAliasChanges = ' + JSON.stringify(arrivalCanonicalProductAliasManifest.changes || {}) + '\n')

const physicalCountAnchor = ' + Object.keys(operationalAutonomyA5Added).length'
if (!patched.includes(physicalCountAnchor)) throw new Error('1906A physical intake declaration-count anchor missing')
patched = patched.replace(physicalCountAnchor, physicalCountAnchor + ' + Object.keys(returnsPhysicalIntakeAdded).length + Object.keys(contextualCatalogResolutionAdded).length')

const dashboardHashReturn = '        return sha(declarations.get(name)) === acceptedPostDashboardAttentionHash\n'
if (!patched.includes(dashboardHashReturn)) throw new Error('1906A physical intake dashboard hash anchor missing')
patched = patched.replace(dashboardHashReturn, [
  '        const returnsPhysicalIntakeChanged = returnsPhysicalIntakeChanges[name]',
  '        let acceptedPostReturnsPhysicalIntakeHash = acceptedPostDashboardAttentionHash',
  '        if (returnsPhysicalIntakeChanged) {',
  "          check(returnsPhysicalIntakeChanged.before === acceptedPostDashboardAttentionHash, 'Returns physical intake R1 baseline hash mismatch: ' + name)",
  '          acceptedPostReturnsPhysicalIntakeHash = returnsPhysicalIntakeChanged.after',
  '        }',
  '        const stabilizationChanged = stabilizationChanges[name]',
  '        let acceptedPostStabilizationHash = acceptedPostReturnsPhysicalIntakeHash',
  '        if (stabilizationChanged) {',
  "          check(stabilizationChanged.before === acceptedPostReturnsPhysicalIntakeHash, 'September 12 stabilization baseline hash mismatch: ' + name)",
  '          acceptedPostStabilizationHash = stabilizationChanged.after',
  '        }',
  '        const stabilizationR2Changed = stabilizationR2Changes[name]',
  '        let acceptedPostStabilizationR2Hash = acceptedPostStabilizationHash',
  '        if (stabilizationR2Changed) {',
  "          check(stabilizationR2Changed.before === acceptedPostStabilizationHash, 'September 12 R2 manager/date baseline hash mismatch: ' + name)",
  '          acceptedPostStabilizationR2Hash = stabilizationR2Changed.after',
  '        }',
  '        const businessDateBoundaryChanged = businessDateBoundaryChanges[name]',
  '        let acceptedPostBusinessDateBoundaryHash = acceptedPostStabilizationR2Hash',
  '        if (businessDateBoundaryChanged) {',
  "          check(businessDateBoundaryChanged.before === acceptedPostStabilizationR2Hash, 'Business date boundary baseline hash mismatch: ' + name)",
  '          acceptedPostBusinessDateBoundaryHash = businessDateBoundaryChanged.after',
  '        }',
  '        const clientFixesChanged = clientFixesChanges[name]',
  '        let acceptedPostClientFixesHash = acceptedPostBusinessDateBoundaryHash',
  '        if (clientFixesChanged) {',
  "          check(clientFixesChanged.before === acceptedPostBusinessDateBoundaryHash, 'Client fixes baseline hash mismatch: ' + name)",
  '          acceptedPostClientFixesHash = clientFixesChanged.after',
  '        }',
  '        const arrivalCanonicalProductAliasChanged = arrivalCanonicalProductAliasChanges[name]',
  '        let acceptedPostArrivalCanonicalProductAliasHash = acceptedPostClientFixesHash',
  '        if (arrivalCanonicalProductAliasChanged) {',
  "          check(arrivalCanonicalProductAliasChanged.before === acceptedPostClientFixesHash, 'Arrival canonical product alias R1 baseline hash mismatch: ' + name)",
  '          acceptedPostArrivalCanonicalProductAliasHash = arrivalCanonicalProductAliasChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostArrivalCanonicalProductAliasHash',
  '',
].join('\n'))

const contextualAddedBlock = [
  '  for (const [name, expectedHash] of Object.entries(contextualCatalogResolutionAdded)) {',
  "    check(declarations.has(name), 'Contextual catalog resolution added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Contextual catalog resolution added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
const physicalAddedAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'
if (!patched.includes(physicalAddedAnchor)) throw new Error('1906A physical intake added-declaration anchor missing')
const physicalAddedBlock = [
  '  for (const [name, expectedHash] of Object.entries(returnsPhysicalIntakeAdded)) {',
  "    check(declarations.has(name), 'Returns physical intake R1 added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Returns physical intake R1 added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
patched = patched.replace(physicalAddedAnchor, physicalAddedBlock + contextualAddedBlock + physicalAddedAnchor)

const a5RouterAnchor = [
  "  check(sha(currentRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 raw Worker router changed beyond exact delta')",
  "  const operationalAutonomyA5RevertedRouter = currentRouter.replace(operationalAutonomyA5Router.block, '')",
].join('\n')
if (!patched.includes(a5RouterAnchor)) throw new Error('1906A physical intake A5 router anchor missing')
const physicalRouterBlock = [
  "  check(sha(currentRouter) === contextualCatalogResolutionRouter.after, 'Contextual catalog resolution Worker router changed beyond exact delta')",
  "  const contextualCatalogResolutionRevertedRouter = currentRouter.replace(contextualCatalogResolutionRouter.routeBlock, '').replace(contextualCatalogResolutionRouter.shippingAfter, contextualCatalogResolutionRouter.shippingBefore)",
  "  check(sha(contextualCatalogResolutionRevertedRouter) === contextualCatalogResolutionRouter.before, 'Contextual catalog resolution Worker router reverse baseline mismatch')",
  "  check(sha(contextualCatalogResolutionRevertedRouter) === returnsPhysicalIntakeRouter.after, 'Returns physical intake router changed beneath contextual catalog resolution')",
  "  let returnsPhysicalIntakeRevertedRouter = contextualCatalogResolutionRevertedRouter.replace(returnsPhysicalIntakeRouter.block, '')",
  "  for (const routerChange of (returnsPhysicalIntakeRouter.reversions || [])) {",
  "    check(returnsPhysicalIntakeRevertedRouter.includes(routerChange.after), 'Returns physical intake R1 router reversion anchor missing')",
  "    returnsPhysicalIntakeRevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(routerChange.after, routerChange.before)",
  "  }",
  "  check(sha(returnsPhysicalIntakeRevertedRouter) === returnsPhysicalIntakeRouter.before, 'Returns physical intake R1 Worker router reverse baseline mismatch')",
  "  check(sha(returnsPhysicalIntakeRevertedRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 Worker router changed beneath physical intake R1')",
  "  const operationalAutonomyA5RevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(operationalAutonomyA5Router.block, '')",
].join('\n')
patched = patched.replace(a5RouterAnchor, physicalRouterBlock)

// Latest narrow layer: finance day reads and business-date ordering only.
const financeDay = JSON.parse(fs.readFileSync(path.join(root, 'scripts/finance-day-transparency-manifest.json'), 'utf8'))
if (financeDay.revision !== 'finance-day-transparency-r1' || Object.keys(financeDay.changes).join(',') !== 'listFinancialHistory' || Object.keys(financeDay.added).join(',') !== 'readFinanceDay') throw new Error('Finance day Worker allow-list changed')
patched = 'const financeDayChanges = ' + JSON.stringify(financeDay.changes) + '\nconst financeDayAdded = ' + JSON.stringify(financeDay.added) + '\n' + patched
const financeDayCountAnchor = ' + Object.keys(contextualCatalogResolutionAdded).length'
if (!patched.includes(financeDayCountAnchor)) throw new Error('Finance day declaration-count anchor missing')
patched = patched.replace(financeDayCountAnchor, financeDayCountAnchor + ' + Object.keys(financeDayAdded).length')
const financeDayHashAnchor = '        return sha(declarations.get(name)) === acceptedPostArrivalCanonicalProductAliasHash'
if (!patched.includes(financeDayHashAnchor)) throw new Error('Finance day predecessor hash anchor missing')
patched = patched.replace(financeDayHashAnchor, [
  '        const financeDayChanged = financeDayChanges[name]',
  '        let acceptedFinanceDayHash = acceptedPostArrivalCanonicalProductAliasHash',
  '        if (financeDayChanged) {',
  "          check(financeDayChanged.before === acceptedPostArrivalCanonicalProductAliasHash, 'Finance day predecessor drifted: ' + name)",
  '          acceptedFinanceDayHash = financeDayChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedFinanceDayHash',
].join('\n'))
patched = patched.replace(physicalAddedAnchor, [
  '  for (const [name, hash] of Object.entries(financeDayAdded)) {',
  "    check(declarations.has(name) && sha(declarations.get(name)) === hash, 'Finance day added declaration changed: ' + name)",
  '  }',
  physicalAddedAnchor,
].join('\n'))
fs.writeFileSync(legacyPath, patched)
try {
  await import('./test-step1906a-worker-modularization-w6-layer.mjs')
} finally {
  fs.writeFileSync(legacyPath, original)
}
