import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

function listTs(dir) {
  const absolute = path.join(root, dir)
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) return listTs(relative)
    return entry.isFile() && entry.name.endsWith('.ts') ? [relative.replace(/\\/g, '/')] : []
  })
}

const workerFiles = listTs('worker')
const commercialWriteFiles = []
const commercialWriteSnippets = new Map()

for (const relative of workerFiles) {
  const source = read(relative)
  const writes = []
  const templates = [...source.matchAll(/`([sS]*?)`/g)].map(match => match[1])
  for (const sql of templates) {
    const normalized = sql.replace(/s+/g, ' ').trim()
    const orderCommercialWrite =
      (/\bINSERT\s+INTO\s+orders\b/i.test(normalized) && /\btotal_amount\b/i.test(normalized))
      || (/\bUPDATE\s+orders\s+SET\b/i.test(normalized) && /\btotal_amount\b/i.test(normalized))
    const itemCommercialWrite =
      (/\bINSERT\s+INTO\s+order_items\b/i.test(normalized) && /\b(unit_price|line_total|catalog_price_snapshot)\b/i.test(normalized))
      || (/\bUPDATE\s+order_items\s+SET\b/i.test(normalized) && /\b(unit_price|line_total|catalog_price_snapshot)\b/i.test(normalized))
    if (orderCommercialWrite || itemCommercialWrite) writes.push(normalized)
  }
  if (writes.length) {
    commercialWriteFiles.push(relative)
    commercialWriteSnippets.set(relative, writes)
  }
}

check(
  commercialWriteFiles.sort().join(',') === ['worker/domains/orders-write.ts','worker/domains/returns-exchanges.ts'].sort().join(','),
  'Commercial order/item SQL writes escaped the reviewed orders-write + returns-exchanges boundary: ' + commercialWriteFiles.join(', '),
)

const ordersWrite = read('worker/domains/orders-write.ts')
const returnsExchanges = read('worker/domains/returns-exchanges.ts')
const money = read('worker/domains/money.ts')
const deleteOrder = read('worker/domains/order-delete.ts')
const reservations = read('worker/domains/order-reservations.ts')

check(ordersWrite.includes("pricingMode === 'itemized_v1'"), 'Explicit itemized Create gate missing')
check(ordersWrite.includes("pricing_mode") && ordersWrite.includes("catalog_price_snapshot"), 'Itemized persistence metadata missing')
check(ordersWrite.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete'"), 'Legacy full-edit fail-closed guard missing')
check(ordersWrite.includes('SET unit_price = ?, line_total = ?'), 'Reviewed legacy price-only correction path missing')
check(!ordersWrite.includes('catalog_execution_prices'), 'Order writes must not reprice from mutable current Catalog')

const exchangeTotalWrites = (returnsExchanges.match(/UPDATE orders SET total_amount = \?, updated_at = \? WHERE id = \?/g) || []).length
check(exchangeTotalWrites === 3, 'Legacy exchange total mutation surface changed; review required: ' + exchangeTotalWrites)
const createExchangeStart = returnsExchanges.indexOf('export async function createExchange')
const createExchangeEnd = returnsExchanges.indexOf('\n\nexport async function', createExchangeStart + 40)
const createExchange = returnsExchanges.slice(createExchangeStart, createExchangeEnd > createExchangeStart ? createExchangeEnd : returnsExchanges.length)
check(createExchange.includes("cleanText((existing as any).pricing_mode) === 'itemized_v1'"), 'Itemized exchange creation guard missing')
check(createExchange.includes('unitPrice: 0') && createExchange.includes('lineTotal: 0'), 'Legacy exchange price model changed; policy review required')
check(!returnsExchanges.includes('catalog_execution_prices'), 'Return/exchange writes must not read current Catalog price')

for (const [name, source] of [['money', money], ['order-delete', deleteOrder], ['order-reservations', reservations]]) {
  check(!/UPDATE\s+orders\s+SET[\s\S]{0,300}?total_amount/i.test(source), name + ' unexpectedly mutates order commercial total')
  check(!/INSERT\s+INTO\s+order_items[\s\S]{0,500}?(unit_price|line_total|catalog_price_snapshot)/i.test(source), name + ' unexpectedly inserts commercial item prices')
  check(!/UPDATE\s+order_items\s+SET[\s\S]{0,300}?(unit_price|line_total|catalog_price_snapshot)/i.test(source), name + ' unexpectedly mutates commercial item prices')
  check(!source.includes('catalog_execution_prices'), name + ' unexpectedly depends on mutable current Catalog pricing')
}

console.log('STAGE03-H6F COMMERCIAL WRITE SURFACE AUDIT PASSED — commercial order/item SQL writes remain confined to reviewed order Create/Edit and legacy exchange code; itemized edits/exchanges fail closed; money/delete/shipping paths cannot silently reprice orders')
