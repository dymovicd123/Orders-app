import fs from 'node:fs'
const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
try {
  const money = read('worker/domains/money.ts')
  const ordersRead = read('worker/domains/orders-read.ts')
  const app = read('src/App.tsx')
  check(!money.includes("paymentKind === 'debt_close' && ledger.returnAmount > 0"), 'post-return debt close is still globally blocked')
  check(!money.includes('Обычное закрытие долга недоступно'), 'obsolete post-return debt-close error remains')
  check(money.includes('if (ledger.debtAmount <= 0)'), 'closed-debt guard disappeared')
  check(money.includes('if (amount > ledger.debtAmount)'), 'overpayment guard disappeared')
  check(money.includes("paymentKind === 'primary' ? normalizeDate(existing.order_date) : requestedPaymentDate"), 'debt-close operation date semantics regressed')
  check(money.includes('debtAmount: Math.max(0, totalAmount - receivedAmount)'), 'canonical debt calculation changed unexpectedly')
  const debtListStart = ordersRead.indexOf('export async function listOpenDebtOrders')
  check(debtListStart >= 0, 'open-debt read path missing')
  const debtList = ordersRead.slice(debtListStart)
  check(debtList.includes("WHERE o.debt_amount > 0 AND o.order_status NOT IN ('deleted', 'archived')"), 'open-debt list no longer follows current debt truth')
  check(!debtList.includes('return_amount > 0') && !debtList.includes('return_amount = 0'), 'open-debt list incorrectly filters orders by return history')
  const debtCloseStart = app.indexOf('async function saveDebtClose()')
  const debtCloseEnd = app.indexOf('async function saveReturn()', debtCloseStart)
  const debtCloseBlock = app.slice(debtCloseStart, debtCloseEnd)
  check(debtCloseBlock.includes("paymentKind: 'debt_close' as const"), 'dedicated debt-close UI lost semantic payment kind')
  check(debtCloseBlock.includes('closeAmount > Number(debtSelectedOrder.debt_amount || 0)'), 'frontend overpayment guard disappeared')
  check(debtCloseBlock.includes("apiFetch('/api/payments'"), 'dedicated debt-close UI no longer uses safe payment endpoint')
  console.log('Operational Autonomy A3 post-return debt-close checks passed.')
} catch (error) {
  console.error(`Operational Autonomy A3 checks failed: ${error?.message || error}`)
  process.exit(1)
}
