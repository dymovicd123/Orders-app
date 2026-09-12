from pathlib import Path

path = Path('.github/scripts/finalize-return-physical-1906a.mjs')
text = path.read_text()

old = """const routerBlock = contiguousInsertedBlock(before.router, after.router)
if (!routerBlock.includes(\"url.pathname === '/api/returned-items/receive'\")) throw new Error('Exact router delta is not the returned-item receive route')
if (!routerBlock.includes('receiveReturnedItem(env.DB, input)')) throw new Error('Returned-item receive route does not call the expected domain action')

const manifest = {
  version: 1,
  revision: 'returns-physical-intake-r1',
  changes,
  added,
  router: { before: sha(before.router), after: sha(after.router), block: routerBlock },
}
"""
new = """const returnRouterBefore = \"const input = await readJson<{ requestId?: string; orderId?: number; returnDate?: string; amount?: number; paymentMethod?: string; comment?: string; restockSource?: unknown; items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean }> }>(request);\"
const returnRouterAfter = \"const input = await readJson<{ requestId?: string; orderId?: number; returnDate?: string; amount?: number; paymentMethod?: string; comment?: string; restockSource?: unknown; items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean; physicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock' }> }>(request);\"
const exchangeRouterBefore = \"const input = await readJson<{ requestId?: string; orderId?: number; exchangeDate?: string; oldItemId?: number; oldQuantity?: number; oldReturnSource?: unknown; newItem?: NonNullable<OrderInput['items']>[number]; newSourceWasManuallyChanged?: boolean; financialAction?: unknown; financialAmount?: number; paymentMethod?: string; comment?: string }>(request);\"
const exchangeRouterAfter = \"const input = await readJson<{ requestId?: string; orderId?: number; exchangeDate?: string; oldItemId?: number; oldQuantity?: number; oldReturnSource?: unknown; oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock'; newItem?: NonNullable<OrderInput['items']>[number]; newSourceWasManuallyChanged?: boolean; financialAction?: unknown; financialAmount?: number; paymentMethod?: string; comment?: string }>(request);\"
for (const [label, previous, current] of [
  ['return payload', returnRouterBefore, returnRouterAfter],
  ['exchange payload', exchangeRouterBefore, exchangeRouterAfter],
]) {
  if (!before.router.includes(previous)) throw new Error(`Previous ${label} router shape missing from main`)
  if (!after.router.includes(current)) throw new Error(`Current ${label} router shape missing from branch`)
}
let routerWithTypesReverted = after.router
  .replace(returnRouterAfter, returnRouterBefore)
  .replace(exchangeRouterAfter, exchangeRouterBefore)
const routerBlock = contiguousInsertedBlock(before.router, routerWithTypesReverted)
if (!routerBlock.includes(\"url.pathname === '/api/returned-items/receive'\")) throw new Error('Exact router block is not the returned-item receive route')
if (!routerBlock.includes('receiveReturnedItem(env.DB, input)')) throw new Error('Returned-item receive route does not call the expected domain action')

const manifest = {
  version: 1,
  revision: 'returns-physical-intake-r1',
  changes,
  added,
  router: {
    before: sha(before.router),
    after: sha(after.router),
    block: routerBlock,
    reversions: [
      { before: returnRouterBefore, after: returnRouterAfter },
      { before: exchangeRouterBefore, after: exchangeRouterAfter },
    ],
  },
}
"""
if text.count(old) != 1:
    raise SystemExit(f'router manifest section anchor count={text.count(old)}')
text = text.replace(old, new, 1)

old_gate = """const physicalRouterBlock = [
  \"  check(sha(currentRouter) === returnsPhysicalIntakeRouter.after, 'Returns physical intake R1 raw Worker router changed beyond exact delta')\",
  \"  const returnsPhysicalIntakeRevertedRouter = currentRouter.replace(returnsPhysicalIntakeRouter.block, '')\",
  \"  check(sha(returnsPhysicalIntakeRevertedRouter) === returnsPhysicalIntakeRouter.before, 'Returns physical intake R1 Worker router reverse baseline mismatch')\",
  \"  check(sha(returnsPhysicalIntakeRevertedRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 Worker router changed beneath physical intake R1')\",
  \"  const operationalAutonomyA5RevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(operationalAutonomyA5Router.block, '')\",
].join('\\n')
"""
new_gate = """const physicalRouterBlock = [
  \"  check(sha(currentRouter) === returnsPhysicalIntakeRouter.after, 'Returns physical intake R1 raw Worker router changed beyond exact delta')\",
  \"  let returnsPhysicalIntakeRevertedRouter = currentRouter.replace(returnsPhysicalIntakeRouter.block, '')\",
  \"  for (const routerChange of (returnsPhysicalIntakeRouter.reversions || [])) {\",
  \"    check(returnsPhysicalIntakeRevertedRouter.includes(routerChange.after), 'Returns physical intake R1 router reversion anchor missing')\",
  \"    returnsPhysicalIntakeRevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(routerChange.after, routerChange.before)\",
  \"  }\",
  \"  check(sha(returnsPhysicalIntakeRevertedRouter) === returnsPhysicalIntakeRouter.before, 'Returns physical intake R1 Worker router reverse baseline mismatch')\",
  \"  check(sha(returnsPhysicalIntakeRevertedRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 Worker router changed beneath physical intake R1')\",
  \"  const operationalAutonomyA5RevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(operationalAutonomyA5Router.block, '')\",
].join('\\n')
"""
if text.count(old_gate) != 1:
    raise SystemExit(f'router gate section anchor count={text.count(old_gate)}')
text = text.replace(old_gate, new_gate, 1)

path.write_text(text)
print('finalizer router reversion patched')
