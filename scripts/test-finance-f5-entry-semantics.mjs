import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const app = read('src/App.tsx')
  const editor = read('src/features/sections/OrderEditorSection.tsx')
  const utils = read('src/app/utils.ts')
  const types = read('src/app/types.ts')
  const money = read('worker/domains/money.ts')
  const orderWrite = read('worker/domains/orders-write.ts')
  const returnsExchanges = read('worker/domains/returns-exchanges.ts')

  check(app.includes("function addEditorPayment(paymentKind: 'primary' | 'debt_close')"), 'Editor ordinary-payment action is not restricted to primary/debt_close')
  for (const marker of [
    "addEditorPayment('primary')", '+ Первичная оплата',
    "addEditorPayment('debt_close')", '+ Закрытие долга',
  ]) check(editor.includes(marker), `Explicit editor payment action missing: ${marker}`)
  check(!editor.includes("addEditorPayment('extra')") && !editor.includes('<option value="extra">'), 'Ordinary order editor still exposes generic extra payment')
  check(!editor.includes('onClick={addEditorPayment}'), 'Generic +Payment action is still present')
  check(app.includes("paymentKind === 'primary'") && app.includes('current.orderDate || formatLocalDateInput()'), 'Forgotten primary payment is not anchored to the order date')
  check(app.includes(": formatLocalDateInput()"), 'Debt-close editor payment does not default to the current operation day')
  check(editor.includes('при создании она относится к дате заказа') && editor.includes('ID оплаты не меняется'), 'Editor does not explain primary-date and persisted-payment identity rules')
  check(editor.includes('Доплата, связанная с обменом') && editor.includes('исправляется через операцию обмена'), 'Editor does not explain exchange-extra ownership')
  check(editor.includes('Смысл оплаты'), 'Payment meaning is not visible in the editor')
  for (const marker of ['Первичная оплата', 'Закрытие долга']) check(editor.includes(marker), `Payment semantic option missing: ${marker}`)
  check(!editor.includes('Доплата по заказу'), 'Generic ordinary extra wording remains in the order editor')

  check(types.includes('id?: number') && types.includes('draftKey?: string'), 'Frontend cannot distinguish persisted payments from new editor drafts')
  check(utils.includes('id: Number(payment.id || 0) || undefined'), 'Persisted payment identity is dropped when the editor draft is created')
  check(utils.includes('      : [],\n    orderTotal:'), 'Unpaid orders still synthesize a blank primary-looking editor row')
  check(editor.includes('payment.id ? (') && editor.includes('Проведена'), 'Persisted payments are not visibly separated from new drafts')
  check(editor.includes('Дату, сумму, способ, смысл и комментарий можно исправить'), 'Editor does not explain safe persisted ordinary-payment correction')
  check(editor.includes('сумму, дату и смысл меняйте через операцию обмена'), 'Editor does not preserve exchange-extra correction boundary')
  check(!app.includes("if (payment.id && field !== 'method') return payment"), 'Controller still restricts every persisted payment to method-only editing')
  check(app.includes("payment.id && payment.paymentKind === 'extra' && field !== 'method'"), 'Controller does not protect exchange-linked extra from non-method edits')
  check(app.includes("!payment.id && field === 'paymentDate' && payment.paymentKind === 'primary'"), 'Controller lost creation-time primary-date guard')
  check(app.includes('if (!current || current.payments[index]?.id) return current'), 'Controller can still delete a persisted payment row')

  const persistStart = app.indexOf('async function persistOrder(')
  const persistEnd = app.indexOf('async function saveSelectedOrder()', persistStart)
  const persistBlock = persistStart >= 0 && persistEnd > persistStart ? app.slice(persistStart, persistEnd) : ''
  check(persistBlock, 'persistOrder block not found')
  check(!persistBlock.includes('payments: nextDraft.payments.map'), 'Generic order PATCH still rewrites the complete payment list')
  check(persistBlock.includes('pendingEditorPayments') && persistBlock.includes('Новые оплаты ещё не проведены'), 'Unsaved explicit payments can be lost when non-money order fields are saved')
  check(persistBlock.includes('const paymentCorrections:') && persistBlock.includes('paymentCorrections,'), 'Persisted payment corrections are not sent as an explicit correction set')
  for (const marker of ['expectedPaymentDate: oldPaymentDate', 'expectedMethod: oldMethod', 'expectedAmount: oldAmount', 'expectedPaymentKind: oldPaymentKind', 'expectedComment: oldComment']) {
    check(persistBlock.includes(marker), `Persisted payment correction lost stale-editor snapshot: ${marker}`)
  }

  const savePaymentStart = app.indexOf('async function saveEditorPayment(index: number)')
  const savePaymentEnd = app.indexOf('function handleSelectDebtOrder', savePaymentStart)
  const savePaymentBlock = savePaymentStart >= 0 && savePaymentEnd > savePaymentStart ? app.slice(savePaymentStart, savePaymentEnd) : ''
  check(savePaymentBlock.includes("apiFetch('/api/payments'"), 'New editor payments are not appended through the dedicated payment endpoint')
  check(savePaymentBlock.includes('prepareCriticalRequest') && savePaymentBlock.includes('completeCriticalRequest'), 'Editor payment append is not protected by browser retry idempotency')
  check(savePaymentBlock.includes("'X-Idempotency-Key': critical.requestId"), 'Editor payment append does not send the durable request id')
  check(money.includes("beginCriticalOperation(db, 'order_payment_create'"), 'Server payment endpoint lost durable idempotency')
  check(money.includes("'manual_order_payment'"), 'Server payment endpoint lost mapped-entity replay protection')
  check(money.includes("paymentKind === 'extra'") && money.includes('Обычной доплаты по заказу нет'), 'Stale clients can still create generic ordinary extras')
  check(money.includes("paymentKind === 'primary' ? normalizeDate(existing.order_date) : requestedPaymentDate"), 'Server does not canonicalize manual primary payment to order date')

  for (const marker of [
    'rawPaymentCorrections',
    'requested.expectedPaymentDate',
    'после открытия редактора',
    'isExchangeExtra && nonMethodChanged',
    "newPaymentKind === 'extra'",
    'paymentCorrectionAmountDelta',
    'UPDATE payments SET payment_date = ?, method = ?, amount = ?, payment_kind = ?, comment = ? WHERE id = ? AND order_id = ?',
    "eventType: 'payment_reversal'",
    "reason: 'payment_correction'",
    'newTrackedCashAmount - oldTrackedCashAmount',
  ]) check(orderWrite.includes(marker), `Server safe-payment correction invariant missing: ${marker}`)

  check(returnsExchanges.includes("throw new Error('Укажите дату возврата.')") && returnsExchanges.includes("throw new Error('Укажите дату обмена.')"), 'F2 return/exchange missing-date guards regressed')

  console.log('FINANCE F5 ENTRY SEMANTICS TESTS PASSED — ordinary orders keep explicit primary/debt-close entry semantics, posted ordinary payments are corrected in place with stale-editor protection, exchange extras stay isolated, and appended payments remain idempotent.')
} catch (error) {
  console.error(`FINANCE F5 ENTRY SEMANTICS TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
