import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const money = read('worker/domains/money.ts')
const returns = read('worker/domains/returns-exchanges.ts')
const app = read('src/App.tsx')
const contract = read('docs/continuation/STAGE03_E_PRICING_CONTRACT_V1_20260922.md')

const paymentStart = money.indexOf('export async function createManualOrderPaymentCritical')
check(paymentStart >= 0, 'Manual order payment function missing')
const paymentEnd = money.indexOf('\n\nexport async function', paymentStart + 40)
const manualPayment = money.slice(paymentStart, paymentEnd > paymentStart ? paymentEnd : money.length)

check(money.includes('COALESCE(o.total_amount, 0) AS total_amount'), 'Financial ledger must stay on persisted order total')
check(money.includes('FROM payments p') && money.includes('WHERE p.order_id = o.id'), 'Financial ledger must stay on payment facts')
check(money.includes('FROM returns r') && money.includes("COALESCE(r.status, 'completed') <> 'cancelled'"), 'Financial ledger must preserve explicit return facts')
check(money.includes('debtAmount: Math.max(0, totalAmount - receivedAmount)'), 'Debt must remain total minus received payments')
check(manualPayment.includes('const ledger = await readOrderFinancialLedger(db, orderId)'), 'Debt-close payment must re-read current persisted ledger')
check(manualPayment.includes('if (amount > ledger.debtAmount)'), 'Debt-close payment must reject overpayment')
check(!manualPayment.includes('catalog_execution_prices') && !manualPayment.includes('catalog_price_snapshot'), 'Debt close must never depend on mutable/current Catalog pricing')
check(!manualPayment.includes('pricing_mode'), 'Debt-close payment must work identically for legacy and itemized orders')

const returnStart = returns.indexOf('export async function createReturn')
const returnEnd = returns.indexOf('\n\nexport async function', returnStart + 40)
check(returnStart >= 0, 'Return function missing')
const createReturn = returns.slice(returnStart, returnEnd > returnStart ? returnEnd : returns.length)

check(createReturn.includes('const amount = Math.max(0, toInt(input.amount, 0))'), 'Return refund amount must remain explicit/manual')
check(createReturn.includes('Number(existing.received_amount || 0) - Number(existing.return_amount || 0)'), 'Return refund ceiling must stay on received minus already-returned money')
check(createReturn.includes('if (amount > availableAmount)'), 'Return must reject refund above available received funds')
check(!createReturn.includes('catalog_execution_prices'), 'Return must never use current Catalog price')
check(!createReturn.includes('catalog_price_snapshot'), 'Return must not auto-refund from Catalog recommendation snapshot')
check(!createReturn.includes('unit_price') && !createReturn.includes('line_total'), 'Stage03 return must not silently automate refund from sold line prices before policy exists')
check(!createReturn.includes("pricing_mode) === 'itemized_v1'"), 'Manual return policy must remain available for itemized orders rather than being silently disabled')

const returnUiStart = app.indexOf('async function saveReturn')
const returnUiEnd = app.indexOf('\n  async function saveExchange', returnUiStart)
check(returnUiStart >= 0 && returnUiEnd > returnUiStart, 'Return UI boundary missing')
const returnUi = app.slice(returnUiStart, returnUiEnd)
check(returnUi.includes('const amount = Math.max(0, Number(returnDraft.amount || 0))'), 'Return UI must keep manager-entered refund amount')
check(returnUi.includes('Number(returnSelectedOrder.received_amount || 0) - Number(returnSelectedOrder.return_amount || 0)'), 'Return UI must cap refund from historical money facts')
check(!returnUi.includes('unitPrice') && !returnUi.includes('catalogPriceSnapshot'), 'Return UI must not derive refund from item pricing yet')

const debtUiStart = app.indexOf('async function saveDebtClose')
const debtUiEnd = app.indexOf('\n  async function saveReturn', debtUiStart)
check(debtUiStart >= 0 && debtUiEnd > debtUiStart, 'Debt-close UI boundary missing')
const debtUi = app.slice(debtUiStart, debtUiEnd)
check(debtUi.includes('closeAmount > Number(debtSelectedOrder.debt_amount || 0)'), 'Debt UI must guard current persisted debt')
check(debtUi.includes("paymentKind: 'debt_close'"), 'Debt UI must preserve explicit payment kind')
check(!debtUi.includes('pricing_mode') && !debtUi.includes('catalogPriceSnapshot'), 'Debt UI must stay pricing-mode/catalog independent')

check(contract.includes('Current return money remains manually entered.'), 'Return policy contract drifted')
check(contract.includes('Stage03 itemized order creation does not automatically change return policy.'), 'Itemized return boundary contract drifted')
check(contract.includes('Payments do not receive Catalog defaults.'), 'Payment isolation contract drifted')

console.log('STAGE03-H6E POST-CREATE FINANCE ISOLATION PASSED — itemized orders keep debt-close and manual returns on persisted historical money facts, with no Catalog repricing or automatic refund policy introduced')
