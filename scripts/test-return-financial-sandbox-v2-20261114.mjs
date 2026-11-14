// Isolated prototype only: no Worker route, no D1 migration or production changes.
// Models purchase obligations, money, quantity claims and independently confirmed intake.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readOrderFinancialLedger } from '../worker/domains/money.ts'
import { deriveExchangeSetSettlement } from '../worker/domains/order-exchange-set-v2.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE sandbox_orders(id TEXT PRIMARY KEY,original_total INTEGER NOT NULL)",
 "CREATE TABLE sandbox_lines(order_id TEXT NOT NULL,sku TEXT NOT NULL,unit_sold_price INTEGER NOT NULL,quantity INTEGER NOT NULL,PRIMARY KEY(order_id,sku))",
 "CREATE TABLE sandbox_events(event_key TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,sku TEXT,quantity INTEGER NOT NULL,price_delta INTEGER NOT NULL,cash_in INTEGER NOT NULL,cash_out INTEGER NOT NULL,method TEXT NOT NULL)",
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,total_amount INTEGER NOT NULL)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,amount INTEGER NOT NULL)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT)"
].join(';\n')+';')

const integer=(value,name,allowNegative=false)=>{
 assert(Number.isSafeInteger(value),name+' must be a safe integer')
 if(!allowNegative)assert(value>=0,name+' must be nonnegative')
 return value
}
const sum=(orderId,field,where='1=1',args=[])=>{
 const q='SELECT COALESCE(SUM('+field+'),0) AS n FROM sandbox_events WHERE order_id=? AND '+where
 return sql.prepare(q).get(orderId,...args).n
}
const projection=orderId=>{
 const row=sql.prepare('SELECT original_total FROM sandbox_orders WHERE id=?').get(orderId)
 assert(row,'Unknown sandbox order '+orderId)
 const priceDelta=sum(orderId,'price_delta')
 const paidIn=sum(orderId,'cash_in')
 const paidOut=sum(orderId,'cash_out')
 const currentSale=integer(row.original_total+priceDelta,'currentSale')
 const netHeld=integer(paidIn-paidOut,'netHeld')
 const signedBalance=currentSale-netHeld
 return {
  originalSale:row.original_total,currentSale,paidIn,paidOut,netHeld,
  signedBalance,customerDebt:Math.max(0,signedBalance),
  customerOverpay:Math.max(0,-signedBalance),
  receivedToStock:sum(orderId,'quantity',"kind='receive_stock'"),
  receivedWithoutStock:sum(orderId,'quantity',"kind='receive_no_stock'")
 }
}
const available=(orderId,sku)=>{
 const line=sql.prepare('SELECT unit_sold_price,quantity FROM sandbox_lines WHERE order_id=? AND sku=?').get(orderId,sku)
 assert(line,'Exact sold SKU/price snapshot is required: '+sku)
 const removed=sum(orderId,'quantity',"sku=? AND kind IN ('return_goods','cancel_unissued','exchange_remove')",[sku])
 return {unitPrice:line.unit_sold_price,quantity:line.quantity,remaining:line.quantity-removed}
}
let nextId=1
function seed(lines,paidIn=0){
 const orderId='S'+nextId++
 const total=lines.reduce((n,line)=>n+integer(line.price,'sale price')*integer(line.qty,'initial quantity'),0)
 sql.prepare('INSERT INTO sandbox_orders VALUES(?,?)').run(orderId,total)
 for(const line of lines)sql.prepare('INSERT INTO sandbox_lines VALUES(?,?,?,?)').run(orderId,line.sku,line.price,line.qty)
 if(paidIn)apply(orderId,orderId+':initial','payment',{cashIn:paidIn,method:'KASPI'})
 return orderId
}
function apply(orderId,key,kind,raw={}){
 const entry={
  key,orderId,kind,sku:raw.sku||null,
  qty:integer(raw.qty??0,'qty'),priceDelta:integer(raw.priceDelta??0,'priceDelta',true),
  cashIn:integer(raw.cashIn??0,'cashIn'),cashOut:integer(raw.cashOut??0,'cashOut'),
  method:raw.method||''
 }
 sql.exec('SAVEPOINT financial_sandbox')
 try {
  const previous=sql.prepare('SELECT * FROM sandbox_events WHERE event_key=?').get(key)
  if(previous){
   const wanted=[entry.orderId,entry.kind,entry.sku,entry.qty,entry.priceDelta,entry.cashIn,entry.cashOut,entry.method]
   const actual=[previous.order_id,previous.kind,previous.sku,previous.quantity,previous.price_delta,previous.cash_in,previous.cash_out,previous.method]
   assert.deepEqual(actual,wanted,'Same request key with changed content must be rejected')
   sql.exec('RELEASE financial_sandbox')
   return {replayed:true}
  }
  const before=projection(orderId)
  const kinds=new Set(['payment','return_goods','cancel_unissued','exchange_remove','exchange_add','compensation','refund','refund_overpay','price_correction','receive_stock','receive_no_stock'])
  assert(kinds.has(kind),'Unsupported operation kind')
  if(kind==='payment'){
   assert(entry.cashIn>0 && !entry.cashOut && !entry.priceDelta && !entry.qty,'Payment must not mutate purchase or stock')
  }else if(kind==='return_goods'||kind==='cancel_unissued'||kind==='exchange_remove'){
   const a=available(orderId,entry.sku)
   assert(entry.qty>0 && entry.qty<=a.remaining,'Cannot return/exchange an already removed unit')
   assert.equal(entry.priceDelta,-a.unitPrice*entry.qty,'Removed value must use the immutable sold unit price')
   assert.equal(entry.cashIn,0)
   if(kind==='cancel_unissued')assert.equal(entry.cashOut,0,'Cancel before issue must not automatically pay money')
  }else if(kind==='exchange_add'){
   assert(entry.qty>0 && entry.priceDelta>=0 && !entry.cashIn && !entry.cashOut)
   assert(!sql.prepare('SELECT 1 FROM sandbox_lines WHERE order_id=? AND sku=?').get(orderId,entry.sku),'Replacement SKU must be new to this sandbox order')
   assert.equal(entry.priceDelta%entry.qty,0,'Exact new effective unit sale price required')
   sql.prepare('INSERT INTO sandbox_lines VALUES(?,?,?,?)').run(orderId,entry.sku,entry.priceDelta/entry.qty,entry.qty)
  }else if(kind==='compensation'){
   assert(entry.priceDelta<0 && entry.cashOut>=0 && !entry.cashIn && !entry.qty)
  }else if(kind==='refund'||kind==='refund_overpay'){
   assert(!entry.priceDelta && !entry.qty && !entry.cashIn && entry.cashOut>0)
   if(kind==='refund_overpay')assert(entry.cashOut<=before.customerOverpay,'Cannot return overpayment that does not exist')
  }else if(kind==='price_correction'){
   assert(entry.priceDelta!==0 && !entry.cashIn && !entry.cashOut && !entry.qty)
  }else if(kind==='receive_stock'||kind==='receive_no_stock'){
   assert(entry.qty>0 && !entry.priceDelta && !entry.cashIn && !entry.cashOut)
   const returned=sum(orderId,'quantity',"sku=? AND kind IN ('return_goods','exchange_remove')",[entry.sku])
   const received=sum(orderId,'quantity',"sku=? AND kind IN ('receive_stock','receive_no_stock')",[entry.sku])
   assert(entry.qty<=returned-received,'Cannot physically receive more than was returned by client')
  }
  if(entry.cashIn>0||entry.cashOut>0)assert(entry.method,'Real payment method required for money movement')
  if(entry.cashOut>before.netHeld+entry.cashIn)throw Error('Cannot refund more cash than was actually received and retained')
  if(before.currentSale+entry.priceDelta<0)throw Error('Final contractual value cannot be negative')
  sql.prepare('INSERT INTO sandbox_events VALUES(?,?,?,?,?,?,?,?,?)').run(
   key,orderId,kind,entry.sku,entry.qty,entry.priceDelta,entry.cashIn,entry.cashOut,entry.method
  )
  sql.exec('RELEASE financial_sandbox')
  return {replayed:false}
 }catch(e){sql.exec('ROLLBACK TO SAVEPOINT financial_sandbox');sql.exec('RELEASE financial_sandbox');throw e}
}
const expect=(orderId,wanted)=>{
 const p=projection(orderId)
 for(const [name,value] of Object.entries(wanted))assert.equal(p[name],value,orderId+' '+name)
 return p
}
const item={sku:'VEST-BEIGE-46',price:30000,qty:1}
const second={sku:'SHAPAN-RED-48',price:70000,qty:1}
const original=[item,second]

