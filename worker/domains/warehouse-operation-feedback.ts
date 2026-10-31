import { publicApiError } from '../core/http.ts'
import { cleanText } from '../core/text.ts'

type WarehouseOperation = 'arrival' | 'manual_set' | 'writeoff' | 'transfer'
export type WarehouseOperationFeedback = {status:number;code:string;message:string;reference?:string}

/**
 * Operational failures must distinguish stale stock and safety blocks from
 * technical persistence failures without exposing SQL or internal schema.
 */
export function warehouseOperationFeedback(
  error: unknown, kind: WarehouseOperation, requestId: unknown,
): WarehouseOperationFeedback {
  const raw = cleanText(error instanceof Error ? error.message : error)
  const base = publicApiError(error)
  const lower = raw.toLocaleLowerCase('ru')
  const reference = cleanText(requestId).replace(/[^a-zA-Z0-9_-]/g,'').slice(-12)
  // A rejected canonical SKU on Arrival is a correct business validation
  // failure, not a database outage. Physical stock was not modified.
  // Keep this exact scoped marker narrow; SQL or persistence errors must stay 500.
  if (kind === 'arrival' && /^Приход «[^»]+»:/.test(raw) && raw.endsWith('Склад не изменён.')) {
    return {status:409,code:'warehouse_sku_mismatch',message:raw.slice(0,420)}
  }
  if (/остатк[иа]? изменил|остатки изменились|было \d+, сейчас \d+|вариант больше не существует|комбинаци[яи] больше не существует/.test(lower)) {
    return {
      status:409,code:'warehouse_stock_stale',
      message:'Остатки этого товара изменились после открытия формы. Ничего не подтверждайте повторно: обновите остатки и проверьте выбранные варианты. '+raw.slice(0,260),
    }
  }
  if (/идёт ревизия|идет ревизия|завершите или отмените ревизию/.test(lower)) {
    return {status:409,code:'warehouse_stocktake_active',message:raw.slice(0,360)}
  }
  if (/нет на выбранной точке|нет складской записи|позиц[а-яё ]+ не найден|выбранной позиции больше нет/.test(lower)) {
    return {status:409,code:'warehouse_variant_missing',message:raw.slice(0,300)}
  }
  if (/одна и та же позиция|повторяется в корректировке|укажите|выберите|некорректн|не более|не больше|не принимает|не относится к текущему/.test(lower) && base.status !== 500) {
    return {status:base.status,code:'warehouse_invalid_input',message:base.message}
  }
  if (base.status!==500 && base.status!==503) {
    return {status:base.status,code:base.code||'warehouse_operation_rejected',message:base.message}
  }
  if (base.status===503) {
    return {status:503,code:base.code||'warehouse_database_busy',message:base.message}
  }
  const ref = reference ? ' Код обращения: '+reference+'.' : ''
  return {
    status:500,
    code:'warehouse_write_failed',
    reference:reference||undefined,
    message:'Не получилось подтвердить '+(
      kind==='arrival'?'приход':kind==='writeoff'?'списание':kind==='manual_set'?'корректировку':'перемещение'
    )+'.'+ref+' Проверьте историю движений перед повторной попыткой, чтобы не учесть товар дважды. Если операции нет, сообщите администратору код обращения.',
  }
}
