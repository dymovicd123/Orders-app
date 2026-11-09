import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const smart = fs.readFileSync('src/features/sections/OrderExchangeSmartSection.tsx', 'utf8')
const legacyHost = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const creationActions = fs.readFileSync('src/features/orders/returnExchangeCreationActions.ts', 'utf8')
const aftercareActions = fs.readFileSync('src/features/orders/returnExchangeAftercareActions.ts', 'utf8')
const setCreation = fs.readFileSync('src/app/exchangeSetCreationOperation.ts', 'utf8')
const types = fs.readFileSync('src/app/types.ts', 'utf8')
const utils = fs.readFileSync('src/app/utils.ts', 'utf8')
const workspace = fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx', 'utf8')
const css = fs.readFileSync('src/styles/193-exchange-set-v2.css', 'utf8')

check(legacyHost.includes("itemizedExchange && exchangeDraft.workflowMode === 'set_v2'") && legacyHost.includes('<OrderExchangeSmartSection ctx={ctx} />'), 'Itemized Exchange does not enter the smart workspace')
check(app.includes('label="Обмен"') && !app.includes('label="Обмен размера"'), 'Exchange navigation still exposes obsolete size-only wording')
check(types.includes("workflowMode: 'set_v2' | 'legacy_pair'") && types.includes('oldSelections: ExchangeSetOldDraft[]') && types.includes('newItems: ExchangeSetNewDraft[]'), 'Set draft is not modeled independently')
check(utils.includes("workflowMode: itemizedPricing ? 'set_v2' : 'legacy_pair'"), 'Modern itemized orders do not default to Set V2')
check(utils.includes("newItems: itemizedPricing ? [{") && utils.includes("priceOrigin: 'missing'"), 'Set V2 does not open with one ready blank replacement row')

check(smart.includes('1 · Старые товары') && smart.includes('Что убираем из заказа') && smart.includes('2 · Клиент получает') && smart.includes('3 · Деньги'), 'Smart Exchange does not present the three human business stages')
check(smart.includes('oldSelections') && smart.includes('newItems') && !smart.includes('queuedPairs'), 'Smart Exchange leaked old pair queue semantics')
check(!smart.includes('Соответствие «старый → новый»') && !smart.includes('можно убрать 3 позиции и добавить 2'), 'Smart Exchange still explains internal set mechanics to the operator')
check(smart.includes('exchange-old-order-info') && smart.includes('{orderQuantity} шт.') && smart.includes('в заказе') && smart.includes('Можно обменять: {maxQuantity} шт.') && smart.includes('Цена:') && smart.includes('Цена продажи'), 'Old order quantity and historic price are not shown as separate facts')
check(workspace.includes('resolveCatalogOrderSalePrice(catalogData, picked)') && workspace.includes("priceOrigin: pricing.status === 'matched' ? 'catalog' : 'missing'"), 'Catalog recommendation is not automatically offered for new Exchange items')

check(smart.includes('currentTotal - removedValue + addedValue'), 'Smart Exchange does not preview the new order total from item values')
check(smart.includes('currentNetPaid') && smart.includes('dueBeforeSettlement') && smart.includes('refundAmount'), 'Smart Exchange settlement does not use actual net paid')
check(smart.includes('Получаем сейчас') && smart.includes('Останется долг'), 'Partial/full payment-now UX is missing')
check(smart.includes('Вернуть клиенту') && smart.includes('Способ возврата'), 'Exact overpayment refund UX is missing')
check(smart.includes('Нужно доплатить') && smart.includes('Доплата не нужна'), 'Human settlement outcome wording is missing')
check(smart.includes('exchange-money-result') && !smart.includes('exchange-money-grid') && !smart.includes('Что произойдёт'), 'Smart Exchange still duplicates technical arithmetic/final summary blocks')
check(!smart.includes('Без доплаты/возврата') && !smart.includes('Клиент доплачивает'), 'Smart Exchange still asks the operator to classify obvious money arithmetic')

