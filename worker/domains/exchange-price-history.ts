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
  originalUnitPrice: number, currentUnitPrice: number,
): Promise<boolean> {
  const rows=await db.prepare(
    `SELECT original_exchange_unit_price,old_unit_price,new_unit_price,quantity_at_correction
     FROM exchange_order_item_price_corrections
     WHERE exchange_id=? AND order_item_id=? ORDER BY id ASC`
  ).bind(exchangeId,orderItemId).all<Record<string,unknown>>()
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
