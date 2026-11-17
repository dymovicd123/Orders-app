import { cleanText, toInt } from '../core/text.ts'

type ArrivalPrintReceipt = {
  operationId: string
  source: 'warehouse' | 'boutique'
  items: Array<{ variantId: number; productName: string; variantLabel: string; quantity: number }>
}

export async function readSavedArrivalLabels(db: D1Database, rawOperationId: string): Promise<{
  ok: boolean; receipt?: ArrivalPrintReceipt; message?: string
}> {
  const operationId = cleanText(rawOperationId)
  if (!operationId || operationId.length > 160) {
    return { ok: false, message: 'Неверный идентификатор прихода.' }
  }
  const saved = await db.prepare(
    `SELECT operation_id, operation_type, source_type, status, item_count
     FROM inventory_operations WHERE operation_id = ? LIMIT 1`
  ).bind(operationId).first<Record<string, unknown>>()
  if (!saved || cleanText(saved.operation_type) !== 'arrival'
    || cleanText(saved.status) !== 'completed') {
    return { ok: false, message: 'Подтверждённый приход с таким номером не найден.' }
  }
  const source = cleanText(saved.source_type)
  if (source !== 'warehouse' && source !== 'boutique') {
    return { ok: false, message: 'Не удалось определить точку прихода.' }
  }
  const expected = toInt(saved.item_count, 0)
  if (expected < 1 || expected > 200) {
    return { ok: false, message: 'Для этого прихода нельзя безопасно подготовить список этикеток.' }
  }
  const result = await db.prepare(
    `SELECT m.variant_id, m.product_name_snapshot, m.color_snapshot, m.size_snapshot,
            m.quantity_delta, m.inventory_source, r.reversed_at
       FROM inventory_movements m
       LEFT JOIN inventory_movement_reversals r ON r.original_movement_id = m.id
      WHERE m.reference_id = ? AND m.reference_type = 'manual' AND m.movement_type = 'arrival'
      ORDER BY m.id ASC LIMIT 201`
  ).bind(operationId).all<Record<string, unknown>>()
  const rows = result.results || []
  if (rows.length !== expected || rows.some(row =>
    cleanText(row.inventory_source) !== source
    || toInt(row.variant_id, 0) <= 0
    || toInt(row.quantity_delta, 0) <= 0
    || Boolean(cleanText(row.reversed_at))
  )) {
    return { ok: false, message: 'История прихода неполная или операция отменена. Печать по ней недоступна.' }
  }
  const items = rows.map(row => ({
    variantId: toInt(row.variant_id, 0),
    productName: cleanText(row.product_name_snapshot) || 'Товар',
    variantLabel: [cleanText(row.color_snapshot), cleanText(row.size_snapshot)].filter(Boolean).join(' · ')
      || 'Стандартный вариант',
    quantity: toInt(row.quantity_delta, 0),
  }))
  return { ok: true, receipt: { operationId, source, items } }
}
