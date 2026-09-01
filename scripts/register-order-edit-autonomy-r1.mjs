import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function parse(filename, text) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = new Map()
  let router = ''
  for (const statement of source.statements) {
    let names = []
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names = [statement.name.text]
    else if (ts.isVariableStatement(statement)) names = statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
    for (const name of names) declarations.set(name, normalizeMovedDeclaration(statement.getText(source)))
    if (ts.isExportAssignment(statement)) router = statement.getText(source)
  }
  return { declarations, router }
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
    .replace(/\n\s*orderEditAutonomy:\s*'192b2a6',\s*\n/, '\n')
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

const ordersPath = 'worker/domains/orders-write.ts'
const workerPath = 'worker/index.ts'
const currentOrders = parse(ordersPath, fs.readFileSync(ordersPath, 'utf8'))
const baseOrders = parse(ordersPath, execFileSync('git', ['show', 'origin/main:worker/domains/orders-write.ts'], { encoding: 'utf8' }))
const currentWorker = parse(workerPath, fs.readFileSync(workerPath, 'utf8'))
const baseWorker = parse(workerPath, execFileSync('git', ['show', 'origin/main:worker/index.ts'], { encoding: 'utf8' }))
const returnManifest = JSON.parse(fs.readFileSync('scripts/return-exchange-cancel-autonomy-worker-manifest.json', 'utf8'))

if (!currentOrders.declarations.has('updateOrderCritical') || !baseOrders.declarations.has('updateOrderCritical')) throw new Error('updateOrderCritical declaration missing')
const baseRouterHash = sha(normalizeRouter(baseWorker.router))
if (baseRouterHash !== returnManifest.router.after) {
  throw new Error(`Router normalization baseline mismatch: expected ${returnManifest.router.after}, got ${baseRouterHash}`)
}

const manifest = {
  version: 1,
  revision: 'order-edit-autonomy-r1',
  changes: {
    updateOrderCritical: {
      before: sha(baseOrders.declarations.get('updateOrderCritical')),
      after: sha(currentOrders.declarations.get('updateOrderCritical')),
    },
  },
  router: {
    before: returnManifest.router.after,
    after: sha(normalizeRouter(currentWorker.router)),
  },
}
fs.writeFileSync('scripts/order-edit-autonomy-worker-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

const testPath = 'scripts/test-step1906a-worker-modularization.mjs'
let test = fs.readFileSync(testPath, 'utf8')
function replaceOnce(oldText, newText, label) {
  const count = test.split(oldText).length - 1
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`)
  test = test.replace(oldText, newText)
}

replaceOnce(
  "const returnExchangeCancelAutonomyPath = path.join(root, 'scripts/return-exchange-cancel-autonomy-worker-manifest.json')\n",
  "const returnExchangeCancelAutonomyPath = path.join(root, 'scripts/return-exchange-cancel-autonomy-worker-manifest.json')\nconst orderEditAutonomyPath = path.join(root, 'scripts/order-edit-autonomy-worker-manifest.json')\n",
  'order edit manifest path',
)
replaceOnce(
  "  const returnExchangeCancelAutonomyChanges = returnExchangeCancelAutonomy.changes || {}\n  const returnExchangeCancelAutonomyAdded = returnExchangeCancelAutonomy.added || {}\n",
  "  const returnExchangeCancelAutonomyChanges = returnExchangeCancelAutonomy.changes || {}\n  const returnExchangeCancelAutonomyAdded = returnExchangeCancelAutonomy.added || {}\n  check(fs.existsSync(orderEditAutonomyPath), 'Order edit autonomy Worker manifest missing')\n  const orderEditAutonomy = JSON.parse(fs.readFileSync(orderEditAutonomyPath, 'utf8'))\n  check(orderEditAutonomy?.version === 1 && orderEditAutonomy?.revision === 'order-edit-autonomy-r1', 'Order edit autonomy Worker manifest invalid')\n  const orderEditAutonomyChanges = orderEditAutonomy.changes || {}\n",
  'load order edit manifest',
)

const oldDeclarationChain = `    const returnExchangeCancelAutonomyChanged = returnExchangeCancelAutonomyChanges[name]
    if (returnExchangeCancelAutonomyChanged) {
      check(returnExchangeCancelAutonomyChanged.before === acceptedPostOrderEditPaymentHash, \`Return/exchange cancel autonomy baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === returnExchangeCancelAutonomyChanged.after, \`Worker declaration changed beyond exact return/exchange cancel autonomy allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostOrderEditPaymentHash, \`Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy deltas: \${name}\`)
    }
`
const newDeclarationChain = `    const returnExchangeCancelAutonomyChanged = returnExchangeCancelAutonomyChanges[name]
    let acceptedPostCancellationAutonomyHash = acceptedPostOrderEditPaymentHash
    if (returnExchangeCancelAutonomyChanged) {
      check(returnExchangeCancelAutonomyChanged.before === acceptedPostOrderEditPaymentHash, \`Return/exchange cancel autonomy baseline hash mismatch: \${name}\`)
      acceptedPostCancellationAutonomyHash = returnExchangeCancelAutonomyChanged.after
    }
    const orderEditAutonomyChanged = orderEditAutonomyChanges[name]
    if (orderEditAutonomyChanged) {
      check(orderEditAutonomyChanged.before === acceptedPostCancellationAutonomyHash, \`Order edit autonomy baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === orderEditAutonomyChanged.after, \`Worker declaration changed beyond exact order edit autonomy allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostCancellationAutonomyHash, \`Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy / order-edit-autonomy deltas: \${name}\`)
    }
`
replaceOnce(oldDeclarationChain, newDeclarationChain, 'declaration acceptance chain')

replaceOnce(
  "    .replace(/\\n\\s*returnExchangeCancelAutonomy:\\s*'192b2a5',\\s*\\n/, '\\n')\n",
  "    .replace(/\\n\\s*orderEditAutonomy:\\s*'192b2a6',\\s*\\n/, '\\n')\n    .replace(/\\n\\s*returnExchangeCancelAutonomy:\\s*'192b2a5',\\s*\\n/, '\\n')\n",
  'router health marker normalization',
)

const oldRouterChain = `  check(returnExchangeCancelAutonomy.router?.before === acceptedPostOrderCreateRouterHash, 'Return/exchange cancel autonomy router baseline hash mismatch')
  check(sha(normalizedRouter) === returnExchangeCancelAutonomy.router.after, 'Worker router changed beyond exact return/exchange cancel autonomy delta')
`
const newRouterChain = `  check(returnExchangeCancelAutonomy.router?.before === acceptedPostOrderCreateRouterHash, 'Return/exchange cancel autonomy router baseline hash mismatch')
  const acceptedPostCancellationAutonomyRouterHash = returnExchangeCancelAutonomy.router.after
  check(orderEditAutonomy.router?.before === acceptedPostCancellationAutonomyRouterHash, 'Order edit autonomy router baseline hash mismatch')
  check(sha(normalizedRouter) === orderEditAutonomy.router.after, 'Worker router changed beyond exact order edit autonomy delta')
`
replaceOnce(oldRouterChain, newRouterChain, 'router acceptance chain')

fs.writeFileSync(testPath, test)
console.log('Registered exact 190.6A structural delta for order edit autonomy')
