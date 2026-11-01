import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const lifecycle=readFileSync('worker/domains/lifecycle.ts','utf8')
const returns=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const relations=readFileSync('worker/domains/orders-relations.ts','utf8')
const router=readFileSync('worker/index.ts','utf8')
assert.match(lifecycle,/explicitReplacementDispatch\?: boolean/)
assert.match(lifecycle,/if \(isOutgoingExchange && cleanText\(event\.pending_reason\) === 'awaiting_dispatch'/)
assert.match(lifecycle,/options\.explicitReplacementDispatch !== true/)
assert.match(lifecycle,/throw new Error\('Эта замена ещё не отправлена/)
assert.match(lifecycle,/COALESCE\(e\.pending_reason,''\) <> 'awaiting_dispatch'/)
assert.match(lifecycle,/if \(cleanText\(event\.pending_reason\) === 'awaiting_dispatch'\)/)
assert.match(returns,/dispatchSelectedCompleteOrderLines\(db,orderId,\{/,
  'Legacy endpoint must delegate inventory mutations to unified dispatch')
assert.match(returns,/const row = await db\.prepare\(/)
assert(returns.includes("cleanText(row.pending_reason)!=='awaiting_dispatch'"),
  'Only intentionally pending replacements can be sent')
assert(returns.includes("beginCriticalOperation(db,'exchange_replacement_dispatch'"), 'Legacy endpoint retains idempotency operation')
assert.match(router,/pending-dispatch/)
const unifiedDispatch=readFileSync('worker/domains/order-dispatch.ts','utf8')
assert.match(table,/openDispatchDraft\(order\)/, 'Use shared order dispatch UI')
assert(!table.includes('order-exchange-dispatch-button'), 'Remove old separate exchange send')
assert(unifiedDispatch.includes('replacementByItem.set(item.orderItemId'),
  'Exchange replacement must share item-specific atomic order dispatch')
assert.match(relations,/e\.pending_reason='awaiting_dispatch'/)
const gate=lifecycle.indexOf('if (isOutgoingExchange && cleanText(event.pending_reason)')
const stockWrite=lifecycle.indexOf('const statements: D1PreparedStatement[] = []',gate)
assert(gate>0 && stockWrite>gate,'Guard must run before ANY inventory write')
const context=lifecycle.indexOf('export async function getInventoryLifecycleContext')
const contextGate=lifecycle.indexOf('if (cleanText(event.pending_reason) === \'awaiting_dispatch\')',context)
assert(contextGate>context && contextGate < lifecycle.indexOf('const retiredLink',context))
const resolver=lifecycle.indexOf('export async function resolveInventoryLifecycleFacts')
const resolverGate=lifecycle.indexOf('if (cleanText(event.pending_reason) === \'awaiting_dispatch\')',resolver)
assert(resolverGate>resolver && resolverGate < lifecycle.indexOf('const preResolutionDisposition',resolver))
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,event_type TEXT,direction TEXT,status TEXT,pending_reason TEXT);
INSERT INTO inventory_lifecycle_events VALUES
(1,'exchange_new_out','out','pending','awaiting_dispatch'),
(2,'exchange_new_out','out','pending','unresolved_variant'),
(3,'return_in','in','pending','unresolved_variant'),
(4,'exchange_new_out','out','applied',NULL);
`)
const visible=db.prepare("SELECT id FROM inventory_lifecycle_events e WHERE e.status = 'pending' AND COALESCE(e.pending_reason,'') <> 'awaiting_dispatch' ORDER BY id").all().map(x=>x.id)
assert.deepEqual(visible,[2,3],'Outstanding real catalog problems stay; intentional pending dispatch stays off resolver queue')
const delayed=db.prepare("SELECT id FROM inventory_lifecycle_events e WHERE e.status='pending' AND e.pending_reason='awaiting_dispatch'").all().map(x=>x.id)
assert.deepEqual(delayed,[1],'Replacement stays available to unified Orders dispatch')
db.close()
console.log('BRANCH2_EXCHANGE_PENDING_DISPATCH_RESOLVER_GUARD_PASS')
