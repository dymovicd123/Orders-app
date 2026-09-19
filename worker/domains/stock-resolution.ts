import { cleanText, toInt } from '../core/text.ts'
import type { SourceType } from '../core/types.ts'

export type StockResolutionOperationType = 'shipping' | 'handover' | 'transfer' | 'writeoff'

export type BoundedOutboundStock = {
  trackedPhysicalBefore: number
  operationQuantity: number
  trackedPhysicalAfter: number
  explainedQuantity: number
  unexplainedQuantity: number
  requiresResolution: boolean
}

export type StockResolutionItemInput = {
  source: SourceType
  variantId: number
  productName?: string | null
  trackedPhysicalQuantity: number
  operationQuantity: number
}

export type StockResolutionRequiredItem = {
  source: SourceType
  variantId: number
  productName: string
  trackedPhysicalQuantity: number
  operationQuantity: number
  unexplainedQuantity: number
}

export type StockResolutionRequired = {
  ok: false
  code: 'stock_resolution_required'
  operationType: StockResolutionOperationType
  message: string
  items: StockResolutionRequiredItem[]
}

export type InventoryOperationEvidenceInput = {
  evidenceKey: string
  source: SourceType
  variantId: number
  operationType: StockResolutionOperationType
  operationReference: string
  trackedPhysicalBefore: number
  operationQuantity: number
  actor?: string | null
  occurredAt?: string | null
}

export type InventoryOperationEvidenceRow = {
  id: number
  evidence_key: string
  inventory_source: SourceType
  variant_id: number
  operation_type: StockResolutionOperationType
  operation_reference: string
  tracked_physical_before: number
  confirmed_operation_quantity: number
  explained_quantity: number
  unexplained_quantity: number
  confirmed_by: string | null
  occurred_at: string
  created_at: string
}

function stockResolutionOperationType(value: unknown): StockResolutionOperationType {
  const operationType = cleanText(value) as StockResolutionOperationType
  if (!['shipping', 'handover', 'transfer', 'writeoff'].includes(operationType)) {
    throw new Error('Неизвестный тип складской операции для уточнения физического наличия.')
  }
  return operationType
}

function stockResolutionSource(value: unknown): SourceType {
  const source = cleanText(value)
  if (source !== 'warehouse' && source !== 'boutique') {
    throw new Error('Неизвестная точка остатка для уточнения физического наличия.')
  }
  return source
}

export function boundedOutboundStock(trackedPhysicalInput: unknown, operationQuantityInput: unknown): BoundedOutboundStock {
  const trackedPhysicalBefore = Math.max(0, toInt(trackedPhysicalInput, 0))
  const operationQuantity = Math.max(0, toInt(operationQuantityInput, 0))
  if (operationQuantity <= 0) throw new Error('Количество складской операции должно быть больше нуля.')

  const explainedQuantity = Math.min(trackedPhysicalBefore, operationQuantity)
  const unexplainedQuantity = Math.max(0, operationQuantity - trackedPhysicalBefore)
  return {
    trackedPhysicalBefore,
    operationQuantity,
    trackedPhysicalAfter: Math.max(0, trackedPhysicalBefore - operationQuantity),
    explainedQuantity,
    unexplainedQuantity,
    requiresResolution: unexplainedQuantity > 0,
  }
}

export function buildStockResolutionRequired(
  operationTypeInput: StockResolutionOperationType,
  inputItems: StockResolutionItemInput[],
): StockResolutionRequired {
  const operationType = stockResolutionOperationType(operationTypeInput)
  const items = inputItems.map((input) => {
    const source = stockResolutionSource(input.source)
    const variantId = Math.max(0, toInt(input.variantId, 0))
    if (!variantId) throw new Error('Для уточнения физического наличия нужна точная комбинация товара.')
    const bounded = boundedOutboundStock(input.trackedPhysicalQuantity, input.operationQuantity)
    return {
      source,
      variantId,
      productName: cleanText(input.productName) || `variant #${variantId}`,
      trackedPhysicalQuantity: bounded.trackedPhysicalBefore,
      operationQuantity: bounded.operationQuantity,
      unexplainedQuantity: bounded.unexplainedQuantity,
      requiresResolution: bounded.requiresResolution,
    }
  }).filter((item) => item.requiresResolution)
    .map(({ requiresResolution: _requiresResolution, ...item }) => item)

  if (!items.length) {
    throw new Error('Уточнение физического наличия запрошено без фактического дефицита.')
  }

  return {
    ok: false,
    code: 'stock_resolution_required',
    operationType,
    message: items.length === 1
      ? 'Для продолжения операции подтвердите, что нужное количество товара физически находится у вас.'
      : 'Для продолжения операции подтвердите физическое наличие указанных товаров.',
    items,
  }
}

