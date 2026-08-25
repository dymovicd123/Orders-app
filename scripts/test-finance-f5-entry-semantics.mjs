import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const app = read('src/App.tsx')
  const editor = read('src/features/sections/OrderEditorSection.tsx')
  const returnsExchanges = read('worker/domains/returns-exchanges.ts')

  check(app.includes("function addEditorPayment(paymentKind: 'debt_close' | 'extra')"), 'Generic editor payment action still has hidden semantics')
  check(app.includes("createEmptyEditorPayment(formatLocalDateInput())") && app.includes('paymentKind }'), 'New editor payment does not default to the actual entry day with an explicit kind')
  const editorAddStart = app.indexOf("function addEditorPayment(paymentKind: 'debt_close' | 'extra')")
  const editorAddEnd = app.indexOf('function removeEditorPayment', editorAddStart)
  const editorAddBlock = editorAddStart >= 0 && editorAddEnd > editorAddStart ? app.slice(editorAddStart, editorAddEnd) : ''
  check(editorAddBlock && !editorAddBlock.includes('createEmptyEditorPayment(current.orderDate)'), 'New later editor payment still silently inherits the original order date')
  check(editor.includes("addEditorPayment('debt_close')") && editor.includes('+ Закрытие долга'), 'Explicit debt-close action missing')
  check(editor.includes("addEditorPayment('extra')") && editor.includes('+ Доплата'), 'Explicit extra-payment action missing')
  check(!editor.includes('onClick={addEditorPayment}'), 'Generic +Payment action is still present')
  check(editor.includes('<span>Смысл оплаты</span>'), 'Payment meaning is not visible in the editor')
  for (const marker of ['Первичная оплата', 'Закрытие долга', 'Доплата по заказу']) check(editor.includes(marker), `Payment semantic option missing: ${marker}`)
  check(editor.includes('Новая операция получает сегодняшнюю дату'), 'Editor does not explain the date rule for newly added money')
  check(returnsExchanges.includes("throw new Error('Укажите дату возврата.')") && returnsExchanges.includes("throw new Error('Укажите дату обмена.')"), 'F2 return/exchange missing-date guards regressed')

  console.log('FINANCE F5 ENTRY SEMANTICS TESTS PASSED — editor payment meaning is explicit, later operations default to entry day, and return/exchange dates stay required.')
} catch (error) {
  console.error(`FINANCE F5 ENTRY SEMANTICS TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