const full=seed(original,100000)
apply(full,'return-full','return_goods',{sku:item.sku,qty:1,priceDelta:-30000,cashOut:30000,method:'CASH'})
expect(full,{originalSale:100000,currentSale:70000,netHeld:70000,customerDebt:0,customerOverpay:0,receivedToStock:0})

for(const [paid,refund,debt] of [[60000,0,10000],[60000,20000,30000],[60000,30000,40000],[0,0,70000]]){
 const id=seed(original,paid)
 apply(id,id+':return','return_goods',{sku:item.sku,qty:1,priceDelta:-30000,cashOut:refund,method:refund?'KASPI':''})
 expect(id,{currentSale:70000,paidIn:paid,paidOut:refund,customerDebt:debt})
}

const partial=seed([{sku:'VEST-ONE-SIZE',qty:2,price:15000}],30000)
apply(partial,'return-1','return_goods',{sku:'VEST-ONE-SIZE',qty:1,priceDelta:-15000,cashOut:15000,method:'CARD'})
expect(partial,{currentSale:15000,customerDebt:0,receivedToStock:0})
apply(partial,'intake-1','receive_stock',{sku:'VEST-ONE-SIZE',qty:1})
expect(partial,{currentSale:15000,receivedToStock:1,paidOut:15000})
assert.deepEqual(apply(partial,'intake-1','receive_stock',{sku:'VEST-ONE-SIZE',qty:1}),{replayed:true})
apply(partial,'return-2','return_goods',{sku:'VEST-ONE-SIZE',qty:1,priceDelta:-15000,cashOut:15000,method:'CASH'})
apply(partial,'intake-2','receive_no_stock',{sku:'VEST-ONE-SIZE',qty:1})
expect(partial,{currentSale:0,netHeld:0,receivedToStock:1,receivedWithoutStock:1})
assert.throws(()=>apply(partial,'return-3','return_goods',{sku:'VEST-ONE-SIZE',qty:1,priceDelta:-15000}),/already removed/)
assert.throws(()=>apply(partial,'intake-3','receive_stock',{sku:'VEST-ONE-SIZE',qty:1}),/physically receive/)