function normalizeEvidenceKey(value: unknown) {
  const evidenceKey = cleanText(value)
  if (!evidenceKey || evidenceKey.length > 180 || !/^[A-Za-z0-9._:-]+$/.test(evidenceKey)) {
    throw new Error('Некорректный ключ доказательства складской операции.')
  }
  return evidenceKey
}

export async function recordUnexplainedOutboundEvidence(
  db: D1Database,
  input: InventoryOperationEvidenceInput,
) {
  const evidenceKey = normalizeEvidenceKey(input.evidenceKey)
  const source = stockResolutionSource(input.source)
  const variantId = Math.max(0, toInt(input.variantId, 0))
  if (!variantId) throw new Error('Для доказательства складской операции нужна точная комбинация товара.')
  const operationType = stockResolutionOperationType(input.operationType)
  const operationReference = cleanText(input.operationReference)
  if (!operationReference || operationReference.length > 180) {
    throw new Error('Не указан идентификатор складской операции.')
  }

  const bounded = boundedOutboundStock(input.trackedPhysicalBefore, input.operationQuantity)
  if (!bounded.requiresResolution) {
    return { created: false, evidence: null as InventoryOperationEvidenceRow | null }
  }

  const occurredAt = cleanText(input.occurredAt) || new Date().toISOString()
  const actor = cleanText(input.actor) || null
  const insert = await db.prepare(
    `INSERT OR IGNORE INTO inventory_operation_evidence (
       evidence_key, inventory_source, variant_id, operation_type, operation_reference,
       tracked_physical_before, confirmed_operation_quantity, explained_quantity, unexplained_quantity,
       confirmed_by, occurred_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    evidenceKey,
    source,
    variantId,
    operationType,
    operationReference,
    bounded.trackedPhysicalBefore,
    bounded.operationQuantity,
    bounded.explainedQuantity,
    bounded.unexplainedQuantity,
    actor,
    occurredAt,
    occurredAt,
  ).run()

  const evidence = await db.prepare(
    `SELECT id, evidence_key, inventory_source, variant_id, operation_type, operation_reference,
            tracked_physical_before, confirmed_operation_quantity, explained_quantity, unexplained_quantity,
            confirmed_by, occurred_at, created_at
     FROM inventory_operation_evidence
     WHERE evidence_key = ?
     LIMIT 1`
  ).bind(evidenceKey).first<InventoryOperationEvidenceRow>()

  if (!evidence) throw new Error('Не удалось сохранить доказательство складской операции.')
  const mismatch = evidence.inventory_source !== source
    || toInt(evidence.variant_id, 0) !== variantId
    || evidence.operation_type !== operationType
    || cleanText(evidence.operation_reference) !== operationReference
    || toInt(evidence.tracked_physical_before, 0) !== bounded.trackedPhysicalBefore
    || toInt(evidence.confirmed_operation_quantity, 0) !== bounded.operationQuantity
    || toInt(evidence.explained_quantity, 0) !== bounded.explainedQuantity
    || toInt(evidence.unexplained_quantity, 0) !== bounded.unexplainedQuantity

  if (mismatch) {
    throw new Error('Этот ключ доказательства уже использован для другого складского факта. Обновите данные и повторите операцию.')
  }

  return {
    created: toInt(insert.meta?.changes, 0) > 0,
    evidence,
  }
}
