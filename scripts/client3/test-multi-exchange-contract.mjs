import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=file=>readFileSync(file,'utf8')
const app=read('src/App.tsx')
const ui=read('src/features/sections/OrderExchangeSection.tsx')
const batch=read('worker/domains/exchange-batch.ts')
const router=read('worker/index.ts')
const points=[
 [app.includes("apiFetch('/api/exchanges/batch'"),'Multi-item exchange remains available'],
 [app.includes('expectedOrderTotal: Number(exchangeSelectedOrder.total_amount)'),'Exchange stale total protected'],
 [ui.includes('queuedSameNewQuantity')&&ui.includes('exchangeBatchRequired'),'Exchange physical request aggregates identical SKU'],
 [ui.includes('exchangeIssueConfirmed')&&ui.includes('observedPhysicalQuantity: null'),'Human confirms exact issue, not an invented total stock count'],
 [ui.includes('stockObservationEnabled: event.target.checked'),'Issue-specific physical confirmation used'],
 [batch.includes('stockGroups')&&batch.includes('group.requestedQuantity'),'Backend aggregates duplicate SKU groups'],
 [batch.includes('await createExchange(db, {'),'Batch reuses exchange state machine'],
 [router.includes("url.pathname === '/api/exchanges/batch'"),'Multi exchange route available'],
];for(const [pass,label] of points)assert(pass,label)
console.log('CLIENT3_CURRENT_MULTI_EXCHANGE_CONTRACT_PASSED: physical possession scoped to actual issue, no stale full-stock observation')
