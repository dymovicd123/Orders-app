import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const section = (text, start, end = '') => {
  const i = text.indexOf(start)
  check(i >= 0, `missing section ${start}`)
  if (!end) return text.slice(i)
  const j = text.indexOf(end, i + start.length)
  check(j > i, `missing section end ${end}`)
  return text.slice(i, j)
}

try {
  const app = read('src/App.tsx')
  const view = read('src/features/sections/OrderEditorSection.tsx')
  const worker = read('worker/domains/orders-write.ts')
  const persist = section(app, 'async function persistOrder(', 'async function saveSelectedOrder()')
  const updatePayment = section(app, 'function updateEditorPayment(', 'function addEditorPayment(')
  const edit = section(worker, 'export async function updateOrderCritical(', 'export async function getOrder(')

  check(updatePayment.includes("if (payment.id && field !== 'method') return payment"), 'persisted payment is not limited to method-only edit')
  check(!view.includes("<input value={payment.method || ''} disabled readOnly />"), 'persisted payment method is still read-only')
  check(view.includes("onChange={(value) => updateEditorPayment(index, 'method', value)}"), 'payment method editor missing')
  check(view.includes("disabled={Boolean(payment.id) || savingOrder || payment.paymentKind === 'primary'}"), 'persisted payment date unexpectedly unlocked')
  check(view.includes('disabled={Boolean(payment.id) || savingOrder}'), 'persisted amount/kind/comment locks disappeared')
  check(persist.includes('paymentMethodCorrections: nextDraft.payments'), 'order PATCH does not send payment-method corrections')
  check(persist.includes('.filter((payment) => Boolean(payment.id))'), 'unsaved payment drafts can leak into correction PATCH')
  check(!persist.includes('payments: nextDraft.payments'), 'order edit unexpectedly rewrites full payment history')

  check(edit.includes('rawPaymentMethodCorrections'), 'backend correction input missing')
  check(edit.includes('WHERE p.id = ? AND p.order_id = ?'), 'payment correction is not scoped to the exact order')
  check(edit.includes('UPDATE payments SET method = ? WHERE id = ? AND order_id = ?'), 'payment row/id is not corrected in place')
  check(edit.includes("eventType: 'payment_reversal'"), 'old method financial reversal missing')
  check(edit.includes('eventType: correction.relatedType'), 'new method financial event missing')
  check(edit.includes('eventDate: correction.paymentDate'), 'correction does not preserve original payment date')
  check(edit.includes("reason: 'payment_method_correction'"), 'financial correction audit reason missing')
  check(edit.includes('payment-method-correction:${criticalOperation.requestId}:${correction.paymentId}:${cashDirection}'), 'cash correction is not request-idempotent')
  check(edit.includes('correction.oldIsCash && !correction.newIsCash && correction.cashEntryTracked'), 'cash-to-noncash balance correction missing')
  check(edit.includes('!correction.oldIsCash && correction.newIsCash && correction.cashTrackingEligible'), 'noncash-to-cash balance correction missing')
  check(edit.indexOf("criticalOperation.row.step === 'shipping_committed' && paymentMethodCorrectionCount") > edit.indexOf("advanceCriticalOperation(db, criticalOperation, 'shipping_committed'"), 'method correction runs before normal order edit is safely committed')
  check(edit.includes('const rewritePayments = !deletingOrder'), 'legacy full-payment rewrite detection unexpectedly removed')
  check(edit.includes('} else if (p.rewritePayments) {'), 'legacy full-payment rewrite path unexpectedly removed')

  console.log('ORDER EDIT PAYMENT METHOD CORRECTION PASSED — persisted payment id/amount/date/kind remain stable, method is corrected in place, finance gets an auditable net-zero pair, and cash classification is adjusted idempotently')
} catch (error) {
  console.error(`ORDER EDIT PAYMENT METHOD CORRECTION FAILED: ${error?.message || error}`)
  process.exit(1)
}
