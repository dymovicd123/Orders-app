import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  check(a >= 0 && b > a, 'Missing source boundary: ' + start)
  return source.slice(a, b)
}

const wrangler = read('wrangler.jsonc')
const utils = read('src/app/utils.ts')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderReturnsSection.tsx')
const worker = read('worker/domains/returns-exchanges.ts')
const doc = read('docs/continuation/STAGE03_H10_RETURN_POLICY_20260925.md')

check(wrangler.includes('"name": "orders-app-branch2"'), 'H10: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H10: Branch2 D1 identity drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H10: Production D1 identity leaked into Branch2')

const draft = between(utils, 'export function createReturnDraft', '\n\n\nfunction createExchangePairDraftKey')
check(draft.includes('amount: 0'), 'H10 Return draft must start with an explicit zero refund')
check(!draft.includes('received_amount') && !draft.includes('return_amount'), 'H10 Return draft still auto-fills from remaining received money')

const saveReturn = between(app, 'async function saveReturn()', '\n\n  async function saveExchange')
check(saveReturn.includes('const amount = Math.max(0, Number(returnDraft.amount || 0))'), 'H10 UI save path no longer uses manager-entered refund')
check(saveReturn.includes('Number(returnSelectedOrder.received_amount || 0) - Number(returnSelectedOrder.return_amount || 0)'), 'H10 available refund ceiling missing')
check(saveReturn.includes('if (amount > availableAmount)'), 'H10 client refund ceiling guard missing')
check(saveReturn.includes('if (amount <= 0 && selectedReturnItems.length === 0)'), 'H10 zero-money physical Return rule missing')
check(saveReturn.includes("if (amount > 0 && !returnDraft.paymentMethod.trim())"), 'H10 payment method rule missing')
check(!saveReturn.includes('unitPrice') && !saveReturn.includes('catalogPriceSnapshot'), 'H10 client Return started deriving money from item pricing')

check(ui.includes('Введите фактическую сумму возврата вручную.'), 'H10 explicit manual refund guidance missing')
check(ui.includes('Система не подставляет цену товара или текущую цену Каталога автоматически.'), 'H10 Catalog isolation guidance missing')
check(ui.includes('Выбор товара фиксирует физический возврат, но не рассчитывает деньги автоматически.'), 'H10 physical/money separation guidance missing')
check(ui.includes('Доступно {formatMoney(Math.max(0, Number(returnSelectedOrder.received_amount || 0) - Number(returnSelectedOrder.return_amount || 0)))}'), 'H10 available refund maximum is no longer visible')

const createReturn = between(worker, 'export async function createReturn', '\n\nexport async function receiveReturnedItem')
check(createReturn.includes('const amount = Math.max(0, toInt(input.amount, 0))'), 'H10 server Return amount is no longer explicit input')
check(createReturn.includes('Number(existing.received_amount || 0) - Number(existing.return_amount || 0)'), 'H10 server available-money ceiling missing')
check(createReturn.includes('if (amount > availableAmount)'), 'H10 server over-refund guard missing')
check(createReturn.includes('if (amount <= 0 && selectedItems.length === 0)'), 'H10 server zero-money physical Return rule missing')
check(!createReturn.includes('catalog_execution_prices'), 'H10 server Return started reading current Catalog price')
check(!createReturn.includes('catalog_price_snapshot'), 'H10 server Return started deriving money from Catalog snapshot')
check(!createReturn.includes('unit_price') && !createReturn.includes('line_total'), 'H10 server Return started deriving money from sold line pricing')
check(!createReturn.includes("pricing_mode) === 'itemized_v1'"), 'H10 manual Return policy was accidentally restricted by pricing mode')

for (const marker of [
  'A Return contains two independent facts',
  'a new Return draft starts with refund amount **0**',
  'selecting returned items does not change the refund field',
  'Current Catalog price is even less suitable',
  'No migration or data backfill is part of H10',
]) check(doc.includes(marker), 'H10 continuation contract missing: ' + marker)

console.log('STAGE03-H10 MANUAL RETURN POLICY PASSED — Return starts at zero money, physical item selection and refund money remain independent, over-refund stays blocked, and neither historical sold price nor mutable Catalog price is used as an automatic refund policy')
