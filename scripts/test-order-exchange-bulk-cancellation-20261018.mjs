// Narrow regression for safe order-linked Exchange cancellation and deletion consent.
// Existing local Worker+D1 cancellation tests remain authoritative for stock/money.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const app=readFileSync('src/App.tsx','utf8')
const ui=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const projection=readFileSync('src/app/orderOperationalProjection.ts','utf8')
const routes=readFileSync('worker/index.ts','utf8')
const preview=readFileSync('worker/domains/order-delete-preview.ts','utf8')
const physical=readFileSync('worker/domains/admin-delete-physical.ts','utf8')
assert(ui.includes('Отменить последний обмен')&&ui.includes('Отменить все обмены'),
  'Both human cancellation modes must be available')
assert(ui.includes('Зависимых возвратов:')&&ui.includes('Самостоятельные возвраты'),
  'Consent must disclose dependent returns and preserve independent returns')
assert(ui.includes('setLinkedAdminEditOrder(order)')&&ui.includes('if(projection.canEdit)handleEditOrder'),
  'Admin post-exchange corrections must not open the unrestricted composition editor')
assert(ui.includes('isAdmin && projection.hasCommittedDownstreamOperation'),
  'Never expose linked-order admin correction surface to manager')
assert(projection.includes('canEdit: mutableWorkingOrder && !hasCommittedDownstreamOperation && simpleAdmin'),
  'Full editor safety projection must remain unchanged')
assert(app.includes('async function loadOrderExchangeCancellationPlan(')
  &&app.includes('async function cancelOrderExchangeChain('),
  'Plan and execution must be separate')
assert(app.includes("const selected=mode==='last' ? available.slice(-1) : [...available]"),
  'Last exchange is the newest active exchange, not the oldest')
assert(app.includes('preview.manualReviewRequired')&&app.includes('ordered.length!==nodes.size'),
  'Legacy and ambiguous dependency graphs must fail closed')
assert(app.includes('const current=await loadOrderExchangeCancellationPlan(order,expected.mode)')
  &&app.includes('current.signature!==expected.signature'),
  'Re-read the graph immediately before mutation')
assert(app.includes("const url=step.type==='exchange'") &&
  app.includes("'/api/exchanges/'+step.id+'/cancel'") &&
  app.includes("'/api/returns/'+step.id+'/cancel'"),
  'Only existing guarded cancellation handlers may write')
assert(app.includes("prepareCriticalRequest(key,payload)")&&app.includes('completeCriticalRequest(key,critical.requestId)'),
  'Each cancellation step must be idempotent')
assert(!app.slice(app.indexOf('async function cancelOrderExchangeChain('),
  app.indexOf('async function handleEditOrder(')).includes('UPDATE inventory_stock'),
  'Never invent warehouse SQL in browser cancellation flow')
assert(routes.includes("const returnCancelMatch") && routes.includes("const exchangeCancelMatch"),
  'Both cancellation routes must remain available')
assert(ui.includes('const physicalQuestionRequired=Boolean(adminDeleteDraft?.preview')
  &&ui.includes('adminDeleteDraft.preview.requiresPhysicalFact')
  &&ui.includes('adminDeleteDraft.preview.appliedStockReview?.allowed'),
  'Consent only when server detects handover or a safely reversible applied movement')
assert(preview.includes("const requiresPhysicalFact=shipping==='sent'||toInt(fulfilled?.issued_count,0)>0"),
  'Recorded fulfilled reservations must still require fact-check regardless of status')
assert(physical.includes('if(!valid)return bad(appliedCount'),
  'Unsafe booked stock movements must not be deleted through a checkbox')
console.log('ORDER_EXCHANGE_LAST_ALL_CANCELLATION_AND_DELETE_CONSENT_GUARDS_PASSED')
