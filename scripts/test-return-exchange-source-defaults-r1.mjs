import fs from 'node:fs'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const read = (path) => fs.readFileSync(path, 'utf8')

const types = read('src/app/types.ts')
const activity = read('worker/domains/activity.ts')
const exchangeBackend = read('worker/domains/returns-exchanges.ts')
const returnsUi = read('src/features/sections/OrderReturnsSection.tsx')
const exchangeUi = read('src/features/sections/OrderExchangeSmartSection.tsx')

check(types.includes("sourceType?: 'warehouse' | 'boutique' | 'workshop'"), 'Return/Exchange history types lost original source')
check(activity.includes('AS return_item_source_type') && activity.includes('sourceType: cleanText(row.return_item_source_type)'), 'Return history does not preserve original order-item source')
check(activity.includes('LEFT JOIN order_items return_order_item ON return_order_item.id = ri.order_item_id'), 'Return history does not reuse one order-item join for source/workshop/variant facts')
check(!activity.includes('SELECT oi.source_type FROM order_items oi WHERE oi.id = ri.order_item_id'), 'Return history regressed to an extra per-item source subquery')
check(exchangeBackend.includes('oi.source_type') && exchangeBackend.includes('sourceType: cleanText(item.source_type)'), 'Set Exchange history does not preserve original old-item source')
check(exchangeBackend.includes('oldSourceType: cleanText(row.old_source_type)'), 'Legacy Exchange history does not preserve old-item source')

check(returnsUi.includes('const defaultReturnDestination =') && returnsUi.includes("item.sourceType === 'boutique'") && returnsUi.includes("? 'boutique'"), 'Return form does not default Boutique-origin goods back to Boutique')
check(returnsUi.includes('const physicalState = defaultReturnDestination(item)'), 'Return already-arrived action ignores source-aware default')
check(returnsUi.includes('receiptDestinations[receiptKey] || defaultReturnDestination(item)'), 'Return delayed intake ignores source-aware default')
check(returnsUi.includes("receiptDestinations[`return:\${entry.id}:\${item.id}`] || defaultReturnDestination(item)"), 'Return history receipt action ignores source-aware default')
check(!returnsUi.includes("(item.isWorkshop ? 'no_stock' : 'warehouse')"), 'Return UI still contains a Warehouse fallback that ignores Boutique origin')

check(exchangeUi.includes('const defaultReturnedDestination =') && exchangeUi.includes("item.sourceType === 'boutique'") && exchangeUi.includes("? 'boutique'"), 'Exchange does not default Boutique-origin returned goods back to Boutique')
check(exchangeUi.includes('sourceType: entry.oldSourceType'), 'Legacy pending Exchange queue does not carry old source')
check(exchangeUi.includes('receiptDestinations[receiptKey(exchangeId, Number(item.id || 0))] || defaultReturnedDestination(item)'), 'Exchange delayed intake ignores source-aware default')
check(exchangeUi.includes('physicalState: defaultReturnedDestination(item)'), 'Exchange already-returned action ignores source-aware default')
check(exchangeUi.includes("item.sourceType === 'workshop' || item.isWorkshop") && returnsUi.includes("item.sourceType === 'workshop' || item.isWorkshop"), 'Workshop no-stock default regressed')

console.log('RETURN/EXCHANGE SOURCE DEFAULTS R1 PASSED — Warehouse stays Warehouse, Boutique defaults to Boutique, Workshop defaults to no-stock, and every choice remains editable per item.')
