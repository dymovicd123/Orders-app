// Narrow, version-aware metadata writer for orders with verified Return V2.
// No stock, order_item, payment, refund, financial_event, or money-cache writes.
import { cleanText, normalizePhone } from '../core/text.ts'
import { readVersionedReturnMoney } from './return-v2-financial-projection.ts'

type Fields={
  orderDate:string;customerPhone:string;customerName:string;
  city:string;deliveryType:string;comment:string
}
type Snapshot={
  totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number;
  shippingStatus:string;orderStatus:string
}
export type VersionedMetadataCorrection={
  expected:Fields;next:Fields;expectedState:Snapshot
}
type Input={orderId:number;requestId:string;correction:VersionedMetadataCorrection;
  actorRole:string;actorLabel:string}
type OrderRow={
  id:number;updated_at:string;order_date:string;customer_id:number|null;
  customer_phone:string;customer_name:string;city:string;delivery_type:string;
  comment:string;total_amount:number;received_amount:number;return_amount:number;
  debt_amount:number;shipping_status:string;order_status:string;archived_at:string|null
}
type Recorded={
  request_id:string;order_id:number;intent_json:string;updated_at:string
}
export class ReturnV2MetadataConflict extends Error{
  readonly status=409
  readonly code='return_v2_metadata_conflict'
}
function stop(message:string):never{throw new ReturnV2MetadataConflict(message)}
const fieldNames=['orderDate','customerPhone','customerName','city','deliveryType','comment'] as const
const stateNames=['totalAmount','receivedAmount','debtAmount','returnAmount','shippingStatus','orderStatus'] as const
function exactFields(input:unknown,label:string):Fields{
  if(!input||typeof input!=='object'||Array.isArray(input))
    stop('Обновите заказ: неверные реквизиты '+label+'.')
  const v=input as Record<string,unknown>
  if(Object.keys(v).length!==fieldNames.length
    ||Object.keys(v).some(key=>!fieldNames.includes(key as typeof fieldNames[number]))
    ||fieldNames.some(key=>typeof v[key]!=='string'||String(v[key]).length>500))
    stop('Обновите заказ: реквизиты '+label+' изменились или неполны.')
  return {
    orderDate:cleanText(v.orderDate),customerPhone:cleanText(v.customerPhone),
    customerName:cleanText(v.customerName),city:cleanText(v.city),
    deliveryType:cleanText(v.deliveryType),comment:cleanText(v.comment)
  }
}
function exactState(input:unknown):Snapshot{
  if(!input||typeof input!=='object'||Array.isArray(input))stop('Финансовый снимок не передан.')
  const v=input as Record<string,unknown>
  if(Object.keys(v).length!==stateNames.length
   ||Object.keys(v).some(key=>!stateNames.includes(key as typeof stateNames[number]))
   ||['totalAmount','receivedAmount','debtAmount','returnAmount'].some(key=>
        !Number.isSafeInteger(v[key])||Number(v[key])<0)
   ||typeof v.shippingStatus!=='string'||typeof v.orderStatus!=='string')
    stop('Финансовый снимок заказа некорректен.')
  return {
    totalAmount:v.totalAmount as number,receivedAmount:v.receivedAmount as number,
    debtAmount:v.debtAmount as number,returnAmount:v.returnAmount as number,
    shippingStatus:cleanText(v.shippingStatus),orderStatus:cleanText(v.orderStatus)
  }
}
function validate(input:Input){
  if(!Number.isSafeInteger(input.orderId)||input.orderId<1)stop('Заказ не найден.')
  if(!['admin','manager'].includes(input.actorRole))
    stop('Исправление реквизитов доступно администратору и менеджеру.')
  const requestId=cleanText(input.requestId)
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId))
    stop('Укажите корректный идентификатор сохранения реквизитов.')
  const correction=input.correction
  if(!correction||typeof correction!=='object'||Array.isArray(correction)
    ||Object.keys(correction).length!==3
    ||Object.keys(correction).some(k=>!['expected','next','expectedState'].includes(k)))
    stop('Изменяйте только реквизиты, отдельно от товаров и денег.')
  const expected=exactFields(correction.expected,'до изменения')
  const next=exactFields(correction.next,'после изменения')
  const state=exactState(correction.expectedState)
  if(input.actorRole!=='admin'&&next.orderDate
     &&next.orderDate!==expected.orderDate)
    stop('Менеджер не может изменять дату заказа.')
  const date=next.orderDate||expected.orderDate
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)
     ||Number.isNaN(Date.parse(date+'T00:00:00Z'))
     ||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
    stop('Дата заказа некорректна.')
  const phone=next.customerPhone?normalizePhone(next.customerPhone):''
  if(next.customerPhone&&!phone)stop('Телефон клиента должен содержать цифры.')
  const intent=JSON.stringify({orderId:input.orderId,expected,next,state})
  const actor=cleanText(input.actorLabel)||input.actorRole
  return {requestId,expected,next,state,date,phone,intent,actor}
}
async function saved(db:D1Database,requestId:string){
  return db.prepare('SELECT request_id,order_id,intent_json,updated_at FROM return_v2_metadata_edits WHERE request_id=?')
    .bind(requestId).first<Recorded>()
}
function replay(record:Recorded,w:ReturnType<typeof validate>,orderId:number){
  if(record.order_id!==orderId||record.intent_json!==w.intent)
    stop('Идентификатор операции уже применён к другим реквизитам.')
  return {ok:true,alreadySaved:true,orderId,updatedAt:record.updated_at}
}
function updatedTimestamp(previous:string){
  const parsed=Date.parse(previous)
  if(!Number.isFinite(parsed))stop('Версия заказа некорректна.')
  return new Date(Math.max(Date.now(),parsed+1)).toISOString()
}
export async function updateReturnV2Metadata(db:D1Database,input:Input){
  const w=validate(input)
  const prior=await saved(db,w.requestId)
  if(prior)return replay(prior,w,input.orderId)
  const money=await readVersionedReturnMoney(db,input.orderId)
  if(money.kind!=='return_v2')stop('Для заказа без Return V2 требуется обычный редактор.')
  const row=await db.prepare(`SELECT o.id,o.updated_at,o.order_date,o.customer_id,
      COALESCE(c.phone_normalized,'') AS customer_phone,
      COALESCE(o.customer_name_override,c.display_name,'') AS customer_name,
      COALESCE(o.city,'') AS city,COALESCE(o.delivery_type,'') AS delivery_type,
      COALESCE(o.comment,'') AS comment,
      o.total_amount,COALESCE(o.received_amount,0) AS received_amount,
      COALESCE(o.return_amount,0) AS return_amount,
      COALESCE(o.debt_amount,0) AS debt_amount,
      COALESCE(o.shipping_status,'') AS shipping_status,
      COALESCE(o.order_status,'') AS order_status,o.archived_at
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`)
    .bind(input.orderId).first<OrderRow>()
  if(!row)stop('Заказ не найден.')
  if(row.archived_at!==null||['archived','deleted'].includes(row.order_status))
    stop('Архивный или удалённый заказ нельзя исправлять.')
  const current:Fields={
    orderDate:cleanText(row.order_date),customerPhone:cleanText(row.customer_phone),
    customerName:cleanText(row.customer_name),city:cleanText(row.city),
    deliveryType:cleanText(row.delivery_type),comment:cleanText(row.comment)
  }
  if(fieldNames.some(k=>current[k]!==w.expected[k])
    ||row.total_amount!==w.state.totalAmount
    ||row.received_amount!==w.state.receivedAmount
    ||row.return_amount!==w.state.returnAmount
    ||row.debt_amount!==w.state.debtAmount
    ||row.shipping_status!==w.state.shippingStatus
    ||row.order_status!==w.state.orderStatus
    ||money.orderVersion!==row.updated_at
    ||money.currentSale!==row.total_amount
    ||money.paidIn!==row.received_amount
    ||money.paidOut!==row.return_amount
    ||money.customerDebt!==row.debt_amount)
    stop('После открытия редактора изменились реквизиты, статус или деньги. Обновите заказ.')
  const stamp=updatedTimestamp(row.updated_at)
  const statements:D1PreparedStatement[]=[
    db.prepare(`SELECT json('RETURN_V2_METADATA_STALE') WHERE NOT EXISTS(
      SELECT 1 FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
      WHERE o.id=? AND o.updated_at=? AND o.order_date=?
        AND COALESCE(c.phone_normalized,'')=?
        AND COALESCE(o.customer_name_override,c.display_name,'')=?
        AND COALESCE(o.city,'')=? AND COALESCE(o.delivery_type,'')=?
        AND COALESCE(o.comment,'')=?
        AND o.total_amount=? AND COALESCE(o.received_amount,0)=?
        AND COALESCE(o.debt_amount,0)=? AND COALESCE(o.return_amount,0)=?
        AND COALESCE(o.shipping_status,'')=?
        AND COALESCE(o.order_status,'')=?
        AND o.archived_at IS NULL AND o.order_status NOT IN ('archived','deleted')
        AND (SELECT COUNT(*) FROM return_v2_postings vp WHERE vp.order_id=o.id)
          +(SELECT COUNT(*) FROM return_v2_unified_postings up WHERE up.order_id=o.id)=1
        AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id
          AND COALESCE(e.status,'completed')<>'cancelled')
        AND NOT EXISTS(SELECT 1 FROM critical_operations co
          WHERE co.operation_type='order_edit' AND co.status='started'
            AND CAST(json_extract(co.context_json,'$.orderId') AS INTEGER)=o.id)
    )`).bind(input.orderId,row.updated_at,w.expected.orderDate,w.expected.customerPhone,
       w.expected.customerName,w.expected.city,w.expected.deliveryType,w.expected.comment,
       w.state.totalAmount,w.state.receivedAmount,w.state.debtAmount,w.state.returnAmount,
       w.state.shippingStatus,w.state.orderStatus),
    db.prepare(`INSERT INTO customers(phone_normalized,display_name,city,orders_count,created_at,updated_at)
      SELECT ?,?,?,0,?,? WHERE ?<>''
      ON CONFLICT(phone_normalized) DO NOTHING`)
      .bind(w.phone,w.next.customerName||null,w.next.city||null,stamp,stamp,w.phone),
    db.prepare(`UPDATE orders SET order_date=?,
      customer_id=CASE WHEN ?<>'' THEN
        (SELECT id FROM customers WHERE phone_normalized=?) ELSE NULL END,
      customer_name_override=?,city=?,delivery_type=?,comment=?,updated_at=?
      WHERE id=? AND updated_at=? AND total_amount=? AND COALESCE(received_amount,0)=?
        AND COALESCE(return_amount,0)=? AND COALESCE(debt_amount,0)=?`)
      .bind(w.date,w.phone,w.phone,w.next.customerName,w.next.city||null,
        w.next.deliveryType||null,w.next.comment||null,stamp,input.orderId,
        row.updated_at,w.state.totalAmount,w.state.receivedAmount,
        w.state.returnAmount,w.state.debtAmount),
    db.prepare("SELECT json('RETURN_V2_METADATA_WRITE_CONFLICT') WHERE changes()<>1"),
    db.prepare(`INSERT INTO return_v2_metadata_edits(
       request_id,order_id,intent_json,previous_updated_at,updated_at,actor_label,created_at)
       VALUES(?,?,?,?,?,?,?)`)
      .bind(w.requestId,input.orderId,w.intent,row.updated_at,stamp,w.actor,stamp),
  ]
  try{await db.batch(statements)}
  catch(error){
    const prior=await saved(db,w.requestId)
    if(prior)return replay(prior,w,input.orderId)
    const detail=error instanceof Error?error.message:String(error)
    if(/RETURN_V2_METADATA_|malformed JSON|UNIQUE|constraint failed/i.test(detail))
      stop('Реквизиты изменились одновременно с сохранением. Ничего не перезаписано.')
    throw error
  }
  return {ok:true,alreadySaved:false,orderId:input.orderId,updatedAt:stamp,
    customerDebt:money.customerDebt,storeOwesCustomer:money.customerOverpay,
    refreshRequired:true}
}
