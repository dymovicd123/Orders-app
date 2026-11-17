import type { ExchangeHistoryEntry, ExchangeHistoryItem, ReturnHistoryEntry, ReturnHistoryItem } from '../../../app/types'

export type ReceivingKind = 'return' | 'exchange'
export type ReceivingDestination = 'warehouse' | 'boutique' | 'no_stock'
export type ReceivingInbox<T> = {
  rows: T[]
  pendingQuantity: number
  hasMore: boolean
  busy: boolean
  error: string
}
export type ReceivePhysicalItem = (input: {
  operationType: ReceivingKind
  operationId: number
  operationItemId: number
  destination: ReceivingDestination
  productName: string
  externalId: string
}) => Promise<boolean>

export type PendingPhysicalItem = {
  key: string
  kind: ReceivingKind
  operationId: number
  operationItemId: number
  productName: string
  quantity: number
  externalId: string
  customer: string
  manager: string
  date: string
  city: string
  characteristics: string
  defaultDestination: ReceivingDestination
}

const characteristics = (values: {
  gender?: string | null
  color?: string | null
  material?: string | null
  length?: string | null
  size?: string | null
}) => [
  ['Пол', values.gender], ['Цвет', values.color], ['Материал', values.material],
  ['Длина', values.length], ['Размер', values.size],
].filter(([, v]) => String(v || '').trim())
  .map(([label, value]) => `${label}: ${String(value).trim()}`).join(' · ') || 'Характеристики не указаны'

function defaultDestination(sourceType?: string | null, isWorkshop?: boolean): ReceivingDestination {
  if (sourceType === 'workshop' || isWorkshop) return 'no_stock'
  if (sourceType === 'boutique') return 'boutique'
  return 'warehouse'
}

export function pendingReturnPhysicalItems(entries: ReturnHistoryEntry[]): PendingPhysicalItem[] {
  return entries.flatMap(entry => entry.operationType === 'order_return' && entry.status !== 'cancelled'
    ? (entry.items || []).filter(item => item.physicalTracking && !item.physicalReceivedAt && Number(item.id) > 0)
        .map((item: ReturnHistoryItem) => ({
          key: `return:${entry.id}:${item.id}`,
          kind: 'return' as const,
          operationId: entry.id,
          operationItemId: item.id,
          productName: item.productName,
          quantity: Number(item.quantity || 0),
          externalId: entry.externalId,
          customer: entry.customer || '',
          manager: entry.manager || '',
          date: entry.returnDate,
          city: entry.city || '',
          characteristics: characteristics(item),
          defaultDestination: defaultDestination(item.sourceType, item.isWorkshop),
        }))
    : [])
}

export function pendingExchangePhysicalItems(entries: ExchangeHistoryEntry[]): PendingPhysicalItem[] {
  return entries.flatMap(entry => {
    if (entry.status === 'cancelled') return []
    const oldItems = entry.oldItems || []
    // A set exchange can return multiple old pieces; never collapse it to one.
    const pending: Array<ExchangeHistoryItem | null> = oldItems.length
      ? oldItems.filter(item => item.physicalTracking && !item.physicalReceivedAt && Number(item.id) > 0)
      : entry.oldPhysicalTracking && !entry.oldPhysicalReceivedAt && Number(entry.oldOperationItemId) > 0
        ? [null] : []
    return pending.map(item => {
      const operationItemId = Number(item?.id || entry.oldOperationItemId)
      const oldItem = item || {
        productName: entry.oldProductName,
        quantity: entry.oldQuantity,
        gender: entry.oldGender,
        color: entry.oldColor,
        material: entry.oldMaterial,
        length: entry.oldLength,
        size: entry.oldSize,
        sourceType: entry.oldSourceType,
        isWorkshop: entry.oldIsWorkshop,
      }
      return {
        key: `exchange:${entry.id}:${operationItemId}`,
        kind: 'exchange' as const,
        operationId: entry.id,
        operationItemId,
        productName: oldItem.productName,
        quantity: Number(oldItem.quantity || 0),
        externalId: entry.externalId,
        customer: entry.customer || '',
        manager: entry.manager || '',
        date: entry.exchangeDate,
        city: '',
        characteristics: characteristics(oldItem),
        defaultDestination: defaultDestination(oldItem.sourceType, oldItem.isWorkshop),
      }
    })
  })
}

