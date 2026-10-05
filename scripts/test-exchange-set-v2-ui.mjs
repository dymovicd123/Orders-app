import fs from 'node:fs'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const smart = fs.readFileSync('src/features/sections/OrderExchangeSmartSection.tsx', 'utf8')
const legacyHost = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const types = fs.readFileSync('src/app/types.ts', 'utf8')
const utils = fs.readFileSync('src/app/utils.ts', 'utf8')
const workspace = fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx', 'utf8')
const css = fs.readFileSync('src/styles/193-exchange-set-v2.css', 'utf8')

check(legacyHost.includes("itemizedExchange && exchangeDraft.workflowMode === 'set_v2'") && legacyHost.includes('<OrderExchangeSmartSection ctx={ctx} />'), 'Itemized Exchange does not enter the smart workspace')
check(app.includes('label="Обмен"') && !app.includes('label="Обмен размера"'), 'Exchange navigation still exposes obsolete size-only wording')
check(types.includes("workflowMode: 'set_v2' | 'legacy_pair'") && types.includes('oldSelections: ExchangeSetOldDraft[]') && types.includes('newItems: ExchangeSetNewDraft[]'), 'Set draft is not modeled independently')
check(utils.includes("workflowMode: itemizedPricing ? 'set_v2' : 'legacy_pair'"), 'Modern itemized orders do not default to Set V2')
check(utils.includes("newItems: itemizedPricing ? [{") && utils.includes("priceOrigin: 'missing'"), 'Set V2 does not open with one ready blank replacement row')

check(smart.includes('1 · Что клиент меняет') && smart.includes('2 · Что клиент получает') && smart.includes('3 · Итог и деньги'), 'Smart Exchange does not present the three human business stages')
check(smart.includes('oldSelections') && smart.includes('newItems') && !smart.includes('queuedPairs'), 'Smart Exchange leaked old pair queue semantics')
check(smart.includes('Можно убрать 3 позиции и добавить 2') || smart.includes('можно убрать 3 позиции и добавить 2'), 'Arbitrary old/new cardinality is not explained in the UI')
check(smart.includes('Цена берётся из самого заказа') && smart.includes('Цена продажи'), 'Historic old price and explicit new sold price are not separated')
check(workspace.includes('resolveCatalogOrderSalePrice(catalogData, picked)') && workspace.includes("priceOrigin: pricing.status === 'matched' ? 'catalog' : 'missing'"), 'Catalog recommendation is not automatically offered for new Exchange items')

check(smart.includes('currentTotal - removedValue + addedValue'), 'Smart Exchange does not preview the new order total from item values')
check(smart.includes('currentNetPaid') && smart.includes('dueBeforeSettlement') && smart.includes('refundAmount'), 'Smart Exchange settlement does not use actual net paid')
check(smart.includes('Получено сейчас') && smart.includes('После обмена останется долг'), 'Partial/full payment-now UX is missing')
check(smart.includes('Нужно вернуть клиенту') && smart.includes('Способ возврата'), 'Exact overpayment refund UX is missing')
check(!smart.includes('Без доплаты/возврата') && !smart.includes('Клиент доплачивает'), 'Smart Exchange still asks the operator to classify obvious money arithmetic')

check(smart.includes('Ещё у клиента') && smart.includes("physicalState: 'pending'"), 'Pending customer return choice is missing')
check(smart.includes('Клиенту не выдавалась') && smart.includes("return issued ? 'pending' : 'not_issued'"), 'Never-issued automatic disposition is missing')
check(smart.includes("status ? issuedStockStatuses.has(status) : exchangeSelectedOrder?.shipping_status === 'sent'"), 'Smart Exchange does not prefer exact per-item handover truth over broad order shipping status')
check(smart.includes('Вернуть на Склад') && smart.includes('Вернуть в Бутик') && smart.includes('Не добавлять в остаток'), 'Per-item returned-stock disposition choices are incomplete')
check(smart.includes('Подтвердить прибытие всех товаров'), 'Pending-return queue does not confirm the whole arrival')
check(smart.includes('deferRefresh: true') && smart.includes('if (!received) break'), 'Grouped return intake still performs heavy per-line refreshes or continues after a failed line')
check(app.includes('if (!input.deferRefresh)') && app.includes('invalidateInventoryStockCaches(true)'), 'Grouped intake cannot defer expensive history/inventory refresh while still invalidating stale stock caches')
check(!smart.includes('Сколько пришло'), 'Partial-arrival UI was introduced against the agreed scope')
check(smart.includes('destinationFor(group.entry.id, item)') && smart.includes('group.items.map'), 'Arrival destination is not independent per returned line')
check(smart.includes("operationType: 'exchange'") && smart.includes('operationItemId: Number(item.id || 0)'), 'Arrival queue is not connected to the existing per-item receive operation')

check(smart.includes('isSetExchange') && smart.includes('entry.oldItems') && smart.includes('entry.newItems'), 'Set exchange history does not render full old/new collections')
check(smart.includes('Отменить обмен') && app.includes("apiFetch('/api/exchanges/set'"), 'Smart create/cancel workflow is not connected end-to-end')
check(css.includes('.exchange-old-card.is-selected') && css.includes('.exchange-return-group') && css.includes('@media(max-width:720px)'), 'Smart Exchange lacks selected-card, intake, or mobile styling')

console.log('EXCHANGE SET V2 UI PASSED — itemized exchanges use independent old/new collections, automatic money settlement, full-arrival intake with per-item disposition, and human-first responsive cards.')
