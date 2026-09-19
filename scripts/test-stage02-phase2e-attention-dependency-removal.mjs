import fs from 'node:fs'

const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = fs.readFileSync('src/App.tsx', 'utf8')
const returnsView = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeView = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')
const activity = fs.readFileSync('worker/domains/activity.ts', 'utf8')
const returnsExchange = fs.readFileSync('worker/domains/returns-exchanges.ts', 'utf8')
const lifecycle = fs.readFileSync('worker/domains/lifecycle.ts', 'utf8')
const routes = fs.readFileSync('worker/index.ts', 'utf8')

check(activity.includes('lifecycle.id AS return_item_lifecycle_id'), 'Phase2E return history does not expose lifecycle id')
check(activity.includes('lifecycleId: toInt(row.return_item_lifecycle_id, 0) || null'), 'Phase2E return history does not map lifecycle id')
check(returnsExchange.includes('old_lifecycle.id AS old_lifecycle_id') && returnsExchange.includes('new_lifecycle.id AS new_lifecycle_id'), 'Phase2E exchange history does not expose lifecycle ids')
check(returnsExchange.includes('oldLifecycleId: toInt(row.old_lifecycle_id, 0) || null'), 'Phase2E exchange history does not map lifecycle ids')

check(returnsView.includes("item.lifecycleStatus === 'pending'") && returnsView.includes('item.lifecycleId'), 'Phase2E return history cannot identify known pending intake')
check(returnsView.includes('reconcileKnownInventoryLifecycle(Number(item.lifecycleId || 0))'), 'Phase2E return history still depends on Warehouse Attention to finish known intake')
check(returnsView.includes("if (result?.ok) await loadReturnHistory()"), 'Phase2E return history does not refresh after direct intake reconciliation')
check(returnsView.includes('Завершить приёмку'), 'Phase2E return history lacks direct known-intake action')

check(exchangeView.includes("entry.oldLifecycleStatus === 'pending'") && exchangeView.includes('entry.oldLifecycleId'), 'Phase2E exchange history cannot identify known pending intake')
check(exchangeView.includes('reconcileKnownInventoryLifecycle(Number(entry.oldLifecycleId || 0))'), 'Phase2E exchange history still depends on Warehouse Attention to finish known intake')
check(exchangeView.includes("if (result?.ok) await loadExchangeHistory()"), 'Phase2E exchange history does not refresh after direct intake reconciliation')
check(exchangeView.includes('Завершить приёмку'), 'Phase2E exchange history lacks direct known-intake action')

const returnCtx = app.match(/<OrderReturnsSection ctx=\{\{([^\n]+)\}\} \/>/)?.[1] || ''
const exchangeCtx = app.match(/<OrderExchangeSection ctx=\{\{([^\n]+)\}\} \/>/)?.[1] || ''
check(returnCtx.includes('reconcileKnownInventoryLifecycle'), 'Phase2E App does not wire direct return intake reconciliation')
check(exchangeCtx.includes('reconcileKnownInventoryLifecycle'), 'Phase2E App does not wire direct exchange intake reconciliation')

const routeStart = routes.indexOf('const inventoryLifecycleKnownMatch')
const routeEnd = routes.indexOf("if (url.pathname === '/api/catalog/review/reconcile'", routeStart)
check(routeStart >= 0 && routeEnd > routeStart, 'Phase2E known-intake route block missing')
const knownRoute = routes.slice(routeStart, routeEnd)
check(knownRoute.includes('reconcileKnownPendingInventoryInbound'), 'Phase2E direct intake route is not wired to safe known reconciliation')
check(!knownRoute.includes('requireAdminAccess'), 'Phase2E direct known intake still requires an Admin detour')

const reconcileStart = lifecycle.indexOf('export async function reconcileKnownPendingInventoryInbound')
const reconcileEnd = lifecycle.indexOf('\n\nexport async function', reconcileStart + 20)
check(reconcileStart >= 0, 'Phase2E safe known-intake reconciliation missing')
const reconcile = lifecycle.slice(reconcileStart, reconcileEnd > reconcileStart ? reconcileEnd : lifecycle.length)
check(reconcile.includes("if (cleanText(event.direction) !== 'in')"), 'Phase2E known reconciliation is not restricted to inbound intake')
check(reconcile.includes("if (!variantId) throw new Error('Точный существующий вариант не найден. Нужно определить товар вручную.')"), 'Phase2E known reconciliation can silently guess unresolved catalog identity')
check(reconcile.includes('inventoryLifecycleDeferredInboundDisposition(db, event, variantId)'), 'Phase2E direct intake bypasses freshness/exact-count precedence')
check(reconcile.includes("if (disposition.action === 'supersede')"), 'Phase2E direct intake can re-apply an event superseded by newer exact physical truth')
check(reconcile.includes("if (disposition.action !== 'apply')"), 'Phase2E direct intake can apply without a safe physical baseline')

console.log('STAGE02 PHASE2E ATTENTION DEPENDENCY TESTS PASSED — known return/exchange intake can finish in its owning history without Warehouse Attention or Admin, while unresolved identity and newer exact physical truth remain guarded.')
