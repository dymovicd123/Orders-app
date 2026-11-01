// Stage 3.7 REAL workerd + native temporary D1 multi-source lifecycle.
// No remote database access. The caller owns a disposable local Worker fixture.
import assert from 'node:assert/strict'

export function stage3NativeFixtureSQL(adminTokenHash) {
  const old = 'STAGE3 NATIVE ORIGINAL'
  const replacement = 'STAGE3 NATIVE REPLACEMENT'
  const stock = (id,source,product,variant,name,color,quantity) =>
   `INSERT INTO inventory_stock (id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity)
      VALUES (${id},'${source}',${product},${variant},'${name}','МУЖ','${color}','СТАНДАРТ','СТАНДАРТ','50',${quantity},0);`
  return [
   // Local original versioned schema gap #648, not a production migration.
   'ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT;',
   `CREATE TABLE order_manager_audit(
    id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id),
    external_id TEXT NOT NULL,previous_manager_id INTEGER,previous_manager_name TEXT,
    new_manager_id INTEGER,new_manager_name TEXT,action TEXT NOT NULL,source TEXT NOT NULL,
    actor_role TEXT,actor_label TEXT,details TEXT,created_at TEXT NOT NULL);`,
   "INSERT INTO managers(id,name,role,is_active) VALUES(9830,'Stage3 Director','Директор',1);",
   "INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9830,'stage3admin','stage3@invalid','local-fixture-only','admin',9830,'Stage3 Director',1,0);",
   `INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(9830,'${adminTokenHash}','2099-01-01T00:00:00.000Z');`,
   `INSERT INTO catalog_products(id,name,category,is_active) VALUES(9831,'${old}','adult',1);`,
   `INSERT INTO catalog_products(id,name,category,is_active) VALUES(9832,'${replacement}','adult',1);`,
   `INSERT INTO catalog_stock_positions(product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at)
     VALUES(9831,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');`,
   `INSERT INTO catalog_stock_positions(product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at)
     VALUES(9832,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');`,
   `INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active,stock_position_id)
      SELECT 9841,9831,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50','adult',1,id FROM catalog_stock_positions WHERE product_id=9831;`,
   `INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active,stock_position_id)
      SELECT 9842,9832,'МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','50','adult',1,id FROM catalog_stock_positions WHERE product_id=9832;`,
   stock(9851,'warehouse',9831,9841,old,'БЕЖ',5),
   stock(9852,'boutique',9831,9841,old,'БЕЖ',5),
   stock(9853,'boutique',9832,9842,replacement,'ЧЕРНЫЙ',5),
  ].join('\n')
}

