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
  const returnsExchanges = read('worker/domains/returns-exchanges.ts')

  check(app.includes("function addEditorPayment(paymentKind: EditorPayment['paymentKind'])"), 'Editor payment action does not require an explicit semantic kind')
  for (const marker of [
    "addEditorPayment('primary')", '+ Первичная оплата',
    "addEditorPayment('debt_close')", '+ Закрытие долга',
    "addEditorPayment('extra')", '+ Доплата',
  ]) check(editor.includes(marker), `Explicit editor payment action missing: ${marker}`)
  check(!editor.includes('onClick={addEditorPayment}'), 'Generic +Payment action is still present')
  check(app.includes('createEmptyEditorPayment(formatLocalDateInput())'), 'New editor payment does not default to the current entry day')
  check(editor.includes('при необходимости укажите фактическую дату получения денег'), 'Editor does not explain the actual payment-date rule')
  check(editor.includes('Смысл оплаты'), 'Payment meaning is not visible in the editor')
  for (const marker of ['Первичная оплата', 'Закрытие долга', 'Доплата по заказу']) check(editor.includes(marker), `Payment semantic option missing: ${marker}`)

  check(types.includes('id?: number') && types.includes('draftKey?: string'), 'Frontend cannot distinguish persisted payments from new editor drafts')
  check(utils.includes('id: Number(payment.id || 0) || undefined'), 'Persisted payment identity is dropped when the editor draft is created')
  check(utils.includes('      : [],\n    orderTotal:'), 'Unpaid orders still synthesize a blank primary-looking editor row')
  check(editor.includes('payment.id ? (') && editor.includes('Проведена'), 'Persisted payments are not visibly separated from new drafts')
  check(editor.includes('Уже проведённые оплаты здесь не переписываются'), 'Editor does not explain immutable persisted payments')
  check(app.includes('if (paymentIndex !== index || payment.id) return payment'), 'Controller can still mutate a persisted payment row')
  check(app.includes('if (!current || current.payments[index]?.id) return current'), 'Controller can still delete a persisted payment row')

  const persistStart = app.indexOf('async function persistOrder(')
  const persistEnd = app.indexOf('async function saveSelectedOrder()', persistStart)
  const persistBlock = persistStart >= 0 && persistEnd > persistStart ? app.slice(persistStart, persistEnd) : ''
  check(persistBlock, 'persistOrder block not found')
  check(!persistBlock.includes('payments: nextDraft.payments.map'), 'Generic order PATCH still rewrites the complete payment list')
  check(persistBlock.includes('pendingEditorPayments') && persistBlock.includes('Новые оплаты ещё не проведены'), 'Unsaved explicit payments can be lost when non-money order fields are saved')

  const savePaymentStart = app.indexOf('async function saveEditorPayment(index: number)')
  const savePaymentEnd = app.indexOf('function handleSelectDebtOrder', savePaymentStart)
  const savePaymentBlock = savePaymentStart >= 0 && savePaymentEnd > savePaymentStart ? app.slice(savePaymentStart, savePaymentEnd) : ''
  check(savePaymentBlock.includes("apiFetch('/api/payments'"), 'New editor payments are not appended through the dedicated payment endpoint')
  check(savePaymentBlock.includes('prepareCriticalRequest') && savePaymentBlock.includes('completeCriticalRequest'), 'Editor payment append is not protected by browser retry idempotency')
  check(savePaymentBlock.includes("'X-Idempotency-Key': critical.requestId"), 'Editor payment append does not send the durable request id')
  check(money.includes("beginCriticalOperation(db, 'order_payment_create'"), 'Server payment endpoint lost durable idempotency')
  check(money.includes("'manual_order_payment'"), 'Server payment endpoint lost mapped-entity replay protection')

  check(returnsExchanges.includes("throw new Error('Укажите дату возврата.')") && returnsExchanges.includes("throw new Error('Укажите дату обмена.')"), 'F2 return/exchange missing-date guards regressed')

  console.log('FINANCE F5 ENTRY SEMANTICS TESTS PASSED — primary/debt/extra are explicit, persisted payments are immutable in the generic editor, and new payments use the idempotent append path.')
} catch (error) {
  console.error(`FINANCE F5 ENTRY SEMANTICS TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
