// Exchange Set V2 recorded-price corrections. Price history is separate from
// immutable original exchange execution plans and actual money/stock events.
import { cleanText, toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'

export type ExchangeNewPriceLink = { exchangeId: number; originalUnitPrice: number }

export async function findExchangeNewPriceLink(
  db: D1Database, orderId: number, orderItemId: number, currentUnitPrice: number,
): Promise<ExchangeNewPriceLink | null> {
  const rows = await db.prepare(
    `SELECT e.id AS exchange_id, ei.id AS exchange_item_id, ei.role
     FROM exchanges e
     JOIN exchange_items ei ON ei.exchange_id=e.id
     WHERE e.order_id=? AND ei.order_item_id=?
       AND COALESCE(e.status,'completed')<>'cancelled'
     ORDER BY e.id,ei.id`
  ).bind(orderId,orderItemId).all<Record<string,unknown>>()
  const links = rows.results || []
  if (!links.length) return null
  if (links.length!==1 || cleanText(links[0].role)!=='new') {
    throw new CriticalOperationConflictError(
      'Позиция участвует в нескольких обменах или является старой позицией обмена. Для неё требуется отдельная проверка цепочки.')
  }
  const exchangeId=toInt(links[0].exchange_id,0)
  const snapshot=await db.prepare(
    `SELECT context_json
     FROM critical_operations
     WHERE operation_type='exchange_set_create' AND target_type='exchange' AND target_id=?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(exchangeId).first<{context_json:string|null}>()
  if (!snapshot?.context_json) {
    throw new CriticalOperationConflictError(
      'Обмен создан в старом формате или не имеет безопасного исходного снимка. Цена остаётся защищённой.')
  }
  let plan: any
  try { plan=JSON.parse(snapshot.context_json)?.executionPlan } catch { plan=null }
  const originalRows=await db.prepare(
    `SELECT order_item_id FROM exchange_items WHERE exchange_id=? AND role='new' ORDER BY id ASC`
  ).bind(exchangeId).all<{order_item_id:number}>()
  const index=(originalRows.results||[]).findIndex(r=>toInt(r.order_item_id,0)===orderItemId)
  const original=plan?.newItems?.[index]?.item?.unitPrice
  if (index<0 || !Number.isSafeInteger(original) || original<0
    || (originalRows.results||[]).length!==plan?.newItems?.length) {
    throw new CriticalOperationConflictError('Исходные строки обмена расходятся с его сохранённым планом.')
  }
  if (!await isApprovedExchangePriceLineage(db,exchangeId,orderItemId,original,currentUnitPrice)) {
    throw new CriticalOperationConflictError(
      'Текущая цена позиции не подтверждена историей исправлений. Изменение остановлено до проверки.')
  }
  return {exchangeId,originalUnitPrice:original}
}

export async function isApprovedExchangePriceLineage(
  db: D1Database, exchangeId: number, orderItemId: number,
  originalUnitPrice: number, currentUnitPrice: number, role: 'new' | 'old' = 'new',
): Promise<boolean> {
  const rows=await db.prepare(
    `SELECT original_exchange_unit_price,old_unit_price,new_unit_price,quantity_at_correction
     FROM exchange_order_item_price_corrections
     WHERE exchange_id=? AND order_item_id=? AND role=? ORDER BY id ASC`
  ).bind(exchangeId,orderItemId,role).all<Record<string,unknown>>()
  let approved=originalUnitPrice
  for (const row of rows.results || []) {
    const original=Number(row.original_exchange_unit_price)
    const old=Number(row.old_unit_price)
    const next=Number(row.new_unit_price)
    const quantity=Number(row.quantity_at_correction)
    if (original!==originalUnitPrice || old!==approved
      || !Number.isSafeInteger(next) || next<0
      || !Number.isSafeInteger(quantity) || quantity<=0 || old===next) return false
    approved=next
  }
  return approved===currentUnitPrice
}


// Historical old item is already removed from the live order. Its recorded-price
// correction must remain metadata until a reversible V2 exchange is actually
// cancelled; changing order_items here would falsify the original exchange.
export async function findRetiredV2OldItemPriceLink(
  db: D1Database, exchangeId: number, oldItemId: number,
): Promise<{ exchangeId:number; orderId:number; oldItemId:number; originalUnitPrice:number; currentRecordedUnitPrice:number; originalQuantity:number }> {
  const links=await db.prepare(
    `SELECT e.id AS exchange_id,e.order_id,e.status,ei.role,oi.quantity,oi.unit_price
     FROM exchanges e JOIN exchange_items ei ON ei.exchange_id=e.id
     JOIN order_items oi ON oi.id=ei.order_item_id AND oi.order_id=e.order_id
     WHERE e.id=? AND ei.order_item_id=?`
  ).bind(exchangeId,oldItemId).all<Record<string,unknown>>()
  const rows=links.results||[]
  if(rows.length!==1 || cleanText(rows[0].role)!=='old'
     || cleanText(rows[0].status)==='cancelled' || toInt(rows[0].quantity,-1)!==0)
    throw new CriticalOperationConflictError('Для исправления старой цены требуется одна полностью выведенная позиция действующего обмена.')
  const another=await db.prepare(
    `SELECT COUNT(*) AS qty FROM exchanges e
     JOIN exchange_items ei ON ei.exchange_id=e.id
     WHERE ei.order_item_id=? AND e.id<>? AND COALESCE(e.status,'completed')<>'cancelled'`
  ).bind(oldItemId,exchangeId).first<{qty:number}>()
  if(toInt(another?.qty,0)) throw new CriticalOperationConflictError(
    'Эта позиция участвует в цепочке обменов. Её цену пока нельзя исправлять отдельно от всей цепочки.')
  const create=await db.prepare(
    `SELECT context_json FROM critical_operations
     WHERE operation_type='exchange_set_create' AND target_type='exchange' AND target_id=?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(exchangeId).first<{context_json:string|null}>()
  let plan:any
  try { plan=JSON.parse(create?.context_json||'null')?.executionPlan } catch {plan=null}
  const old=plan?.oldItems?.filter((item:any)=>toInt(item.orderItemId,0)===oldItemId)||[]
  if(old.length!==1 || !Number.isSafeInteger(old[0].unitPrice) || old[0].unitPrice<0
    || !Number.isSafeInteger(old[0].quantity) || old[0].quantity<=0)
    throw new CriticalOperationConflictError('Историческая цена не подтверждена исходным планом обмена V2.')
  const original=old[0].unitPrice
  if(toInt(rows[0].unit_price,-1)!==original)
    throw new CriticalOperationConflictError('Старая позиция уже изменена вне подтверждённой истории.')
  const audits=await db.prepare(
    `SELECT old_unit_price,new_unit_price,original_exchange_unit_price
     FROM exchange_order_item_price_corrections
     WHERE exchange_id=? AND order_item_id=? AND role='old' ORDER BY id ASC`
  ).bind(exchangeId,oldItemId).all<Record<string,unknown>>()
  let current=original
  for(const row of audits.results||[]){
    if(toInt(row.original_exchange_unit_price,-1)!==original
      || toInt(row.old_unit_price,-1)!==current
      || !Number.isSafeInteger(Number(row.new_unit_price)) || Number(row.new_unit_price)<0)
      throw new CriticalOperationConflictError('История старой цены обмена повреждена. Изменение остановлено.')
    current=Number(row.new_unit_price)
  }
  return { exchangeId,orderId:toInt(rows[0].order_id,0),oldItemId,
    originalUnitPrice:original,currentRecordedUnitPrice:current,originalQuantity:old[0].quantity }
}


export async function recordRetiredV2OldPriceCorrection(
  db:D1Database, input:{
    exchangeId:number; oldItemId:number; expectedUnitPrice:number; newUnitPrice:number;
    requestId:string; actorLabel:string;
  },
) {
  const id=toInt(input.exchangeId,0),itemId=toInt(input.oldItemId,0)
  const expected=Number(input.expectedUnitPrice),next=Number(input.newUnitPrice)
  const requestId=cleanText(input.requestId),actor=cleanText(input.actorLabel)
  if(!id||!itemId||!requestId||!actor
    ||!Number.isSafeInteger(expected)||expected<0
    ||!Number.isSafeInteger(next)||next<0||expected===next) {
    throw new CriticalOperationConflictError('Укажите позицию, прежнюю и исправленную цены, причину действия и уникальный номер запроса.')
  }
  const existing=await db.prepare(
    `SELECT order_id,order_item_id,exchange_id,old_unit_price,new_unit_price,role
     FROM exchange_order_item_price_corrections WHERE request_id=?`
  ).bind(requestId).first<Record<string,unknown>>()
  if(existing) {
    if(toInt(existing.exchange_id,0)===id&&toInt(existing.order_item_id,0)===itemId
      &&toInt(existing.old_unit_price,-1)===expected&&toInt(existing.new_unit_price,-1)===next
      &&cleanText(existing.role)==='old')
      return {ok:true,alreadyApplied:true,exchangeId:id,oldItemId:itemId,newUnitPrice:next}
    throw new CriticalOperationConflictError('Этот номер запроса уже использован для другой корректировки.')
  }
  const current=await findRetiredV2OldItemPriceLink(db,id,itemId)
  if(current.currentRecordedUnitPrice!==expected)
    throw new CriticalOperationConflictError('Историческая цена уже исправлена другим сотрудником. Обновите запись.')
  const timestamp=new Date().toISOString()
  const atomic= [
    db.prepare(
      `SELECT json('V2_OLD_PRICE_STALE')
       WHERE NOT EXISTS(
         SELECT 1 FROM exchanges e
         JOIN exchange_items ei ON ei.exchange_id=e.id
         JOIN order_items oi ON oi.id=ei.order_item_id AND oi.order_id=e.order_id
         WHERE e.id=? AND ei.order_item_id=? AND ei.role='old'
           AND e.order_id=? AND COALESCE(e.status,'completed')<>'cancelled'
           AND oi.quantity=0 AND oi.unit_price=?
           AND (SELECT COALESCE(
             (SELECT new_unit_price FROM exchange_order_item_price_corrections
              WHERE exchange_id=e.id AND order_item_id=oi.id AND role='old' ORDER BY id DESC LIMIT 1),?
           ))=?
           AND NOT EXISTS (
             SELECT 1 FROM exchanges other
             JOIN exchange_items other_item ON other_item.exchange_id=other.id
             WHERE other_item.order_item_id=oi.id AND other.id<>e.id
               AND COALESCE(other.status,'completed')<>'cancelled'
           )
           AND NOT EXISTS(
             SELECT 1 FROM critical_operations cancel
             WHERE cancel.operation_type='exchange_set_cancel'
               AND cancel.status='started'
               AND (cancel.target_id=e.id
                 OR CAST(json_extract(cancel.context_json,'$.exchangeId') AS INTEGER)=e.id)
           )
       )`
    ).bind(id,itemId,current.orderId,current.originalUnitPrice,
      current.originalUnitPrice,expected),
    db.prepare(
      `INSERT INTO exchange_order_item_price_corrections(
        request_id,order_id,order_item_id,exchange_id,role,original_exchange_unit_price,
        old_unit_price,new_unit_price,quantity_at_correction,actor_label,corrected_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(requestId,current.orderId,itemId,id,'old',current.originalUnitPrice,
      expected,next,current.originalQuantity,actor,timestamp),
  ]
  try {await db.batch(atomic)} catch(error) {
    const repeated=await db.prepare(
      `SELECT exchange_id,order_item_id,role,old_unit_price,new_unit_price
       FROM exchange_order_item_price_corrections WHERE request_id=?`
    ).bind(requestId).first<Record<string,unknown>>()
    if(repeated&&toInt(repeated.exchange_id,0)===id
      &&toInt(repeated.order_item_id,0)===itemId&&cleanText(repeated.role)==='old'
      &&toInt(repeated.old_unit_price,-1)===expected&&toInt(repeated.new_unit_price,-1)===next)
      return {ok:true,alreadyApplied:true,exchangeId:id,oldItemId:itemId,newUnitPrice:next}
    throw new CriticalOperationConflictError(
      'Цена, цепочка обменов или статус отмены изменились. Обновите историю и повторите действие.')
  }
  // The historic original item remains retired. Its corrected sale price is
  // applied only when a later V2 cancellation passes its full money/stock preflight.
  return {ok:true,exchangeId:id,oldItemId:itemId,oldUnitPrice:expected,
    newUnitPrice:next,physicalStockChanged:false,paymentsChanged:false}
}