export async function runStage3NativeAcceptance({api, token}) {
 const call=(method,path,body)=>api(method,path,body,true,token)
 const q=(v)=>encodeURIComponent(v)
 const oldName='STAGE3 NATIVE ORIGINAL',newName='STAGE3 NATIVE REPLACEMENT'
 const orderItem=(source,qty=1,price=1000)=>({
   productName:oldName,audienceType:'ВЗРОСЛЫЙ',gender:'МУЖ',color:'БЕЖ',
   material:'СТАНДАРТ',length:'СТАНДАРТ',size:'50',
   quantity:qty,unitPrice:price,catalogPriceSnapshot:null,sourceType:source,
   shortageAcknowledged:false,shortageDecision:null,
 })
 const replacement=(state='sent')=>({
   ...orderItem('boutique',1,1500),productName:newName,color:'ЧЕРНЫЙ',
   shipmentState:state,...(state==='sent'?{issuePossessionConfirmed:true}:{}),
 })
 const payload={requestId:'stage3-native-37-create',externalId:'STAGE3-NATIVE-37',
  orderDate:'2026-11-01',managerId:9830,managerName:'Stage3 Director',
  customerName:'Native E2E',customerPhone:'',city:'',deliveryType:'',
  orderPaymentMethod:'',sourceType:'warehouse',workshopStatus:'in_workshop',
  orderStatus:'active',pricingMode:'itemized_v1',
  items:[orderItem('warehouse',2,1000),orderItem('boutique',1,1500)],payments:[]}
 const getOrder=async()=>{
   const result=await call('GET','/api/orders?q=STAGE3-NATIVE-37&limit=20&includePeriodStats=0')
   assert.equal(result.status,200,'Real native D1 orders GET: '+JSON.stringify(result))
   const record=(result.data.orders||[]).find(o=>o.external_id==='STAGE3-NATIVE-37')
   assert(record,'Exact created order must be listable from D1: '+JSON.stringify(result.data).slice(0,1600))
   return record
 }
 const hist=async(source,variant)=> {
   const r=await call('GET',`/api/inventory/history?source=${source}&variantId=${variant}&limit=100`)
   assert.equal(r.status,200,'History '+source+'/'+variant+' '+JSON.stringify(r))
   return r.data.movements||[]
 }
 const reservations=async(source,variant)=> {
   const r=await call('GET',`/api/inventory/reservations?source=${source}&variantId=${variant}`)
   assert.equal(r.status,200,'Reservation '+source+'/'+variant+' '+JSON.stringify(r))
   return r.data
 }
 const stockQty=async(source,variant)=>{
  const moves=await hist(source,variant)
  if(!moves.length) return null
  return Number(moves[0].quantityAfter)
 }
 // Actual create and scoped reserves, no best-effort orphan rows.
 const create=await call('POST','/api/orders',payload)
 assert.equal(create.status,201,'Create two-source itemized order: '+JSON.stringify(create))
 const id=Number(create.data.orderId);assert(id>0)
 const order=await getOrder()
 assert.equal(Number(order.id),id)
 const lines=order.items||[]
 const wh=lines.find(x=>x.sourceType==='warehouse'),bt=lines.find(x=>x.sourceType==='boutique')
 assert(wh&&bt&&wh.id!==bt.id,'Both canonical order_items must be distinct')
 assert.equal(Number(wh.variantId),9841)
 assert.equal(Number(bt.variantId),9841)
 assert.equal((await reservations('warehouse',9841)).totalQuantity,2)
 assert.equal((await reservations('boutique',9841)).totalQuantity,1)
 const replayCreate=await call('POST','/api/orders',payload)
 assert.equal(replayCreate.status,201)
 assert.equal(Number(replayCreate.data.orderId),id)
 const beforeShipWh=await hist('warehouse',9841),beforeShipBt=await hist('boutique',9841)
 const ship=await call('PATCH',`/api/orders/${id}/shipping`,{
  requestId:'stage3-native-37-send',shippingStatus:'sent',shippingDate:'2026-11-01',
 })
 assert.equal(ship.status,200,'Original two-source physical handover: '+JSON.stringify(ship))
 const sentWh=await hist('warehouse',9841),sentBt=await hist('boutique',9841)
 assert.equal(sentWh.length-beforeShipWh.length,1,'Warehouse physically decremented exactly once')
 assert.equal(sentBt.length-beforeShipBt.length,1,'Boutique physically decremented exactly once')
 assert.equal(Number(sentWh[0].quantityDelta),-2)
 assert.equal(Number(sentBt[0].quantityDelta),-1)
 assert.equal((await reservations('warehouse',9841)).totalQuantity,0)
 assert.equal((await reservations('boutique',9841)).totalQuantity,0)
 const shipReplay=await call('PATCH',`/api/orders/${id}/shipping`,{
  requestId:'stage3-native-37-send',shippingStatus:'sent',shippingDate:'2026-11-01',
 })
 assert.equal(shipReplay.status,200)
 assert.equal((await hist('warehouse',9841)).length,sentWh.length)
 assert.equal((await hist('boutique',9841)).length,sentBt.length)

 // Money-only return must not mutate physical stock or reopen an active reserve.
 const moneyReturn=await call('POST','/api/returns',{
  requestId:'stage3-native-37-money',orderId:id,returnDate:'2026-11-01',
  amount:100,refundMethod:'НАЛИЧНЫЕ',items:[],
 })
 assert.equal(moneyReturn.status,201,'Money-only Return: '+JSON.stringify(moneyReturn))
 assert.equal((await hist('warehouse',9841)).length,sentWh.length)
 assert.equal((await hist('boutique',9841)).length,sentBt.length)
 // A different physical unit enters Warehouse exactly once on confirmed receipt.
 const actualReturn=await call('POST','/api/returns',{
  requestId:'stage3-native-37-partial',orderId:id,returnDate:'2026-11-01',amount:0,
  items:[{orderItemId:Number(wh.id),quantity:1,physicalState:'warehouse',restock:true}],
 })
 assert.equal(actualReturn.status,201,'Partial physical Return: '+JSON.stringify(actualReturn))
 const returnId=Number(actualReturn.data.returnId);assert(returnId)
 const back=await hist('warehouse',9841)
 assert.equal(back.length,sentWh.length+1)
 assert.equal(Number(back[0].quantityDelta),1)
 assert.equal(Number(back[0].variantId),9841)
 assert.equal((await reservations('warehouse',9841)).totalQuantity,0)
 const returnReplay=await call('POST','/api/returns',{
  requestId:'stage3-native-37-partial',orderId:id,returnDate:'2026-11-01',amount:0,
  items:[{orderItemId:Number(wh.id),quantity:1,physicalState:'warehouse',restock:true}],
 })
 assert.equal(returnReplay.status,201)
 assert.equal(Number(returnReplay.data.returnId),returnId)
 assert.equal((await hist('warehouse',9841)).length,back.length)
 // Boutique original and new replacement must never share identity.
 const fresh=await getOrder(),boutiqueItem=(fresh.items||[]).find(x=>x.id===bt.id)
 assert(boutiqueItem)
 const oldPrice=Number(boutiqueItem.unitPrice)
 assert.equal(oldPrice,1500)
 const newBefore=await hist('boutique',9842)
 const exchangeBody={requestId:'stage3-native-37-exchange',orderId:id,
  exchangeDate:'2026-11-01',expectedOrderTotal:Number(fresh.total_amount),
  oldItems:[{orderItemId:Number(bt.id),quantity:1,physicalState:'boutique',
   expectedActiveQuantity:1,expectedUnitPrice:1500,expectedLineTotal:1500,
   expectedCatalogPriceSnapshot:null}],
  newItems:[replacement('sent')],paymentAmount:0,paymentMethod:'',refundMethod:''}
 const swap=await call('POST','/api/exchanges/set',exchangeBody)
 assert.equal(swap.status,201,'Canonical Set V2 exchanged old Boutique for new distinct SKU: '+JSON.stringify(swap))
 const exchangeId=Number(swap.data.exchangeId);assert(exchangeId)
 const replaced=await getOrder()
 const newLine=(replaced.items||[]).find(x=>Number(x.variantId)===9842)
 assert(newLine&&newLine.sourceType==='boutique','Replacement uses exact new variant and source')
 const oldLine=(replaced.items||[]).find(x=>x.id===bt.id)
 assert.equal(Number(oldLine.variantId),9841,'Original sold SKU never rewritten')
 assert.equal(Number(oldLine.unitPrice),1500,'Historical price frozen')
 const oldBoutiqueHistory=await hist('boutique',9841)
 const newBoutiqueHistory=await hist('boutique',9842)
 assert.equal(oldBoutiqueHistory.length,sentBt.length+1,'Old Boutique physical +1')
 assert.equal(Number(oldBoutiqueHistory[0].quantityDelta),1)
 assert.equal(newBoutiqueHistory.length,newBefore.length+1,'New SKU shipped once')
 assert.equal(Number(newBoutiqueHistory[0].quantityDelta),-1)
 assert.equal(Number(newBoutiqueHistory[0].variantId),9842)
 assert.equal((await hist('warehouse',9842)).length,0,'Different-source SKU history isolation')
 const swapReplay=await call('POST','/api/exchanges/set',exchangeBody)
 assert.equal(swapReplay.status,201)
 assert.equal(Number(swapReplay.data.exchangeId),exchangeId)
 assert.equal((await hist('boutique',9841)).length,oldBoutiqueHistory.length)
 assert.equal((await hist('boutique',9842)).length,newBoutiqueHistory.length)
 const finished=await getOrder()
 assert.equal(Number(finished.total_amount),Number(replaced.total_amount))
 assert.equal(Number(finished.received_amount),Number(replaced.received_amount))
 assert.equal((await reservations('warehouse',9841)).totalQuantity,0)
 assert.equal((await reservations('boutique',9841)).totalQuantity,0)
 console.log('STAGE3_7_NATIVE_MULTISOURCE_LIFECYCLE_PASS: create+edit identity, two-source shipping, separate money-only and physical Return, exact new Exchange SKU, all replay-safe, frozen original price and no phantom reserves')
}