check(smart.includes('Нет, ещё у клиента') && smart.includes("physicalState: 'pending'"), 'Pending customer return choice is missing')
check(smart.includes('Товар клиенту не выдавали') && smart.includes("return issued ? 'pending' : 'not_issued'"), 'Never-issued automatic disposition is missing')
check(smart.includes("issuedStockStatuses.has(status)") && smart.includes("sentWorkshop") && smart.includes("!status && exchangeSelectedOrder?.shipping_status === 'sent'"), 'Smart Exchange does not combine exact stock handover truth with the Workshop-only sent fallback')
check(smart.includes('Вернуть на Склад') && smart.includes('Вернуть в Бутик') && smart.includes('Не добавлять в остаток'), 'Per-item returned-stock disposition choices are incomplete')
check(smart.includes('Подтвердить прибытие всех товаров'), 'Pending-return queue does not confirm the whole arrival')
check(smart.includes('deferRefresh: true') && smart.includes('if (!received) break'), 'Grouped return intake still performs heavy per-line refreshes or continues after a failed line')
check(app.includes('createReturnExchangeAftercareActions({') && aftercareActions.includes('if (!input.deferRefresh)') && aftercareActions.includes('invalidateInventoryStockCaches(true)'), 'Grouped intake cannot defer expensive history/inventory refresh while still invalidating stale stock caches')
check(!smart.includes('Сколько пришло'), 'Partial-arrival UI was introduced against the agreed scope')
check(smart.includes('destinationFor(group.entry.id, item)') && smart.includes('group.items.map'), 'Arrival destination is not independent per returned line')
check(smart.includes("operationType: 'exchange'") && smart.includes('operationItemId: Number(item.id || 0)'), 'Arrival queue is not connected to the existing per-item receive operation')
check(smart.includes('newItemStockIdentityKey') && smart.includes('batchRequired') && smart.includes('matchingIndexes'), 'Repeated replacement rows do not aggregate physical demand before save')
check(smart.includes('setExchangeIssueConfirmedForGroup(matchingIndexes, event.target.checked)') && smart.includes('Подтверждение выдачи одинаковых позиций — у первой строки.'), 'Repeated replacement rows can submit conflicting physical observations')
check(smart.includes('exchange-new-primary-fields') && smart.includes('Нажмите «Выбрать товар» и укажите вещь, которую получит клиент.'), 'New-item form still exposes the full technical SKU editor before a product is selected')
check(smart.includes('saveBlockReason') && smart.includes('Укажите цену продажи для каждого нового товара.') && smart.includes('disabled={exchangeBusy || Boolean(saveBlockReason)}'), 'Exchange save does not explain incomplete manager input before submit')
check(smart.includes('useEffect(() =>') && smart.includes('draftPaymentAmount > dueBeforeSettlement') && smart.includes("paymentAmount: 0, paymentMethod: ''"), 'Exchange can keep a hidden stale payment after the composition changes')
check(workspace.includes('function applyExchangeSetNewProductPick(') && workspace.includes("unitPrice: pricing.status === 'matched' ? pricing.salePrice : undefined") && workspace.includes("catalogPriceSnapshot: pricing.status === 'matched' ? pricing.catalogPriceSnapshot : null"), 'Free-typing another replacement product can keep the previous product price snapshot')

check(smart.includes("item.sourceType === 'workshop'") && smart.includes('Срочно для цеха') && smart.includes('workshopDueDate') && smart.includes('workshopDueTime'), 'Smart Exchange dropped Workshop urgency/deadline controls')
check(smart.includes('isSetExchange') && smart.includes('entry.oldItems') && smart.includes('entry.newItems'), 'Set exchange history does not render full old/new collections')
check(smart.includes('removedHistoryQuantity') && smart.includes('addedHistoryQuantity') && smart.includes('Убрали: {removedHistoryQuantity} шт. · Добавили: {addedHistoryQuantity} шт.'), 'Exchange history summary still counts rows or falsely claims never-issued goods were returned by the client')
check(smart.includes('Убираем <strong>{removedQuantity} шт.</strong>') && !smart.includes('Возвращает <strong>{removedQuantity} шт.</strong>'), 'Final summary falsely describes never-issued old goods as customer returns')
check(smart.includes('Отменить обмен') && app.includes('createReturnExchangeCreationActions({') && creationActions.includes('prepareExchangeSetCreation(exchangeSelectedOrder, exchangeDraft)') && creationActions.includes('submitExchangeSetCreation(') && setCreation.includes("client.apiFetch('/api/exchanges/set'"), 'Smart create/cancel workflow is not connected end-to-end')
check(css.includes('.exchange-old-card.is-selected') && css.includes('.exchange-old-order-info') && css.includes('.exchange-new-primary-fields') && css.includes('.exchange-money-result') && css.includes('.exchange-return-group') && css.includes('@media(max-width:720px)'), 'Smart Exchange lacks quantity-first, progressive, settlement, intake, or mobile styling')