const cancelled=seed(original,60000)
apply(cancelled,'cancel-not-issued','cancel_unissued',{sku:item.sku,qty:1,priceDelta:-30000})
expect(cancelled,{currentSale:70000,netHeld:60000,customerDebt:10000,receivedToStock:0})
assert.throws(()=>apply(cancelled,'cancel-again','cancel_unissued',{sku:item.sku,qty:1,priceDelta:-30000}),/already removed/)
assert.throws(()=>apply(cancelled,'fake-intake','receive_stock',{sku:item.sku,qty:1}),/physically receive/)

const compensated=seed(original,100000)
apply(compensated,'discount-10k','compensation',{priceDelta:-10000,cashOut:10000,method:'KASPI'})
expect(compensated,{currentSale:90000,netHeld:90000,customerDebt:0,receivedToStock:0})

const overpaid=seed(original,110000)
expect(overpaid,{currentSale:100000,customerOverpay:10000})
apply(overpaid,'payback-10k','refund_overpay',{cashOut:10000,method:'TRANSFER'})
expect(overpaid,{currentSale:100000,netHeld:100000,customerOverpay:0,customerDebt:0})
assert.throws(()=>apply(overpaid,'payback-again','refund_overpay',{cashOut:10000,method:'TRANSFER'}),/overpayment that does not exist/)

const cheaper=seed(original,100000)
apply(cheaper,'exchange-old','exchange_remove',{sku:item.sku,qty:1,priceDelta:-30000})
apply(cheaper,'exchange-new','exchange_add',{sku:'VEST-NEW-RED',qty:1,priceDelta:20000})
apply(cheaper,'exchange-refund','refund',{cashOut:10000,method:'CASH'})
expect(cheaper,{currentSale:90000,netHeld:90000,customerDebt:0})
apply(cheaper,'correction','price_correction',{priceDelta:10000})
expect(cheaper,{currentSale:100000,netHeld:90000,customerDebt:10000})
apply(cheaper,'debt-close','payment',{cashIn:10000,method:'CARD'})
expect(cheaper,{currentSale:100000,netHeld:100000,customerDebt:0})
assert.deepEqual(deriveExchangeSetSettlement({currentTotalAmount:100000,currentNetPaid:100000,removedValue:30000,addedValue:20000,paymentAmount:0}).refundAmount,10000)

