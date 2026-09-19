import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flowSource = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module })
const { createResolutionSession } = module.exports

let writes = 0, completions = 0
const session = createResolutionSession()
await session.run(async () => { writes++ }, async () => true, async () => { completions++; return false })
assert.equal(writes, 1, 'R9.2A: resolver mutation should happen once')
assert.equal(completions, 1, 'R9.2A: first continuation attempt should run once')
await session.run(null, async () => true, async () => { completions++; return true })
assert.equal(writes, 1, 'R9.2A: retry must not replay the already-saved resolver mutation')
assert.equal(completions, 2, 'R9.2A: failed continuation must remain retryable')
await session.run(null, async () => true, async () => { completions++; return true })
assert.equal(completions, 2, 'R9.2A: proven completion must latch exactly once')

const modal = fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx', 'utf8')
assert.ok(modal.includes('onCompleted: (order: OrderRecord) => boolean | void | Promise<boolean | void>'))
assert.ok(modal.includes('async () => owner === session.current ? await onCompleted(order) : false'))
assert.ok(modal.includes('async () => order && owner === session.current ? await onCompleted(order) : false'))

const app = fs.readFileSync('src/App.tsx', 'utf8')
const completion = app.split('onCompleted={async (resolvedOrder: OrderRecord) => {')[1].split('        }}')[0]
assert.ok(completion.includes("apiFetch(\`/api/orders/\${resolvedOrder.id}\`, { cache: 'no-store' })"), 'R9.2A: completion must fetch fresh server order truth')
assert.ok(completion.includes("freshResponse.headers.get('X-Orders-App-Stale') === '1'"), 'R9.2A: stale fallback must never count as fresh truth')
assert.ok(completion.includes('await markOrderSentToClient(freshResult.order)'), 'R9.2A: original shipping action must resume with the fresh order')
const sendIndex = completion.indexOf('await markOrderSentToClient(freshResult.order)')
const shippingCloseIndex = completion.indexOf('setOrderCatalogResolutionOrder(null)', sendIndex)
assert.ok(sendIndex >= 0 && shippingCloseIndex > sendIndex, 'R9.2A: resolver must stay open until shipping succeeds')
assert.ok(completion.includes('if (!sent) return false'), 'R9.2A: failed continuation must keep the session retryable')
assert.ok(app.includes('async function markOrderSentToClient(order: OrderRecord): Promise<boolean>'))
assert.ok(app.includes('setMessage(\`Заказ \${order.external_id} отмечен как отправленный клиенту.\`)\n      return true'))

console.log('CATALOG RESOLVER R9.2A CLEAN COMPLETION TESTS PASSED — fresh order truth precedes automatic shipping, failed continuation stays retryable, and the resolver closes only after proven success.')