// Compile and execute the exact Set V2 UI preparation/POST module used by App.
// These cases prove commercial and physical invariants without a Production D1.
const compiled = await build({
  entryPoints: ['src/app/exchangeSetCreationOperation.ts'], bundle: true,
  platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
})
const setModule = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const { prepareExchangeSetCreation, submitExchangeSetCreation } = setModule
const oldItem = {
  id: 200, productName: 'СТАРЫЙ ШАПАН', quantity: 2, availableOperationQuantity: 2,
  unitPrice: 3000, lineTotal: 6000, catalogPriceSnapshot: 3500, sourceType: 'warehouse',
}
const order = {
  id: 38, external_id: 'SET-V2-SAFETY', pricing_mode: 'itemized_v1',
  total_amount: 10000, received_amount: 7000, return_amount: 0, items: [oldItem],
}
const newItem = {
  productName: 'НОВЫЙ ШАПАН', quantity: 1, unitPrice: 5000,
  catalogPriceSnapshot: 5200, sourceType: 'warehouse', stockObservationEnabled: false,
}
const draft = {
  workflowMode: 'set_v2', exchangeDate: '2026-11-08',
  oldSelections: [{orderItemId:200, quantity:1, physicalState:'pending'}],
  newItems: [{draftKey:'n1',item:newItem}],
  paymentAmount: 2000, paymentMethod:'KASPI', refundMethod:'',
  extraPaymentEnabled:false, extraPaymentAmount:0, extraPaymentMethod:'',
  extraRefundEnabled:false, extraRefundAmount:0, extraRefundMethod:'',
  comment:'тест набора',
}
const valid = prepareExchangeSetCreation(order,draft)
assert.equal(valid.ok,true)
assert.equal(valid.projectedTotal,12000)
assert.deepEqual(valid.payload.oldItems,[{
  orderItemId:200,quantity:1,physicalState:'pending',
  expectedActiveQuantity:2,expectedUnitPrice:3000,expectedLineTotal:6000,
  expectedCatalogPriceSnapshot:3500,
}])
assert.equal(valid.payload.newItems[0].observedPhysicalQuantity,null)
assert.equal(valid.payload.newItems[0].issuePossessionConfirmed,false)
assert.equal(valid.payload.expectedOrderTotal,10000)
assert.deepEqual(valid.payload.paymentParts,[{method:'KASPI',amount:2000}])
assert.deepEqual(valid.payload.refundParts,[])
assert.deepEqual(prepareExchangeSetCreation(order,{...draft,newItems:[{draftKey:'n1',item:{...newItem,stockObservationEnabled:true}}]}).payload.newItems[0].issuePossessionConfirmed,true)
assert.match(prepareExchangeSetCreation(order,{...draft,oldSelections:[]}).error,/хотя бы один товар/i)
assert.match(prepareExchangeSetCreation(order,{...draft,newItems:[]}).error,/хотя бы один товар/i)
assert.match(prepareExchangeSetCreation(order,{...draft,oldSelections:[{orderItemId:999,quantity:1,physicalState:'pending'}]}).error,/не найдена/i)
assert.match(prepareExchangeSetCreation(order,{...draft,oldSelections:[{orderItemId:200,quantity:3,physicalState:'pending'}]}).error,/доступно 2 шт/i)
assert.match(prepareExchangeSetCreation({...order,items:[{...oldItem,lineTotal:0}]},draft).error,/устарели ценовые данные/i)
assert.match(prepareExchangeSetCreation(order,{...draft,newItems:[{draftKey:'n1',item:{...newItem,unitPrice:undefined}}]}).error,/укажите цену продажи/i)
assert.match(prepareExchangeSetCreation(order,{...draft,newItems:[{draftKey:'n1',item:{...newItem,catalogPriceSnapshot:-1}}]}).error,/цена Каталога изменилась/i)
assert.match(prepareExchangeSetCreation(order,{...draft,paymentAmount:6000}).error,/больше долга/i)
assert.match(prepareExchangeSetCreation(order,{...draft,paymentMethod:''}).error,/способ оплаты/i)
assert.match(prepareExchangeSetCreation(order,{
  ...draft,extraPaymentEnabled:true,extraPaymentAmount:500,extraPaymentMethod:'kaspi',
}).error,/второго способа доплаты/i,'Duplicate payment method should be rejected')
const splitPayment = prepareExchangeSetCreation(order,{
  ...draft,extraPaymentEnabled:true,extraPaymentAmount:500,extraPaymentMethod:'ТЕРМИНАЛ',
})
assert.equal(splitPayment.ok,true)
assert.deepEqual(splitPayment.payload.paymentParts,[
  {method:'KASPI',amount:1500},{method:'ТЕРМИНАЛ',amount:500},
])
const refundOrder = {...order,received_amount:15000}
const refund = prepareExchangeSetCreation(refundOrder,{
  ...draft,paymentAmount:0,paymentMethod:'',refundMethod:'KASPI',
  extraRefundEnabled:true,extraRefundAmount:1000,extraRefundMethod:'НАЛИЧНЫЕ',
})
assert.equal(refund.ok,true)
assert.equal(refund.projectedTotal,12000)
assert.deepEqual(refund.payload.paymentParts,[])
assert.deepEqual(refund.payload.refundParts,[
  {method:'KASPI',amount:2000},{method:'НАЛИЧНЫЕ',amount:1000},
])
assert.match(prepareExchangeSetCreation(refundOrder,draft).error,/Уберите оплату сейчас/i)
assert.match(prepareExchangeSetCreation(refundOrder,{...draft,paymentAmount:0,refundMethod:''}).error,/Выберите способ возврата денег/i)

