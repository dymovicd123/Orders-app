import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const view=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const app=readFileSync('src/App.tsx','utf8')
const preview=readFileSync('worker/domains/order-delete-preview.ts','utf8')
const endpoint=readFileSync('worker/domains/admin-delete-physical-confirm.ts','utf8')
const routes=readFileSync('worker/index.ts','utf8')
const saga=readFileSync('worker/domains/admin-delete-saga.ts','utf8')
const executor=readFileSync('worker/domains/admin-delete-execute.ts','utf8')
for(const phrase of [
  'Товар действительно передавался клиенту?',
  'Нет, товар не передавался',
  'Да, товар был передан клиенту',
  'Перейти к редактированию заказа',
  "physicalAnswer==='issued'",
  "physicalAnswer!=='not_issued'",
  'confirmAdminDeletePhysicalBeforeChain(',
  "physicalAnswer:'not_issued'",
]){
  assert(view.includes(phrase),'Missing delete modal physical confirmation: '+phrase)
}
assert(view.includes('&&(!physicalQuestionRequired'), 'Never offer destructive action when answer is yes')
assert(view.includes('const physicalQuestionRequired=Boolean(adminDeleteDraft?.preview'),'The physical question must be displayed for every order before deletion, including unrecorded handovers')
assert(!app.includes('const notIssued = window.confirm(['),'Legacy late blocking browser popup must be removed')
assert(app.includes('delete-physical-confirm')&&app.includes("physicalOutcome:'not_issued'"),
  'Corrections must occur in the same deletion dialog via dedicated endpoint')
assert(app.includes('return await loadAdminOrderDeletePreview(order)'),
  'Never run dependent cancellation with a stale pre-correction snapshot')
assert(app.includes('let attempt = await sendDelete(physicalOutcome)'),
  'Direct deletion must forward explicit answer to existing stock-safe deleter')
assert(routes.includes("requireAdminUser(authUser)")&&routes.includes("correctPhysicalBeforeAdminDelete(env.DB"),
  'Only authenticated administrator can correct delivery before deletion')
assert(endpoint.includes("preview.chainPlan.snapshotFingerprint!==snapshot"),
  'Physical correction must revalidate the exact consented snapshot')
assert(endpoint.includes("correctMistakenOrderHandoverWithCurrentExchange"),
  'Use existing stocktake-aware handler, never invent inventory adjustments')
assert(endpoint.includes('const updated=await previewAdminOrderDeletion(db,orderId)'),
  'Fresh facts needed after correcting false shipping')
assert(preview.includes('canPreparePhysicalCorrection'),
  'Physical confirmation is an alternative to blanket blocker when safe')
assert(saga.includes("physicalOutcome!=='not_issued'")&&saga.includes('preview.appliedStockReview.appliedCount>0'),
  'Server must refuse chain deleting applied inventory without explicit no-handover answer')
assert(executor.includes('input.physicalOutcome'),'Chain must forward physical consent to saga')
console.log('ADMIN_DELETE_INLINE_PHYSICAL_CONFIRMATION_AND_NO_DOUBLE_RETURN_GUARDS_PASSED')
