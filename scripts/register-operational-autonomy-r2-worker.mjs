import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const mode = process.argv[2]
const statePath = path.join(root, 'scripts/.operational-autonomy-r2-worker-baseline.json')
const manifestPath = path.join(root, 'scripts/operational-autonomy-r2-worker-manifest.json')
const indexPath = path.join(root, 'worker/index.ts')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function currentRouter() {
  const text = fs.readFileSync(indexPath, 'utf8')
  const source = ts.createSourceFile(indexPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find((row) => ts.isExportAssignment(row))
  if (!statement) throw new Error('Worker export assignment/router not found')
  return statement.getText(source)
}

function normalizedRouter(value) {
  return value
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

function routerHash() {
  return sha(normalizedRouter(currentRouter()))
}

if (mode === 'before') {
  const before = routerHash()
  const previous = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-edit-autonomy-worker-manifest.json'), 'utf8'))
  if (previous?.router?.after !== before) {
    throw new Error(`Router baseline does not match accepted order-edit autonomy hash: ${before}`)
  }
  fs.writeFileSync(statePath, JSON.stringify({ before }, null, 2) + '\n')
  console.log('Operational autonomy R2 Worker router baseline captured')
} else if (mode === 'after') {
  if (!fs.existsSync(statePath)) throw new Error('Operational autonomy R2 Worker baseline missing')
  const { before } = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  const after = routerHash()
  if (!before || before === after) throw new Error('Expected Worker router delta')
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    revision: 'operational-autonomy-r2',
    router: { before, after },
  }, null, 2) + '\n')
  console.log('Operational autonomy R2 Worker router manifest registered')
} else {
  throw new Error('Usage: node scripts/register-operational-autonomy-r2-worker.mjs before|after')
}