let attempt=0, drops=true
const sent=[], completed=[], pending=new Map()
const client = {
  prepareCriticalRequest(key,payload) {
    const fingerprint=JSON.stringify(payload)
    let item=pending.get(key)
    if(!item||item.fingerprint!==fingerprint){item={fingerprint,requestId:'set-test-'+(++attempt)};pending.set(key,item)}
    return {requestId:item.requestId,payload:{...payload,requestId:item.requestId}}
  },
  completeCriticalRequest(key,requestId){
    completed.push({key,requestId})
    if(pending.get(key)?.requestId===requestId)pending.delete(key)
  },
  async apiFetch(url,init){
    sent.push({url,method:init.method,header:init.headers['X-Idempotency-Key'],body:JSON.parse(init.body)})
    if(drops){drops=false;throw new Error('Set network unknown')}
    return new Response(JSON.stringify({
      ok:true,oldItemCount:1,newItemCount:1,finalTotalAmount:12000,
      paymentAmount:2000,refundAmount:0,remainingDebt:3000,
    }),{status:200,headers:{'Content-Type':'application/json'}})
  },
}
await assert.rejects(()=>submitExchangeSetCreation(client,valid.payload),/Set network unknown/)
assert.equal(completed.length,0,'Unknown result must preserve the original requestId')
const accepted=await submitExchangeSetCreation(client,valid.payload)
assert.equal(accepted.remainingDebt,3000)
assert.deepEqual(sent.map(x=>x.url),['/api/exchanges/set','/api/exchanges/set'])
assert.deepEqual(sent.map(x=>x.method),['POST','POST'])
assert.equal(sent[0].header,sent[1].header,'Set replay must reuse requestId')
assert.deepEqual(sent[1].body,{...valid.payload,requestId:sent[1].header})
assert.deepEqual(completed,[{key:'exchange-set-create:38',requestId:sent[1].header}])
console.log('EXCHANGE_SET_V2_PREPARATION_AND_CRITICAL_REPLAY_PASS')

console.log('EXCHANGE SET V2 UI PASSED — itemized exchanges use order-quantity-first old cards, progressive replacement fields, plain-language money settlement, full-arrival intake, and responsive manager-first controls.')