const dearer=seed(original,100000)
apply(dearer,'old','exchange_remove',{sku:item.sku,qty:1,priceDelta:-30000})
apply(dearer,'new','exchange_add',{sku:'VEST-PREMIUM',qty:1,priceDelta:50000})
expect(dearer,{currentSale:120000,customerDebt:20000})
apply(dearer,'extra','payment',{cashIn:20000,method:'CARD'})
expect(dearer,{currentSale:120000,netHeld:120000,customerDebt:0})
assert.equal(deriveExchangeSetSettlement({currentTotalAmount:100000,currentNetPaid:100000,removedValue:30000,addedValue:50000,paymentAmount:20000}).remainingDebt,0)

const mixed=seed(original)
apply(mixed,'paid-kaspi','payment',{cashIn:50000,method:'KASPI'})
apply(mixed,'paid-cash','payment',{cashIn:50000,method:'CASH'})
apply(mixed,'goods','return_goods',{sku:item.sku,qty:1,priceDelta:-30000})
apply(mixed,'refund-cash','refund',{cashOut:10000,method:'CASH'})
apply(mixed,'refund-transfer','refund',{cashOut:20000,method:'TRANSFER'})
expect(mixed,{currentSale:70000,netHeld:70000,customerDebt:0,receivedToStock:0})
assert.deepEqual(apply(mixed,'refund-transfer','refund',{cashOut:20000,method:'TRANSFER'}),{replayed:true})
assert.throws(()=>apply(mixed,'refund-transfer','refund',{cashOut:10000,method:'TRANSFER'}),/Same request key/)
assert.throws(()=>apply(mixed,'too-much-money','refund',{cashOut:80000,method:'KASPI'}),/Cannot refund more cash/)

const stockBefore=sql.prepare("SELECT COUNT(*) n FROM sandbox_events WHERE kind='receive_stock'").get().n
const sentLegacy=seed(original,100000)
apply(sentLegacy,'old-issued-return','return_goods',{sku:item.sku,qty:1,priceDelta:-30000,cashOut:30000,method:'KASPI'})
assert.equal(sql.prepare("SELECT COUNT(*) n FROM sandbox_events WHERE kind='receive_stock'").get().n,stockBefore,'Old issued Return does not itself create physical +1')
expect(sentLegacy,{currentSale:70000,receivedToStock:0})

const actualSql=new DatabaseSync(':memory:')
actualSql.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY,total_amount INTEGER NOT NULL);CREATE TABLE payments(order_id INTEGER,amount INTEGER);CREATE TABLE returns(order_id INTEGER,amount INTEGER,status TEXT)")
actualSql.prepare('INSERT INTO orders VALUES(1,?)').run(80000)
actualSql.prepare('INSERT INTO payments VALUES(1,?)').run(100000)
actualSql.prepare("INSERT INTO returns VALUES(1,30000,'completed')").run()
const actualDb={prepare(q){return {bind(...args){return {async first(){return actualSql.prepare(q).get(...args)||null}}}}}}
const currentLedger=await readOrderFinancialLedger(actualDb,1)
assert.deepEqual(currentLedger,{totalAmount:80000,receivedAmount:100000,returnAmount:30000,debtAmount:0})
assert.equal(80000-(currentLedger.receivedAmount-currentLedger.returnAmount),10000,
 'Synthetic debt truth differs from present Main formula without mutating it')
actualSql.close()

assert.equal(sql.prepare('SELECT COUNT(*) n FROM sandbox_orders').get().n,13)
sql.close()
console.log('RETURN_FINANCIAL_SANDBOX_V2_PASS: 13 isolated SQLite orders, historic prices, net money, debts/overpayments, partial returns, refunds, idempotency, compensation, exchanges, no physical auto-credit, existing Main debt discrepancy documented; NO runtime/model migration')
