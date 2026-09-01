import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationsFromText(filename, text) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result = new Map()
  let router = ''
  for (const statement of source.statements) {
    let names = []
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names = [statement.name.text]
    else if (ts.isVariableStatement(statement)) names = statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
    for (const name of names) result.set(name, normalizeMovedDeclaration(statement.getText(source)))
    if (ts.isExportAssignment(statement)) router = statement.getText(source)
  }
  return { declarations: result, router }
}

function normalizeRouter(currentRouter) {
  return currentRouter
    .replace(/\n\s*const orderDeleteMatch = url\.pathname\.match\(\/\^\\\/api\\\/orders\\\/\(\\d\+\)\\\/delete\$\/\);[\s\S]*?(?=\n\s*const orderMatch = url\.pathname\.match)/, '')
    .replace(
      "          const blockers = await getOrderShipmentInventoryBlockers(env.DB, id);",
      `          const handoverReviewBlockers = await orderHandoverReviewBlockers(env.DB, id);
          if (handoverReviewBlockers.length) {
            return json({
              ok: false,
              code: 'stock_handover_review_required',
              message: 'Перед отправкой уточните товары со Склада и Бутика: после даты заказа была физическая ревизия или сверка, поэтому нужно один раз подтвердить, где находился товар в тот момент.',
              items: handoverReviewBlockers,
            }, { status: 409 });
          }
          const blockers = await getOrderShipmentInventoryBlockers(env.DB, id);`,
    )
    .replace(
      "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {\n        return json(await listInventoryCycleCountSuggestions(env.DB, url));\n      }",
      "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {\n        const denied = requireAdminAccess(request);\n        if (denied) return denied;\n        return json(await listInventoryCycleCountSuggestions(env.DB, url));\n      }",
    )
    .replace(/\n\s*returnExchangeCancelAutonomy:\s*'192b2a5',\s*\n/, '\n')
    .replace(/\n\s*orderCreateSaveIntegrity:\s*'192b2a4',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionContextFix:\s*'192b2a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseDailyAttentionUx:\s*'192b2a',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionTruthGates:\s*'192b1',\s*\n/, '\n')
    .replace(/\n\s*catalogTruthFinalizer:\s*'192a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseTruthFreshness:\s*'192a1',\s*\n/, '\n')
    .replace(/\n\s*adminSessionIntegrity:\s*'191f',\s*\n/, '\n')
    .replace(/\n\s*runtimeLimitsAtomicity:\s*'191e',\s*\n/, '\n')
    .replace(/\n\s*transferRuntimeSafety:\s*'191d',\s*\n/, '\n')
    .replace(/\n\s*typeApiBoundaryCleanup:\s*'1906e',\s*\n/, '\n')
    .replace(/\n\s*bundleLazyLoading:\s*'1906d',\s*\n/, '\n')
    .replace(/\n\s*deadLegacyCleanup:\s*'1906c',\s*\n/, '\n')
    .replace(/\n\s*frontendControllerModularization:\s*'1906b',\s*\n/, '\n')
    .replace(/\n\s*structuralModularization:\s*'1906a',\s*\n/, '\n')
}

const lifecyclePath = 'worker/domains/lifecycle.ts'
const workerPath = 'worker/index.ts'
const currentLifecycle = fs.readFileSync(lifecyclePath, 'utf8')
const baseLifecycle = execFileSync('git', ['show', 'origin/main:worker/domains/lifecycle.ts'], { encoding: 'utf8' })
const current = declarationsFromText(lifecyclePath, currentLifecycle)
const base = declarationsFromText(lifecyclePath, baseLifecycle)
const currentWorker = declarationsFromText(workerPath, fs.readFileSync(workerPath, 'utf8'))

for (const name of ['InventoryLifecycleCancellationDisposition', 'inventoryLifecycleCancellationDisposition', 'cancelInventoryLifecycleEvent']) {
  if (!current.declarations.has(name)) throw new Error(`Patched declaration missing: ${name}`)
}
if (!base.declarations.has('cancelInventoryLifecycleEvent')) throw new Error('Main cancellation declaration missing')

const orderCreateManifest = JSON.parse(fs.readFileSync('scripts/step192b2a4-order-create-save-integrity-manifest.json', 'utf8'))
const manifest = {
  version: 1,
  revision: 'return-exchange-cancel-autonomy-r1',
  changes: {
    cancelInventoryLifecycleEvent: {
      before: sha(base.declarations.get('cancelInventoryLifecycleEvent')),
      after: sha(current.declarations.get('cancelInventoryLifecycleEvent')),
    },
  },
  added: {
    InventoryLifecycleCancellationDisposition: sha(current.declarations.get('InventoryLifecycleCancellationDisposition')),
    inventoryLifecycleCancellationDisposition: sha(current.declarations.get('inventoryLifecycleCancellationDisposition')),
  },
  router: {
    before: orderCreateManifest.router.after,
    after: sha(normalizeRouter(currentWorker.router)),
  },
}
fs.writeFileSync('scripts/return-exchange-cancel-autonomy-worker-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

const testPath = 'scripts/test-step1906a-worker-modularization.mjs'
let test = fs.readFileSync(testPath, 'utf8')
function replaceOnce(oldText, newText, label) {
  const count = test.split(oldText).length - 1
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`)
  test = test.replace(oldText, newText)
}

replaceOnce(
  "const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')\n",
  "const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')\nconst returnExchangeCancelAutonomyPath = path.join(root, 'scripts/return-exchange-cancel-autonomy-worker-manifest.json')\n",
  'manifest path',
)
replaceOnce(
  "  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}\n",
  "  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}\n  check(fs.existsSync(returnExchangeCancelAutonomyPath), 'Return/exchange cancel autonomy Worker manifest missing')\n  const returnExchangeCancelAutonomy = JSON.parse(fs.readFileSync(returnExchangeCancelAutonomyPath, 'utf8'))\n  check(returnExchangeCancelAutonomy?.version === 1 && returnExchangeCancelAutonomy?.revision === 'return-exchange-cancel-autonomy-r1', 'Return/exchange cancel autonomy Worker manifest invalid')\n  const returnExchangeCancelAutonomyChanges = returnExchangeCancelAutonomy.changes || {}\n  const returnExchangeCancelAutonomyAdded = returnExchangeCancelAutonomy.added || {}\n",
  'manifest load',
)
replaceOnce(
  "  const expectedDeclarationCount = manifest.declarationCount - removedNames.length + Object.keys(warehouseTruthFreshnessAdded).length + Object.keys(warehouseAttentionTruthAdded).length + Object.keys(dailyWarehouseAdded).length + Object.keys(attentionContextAdded).length + Object.keys(orderCreateSaveIntegrityAdded).length + Object.keys(orderDeleteMobilityAdded).length\n",
  "  const expectedDeclarationCount = manifest.declarationCount - removedNames.length + Object.keys(warehouseTruthFreshnessAdded).length + Object.keys(warehouseAttentionTruthAdded).length + Object.keys(dailyWarehouseAdded).length + Object.keys(attentionContextAdded).length + Object.keys(orderCreateSaveIntegrityAdded).length + Object.keys(orderDeleteMobilityAdded).length + Object.keys(returnExchangeCancelAutonomyAdded).length\n",
  'declaration count',
)
replaceOnce(
  `    const orderEditPaymentMethodChanged = orderEditPaymentMethodChanges[name]
    if (orderEditPaymentMethodChanged) {
      check(orderEditPaymentMethodChanged.before === acceptedPostExchangeStaleHandoverHash, \`Order edit payment-method baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === orderEditPaymentMethodChanged.after, \`Worker declaration changed beyond exact Order edit payment-method allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostExchangeStaleHandoverHash, \`Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method deltas: \${name}\`)
    }
`,
  `    const orderEditPaymentMethodChanged = orderEditPaymentMethodChanges[name]
    let acceptedPostOrderEditPaymentHash = acceptedPostExchangeStaleHandoverHash
    if (orderEditPaymentMethodChanged) {
      check(orderEditPaymentMethodChanged.before === acceptedPostExchangeStaleHandoverHash, \`Order edit payment-method baseline hash mismatch: \${name}\`)
      acceptedPostOrderEditPaymentHash = orderEditPaymentMethodChanged.after
    }
    const returnExchangeCancelAutonomyChanged = returnExchangeCancelAutonomyChanges[name]
    if (returnExchangeCancelAutonomyChanged) {
      check(returnExchangeCancelAutonomyChanged.before === acceptedPostOrderEditPaymentHash, \`Return/exchange cancel autonomy baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === returnExchangeCancelAutonomyChanged.after, \`Worker declaration changed beyond exact return/exchange cancel autonomy allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostOrderEditPaymentHash, \`Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy deltas: \${name}\`)
    }
`,
  'existing declaration chain',
)
replaceOnce(
  "    .replace(/\\n\\s*orderCreateSaveIntegrity:\\s*'192b2a4',\\s*\\n/, '\\n')\n",
  "    .replace(/\\n\\s*returnExchangeCancelAutonomy:\\s*'192b2a5',\\s*\\n/, '\\n')\n    .replace(/\\n\\s*orderCreateSaveIntegrity:\\s*'192b2a4',\\s*\\n/, '\\n')\n",
  'router marker normalization',
)
replaceOnce(
  `  if (orderCreateSaveIntegrity) {
    check(orderCreateSaveIntegrity.router?.before === acceptedPostAttentionContextRouterHash, '192B2A4 router baseline hash mismatch')
    check(sha(normalizedRouter) === orderCreateSaveIntegrity.router.after, 'Worker router changed beyond exact 192B2A4 order-save delta')
  } else {
    check(sha(normalizedRouter) === acceptedPostAttentionContextRouterHash, \`Worker router changed beyond accepted structural/cleanup/runtime/security/warehouse/catalog/attention/daily/order-save delta\`)
  }
`,
  `  let acceptedPostOrderCreateRouterHash = acceptedPostAttentionContextRouterHash
  if (orderCreateSaveIntegrity) {
    check(orderCreateSaveIntegrity.router?.before === acceptedPostAttentionContextRouterHash, '192B2A4 router baseline hash mismatch')
    acceptedPostOrderCreateRouterHash = orderCreateSaveIntegrity.router.after
  }
  check(returnExchangeCancelAutonomy.router?.before === acceptedPostOrderCreateRouterHash, 'Return/exchange cancel autonomy router baseline hash mismatch')
  check(sha(normalizedRouter) === returnExchangeCancelAutonomy.router.after, 'Worker router changed beyond exact return/exchange cancel autonomy delta')
`,
  'router chain',
)
replaceOnce(
  `  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {
    check(declarations.has(name), \`Order delete mobility added Worker declaration missing: \${name}\`)
    check(sha(declarations.get(name)) === expectedHash, \`Order delete mobility declaration changed beyond exact allow-list: \${name}\`)
  }
`,
  `  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {
    check(declarations.has(name), \`Order delete mobility added Worker declaration missing: \${name}\`)
    check(sha(declarations.get(name)) === expectedHash, \`Order delete mobility declaration changed beyond exact allow-list: \${name}\`)
  }

  for (const [name, expectedHash] of Object.entries(returnExchangeCancelAutonomyAdded)) {
    check(declarations.has(name), \`Return/exchange cancel autonomy added Worker declaration missing: \${name}\`)
    check(sha(declarations.get(name)) === expectedHash, \`Return/exchange cancel autonomy declaration changed beyond exact allow-list: \${name}\`)
  }
`,
  'added declaration verification',
)
replaceOnce(
  "  const orderCreateSaveIntegrityNote = orderCreateSaveIntegrity ? `, ${Object.keys(orderCreateSaveIntegrityChanges).length} changed + ${Object.keys(orderCreateSaveIntegrityAdded).length} added 192B2A4 order-save declarations` : ''\n",
  "  const orderCreateSaveIntegrityNote = orderCreateSaveIntegrity ? `, ${Object.keys(orderCreateSaveIntegrityChanges).length} changed + ${Object.keys(orderCreateSaveIntegrityAdded).length} added 192B2A4 order-save declarations` : ''\n  const returnExchangeCancelAutonomyNote = `, ${Object.keys(returnExchangeCancelAutonomyChanges).length} changed + ${Object.keys(returnExchangeCancelAutonomyAdded).length} added return/exchange cancellation-autonomy declarations`\n",
  'note declaration',
)
replaceOnce(
  "${orderCreateSaveIntegrityNote}${financeF5BusinessSemanticsNote}, 0 import cycles`)",
  "${orderCreateSaveIntegrityNote}${returnExchangeCancelAutonomyNote}${financeF5BusinessSemanticsNote}, 0 import cycles`)",
  'note output',
)
fs.writeFileSync(testPath, test)
console.log('Registered exact 190.6A structural delta for return/exchange cancellation autonomy')
