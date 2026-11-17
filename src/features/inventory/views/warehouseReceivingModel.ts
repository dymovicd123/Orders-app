import type { ExchangeHistoryEntry, ExchangeHistoryItem, ReturnHistoryEntry, ReturnHistoryItem } from '../../../app/types'
import { skuBarcodeForVariantId } from '../../../../shared/barcode-sku.ts'
import { isUnitBarcode } from '../../../../shared/barcode-unit.ts'

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
  onBarcodePreparationReady?: (details: { variantId: number; source: 'warehouse' | 'boutique'; quantity: number }) => void
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
  currentVariantId: number | null
  lifecycleVariantId: number | null
  identity: { gender?: string | null; color?: string | null; material?: string | null; length?: string | null; size?: string | null }
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
          currentVariantId: Number(item.currentVariantId) || null,
          lifecycleVariantId: Number(item.lifecycleVariantId) || null,
          identity: { gender:item.gender, color:item.color, material:item.material, length:item.length, size:item.size },
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
        currentVariantId: entry.oldCurrentVariantId,
        lifecycleVariantId: entry.oldLifecycleVariantId,
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
        currentVariantId: Number(oldItem.currentVariantId) || null,
        lifecycleVariantId: Number(oldItem.lifecycleVariantId) || null,
        identity: { gender:oldItem.gender, color:oldItem.color, material:oldItem.material, length:oldItem.length, size:oldItem.size },
      }
    })
  })
}


export type ReceivingBarcodeLookup = {
  ok?: boolean
  message?: string
  barcodeType?: string
  barcode?: string
  variantId?: number
  productName?: string
  gender?: string
  color?: string
  material?: string
  length?: string
  size?: string
  active?: boolean
  physicalUnit?: boolean
  receivingIdentifiable?: boolean
  unitId?: string
  status?: string
}

export type ReceivingBarcodeIdentity = {
  variantId: number
  kind: 'sku' | 'unit'
  productName: string
  gender: string
  color: string
  material: string
  length: string
  size: string
}

export function identifyReceivingBarcode(codeInput: string, result: ReceivingBarcodeLookup): ReceivingBarcodeIdentity {
  const code=codeInput.trim().toUpperCase()
  const variantId=Number(result.variantId)
  if (!result.ok || !Number.isSafeInteger(variantId) || variantId<=0) {
    throw new Error(result.message || 'Штрихкод не найден или не определён вариант товара.')
  }
  if (result.barcodeType==='sku') {
    if (!result.active || result.physicalUnit!==false ||
      result.barcode!==skuBarcodeForVariantId(variantId) || code!==result.barcode) {
      throw new Error('Общий SKU не прошёл проверку или вариант уже неактивен.')
    }
  } else if (result.barcodeType==='unit') {
    if (!isUnitBarcode(code) || code!==result.barcode || !result.unitId || !result.receivingIdentifiable) {
      throw new Error('Индивидуальная метка недействительна или больше не идентифицирует активный товар.')
    }
    if (!['issued','not_stock'].includes(result.status || '')) {
      throw new Error('Эта индивидуальная метка не числится выбывшей к клиенту. Проверьте статус вещи и выберите приёмку вручную.')
    }
  } else {
    throw new Error('Этот тип штрихкода не поддерживается при приёмке.')
  }
  return {
    variantId, kind:result.barcodeType, productName:result.productName || '',
    gender:result.gender || '', color:result.color || '', material:result.material || '',
    length:result.length || '', size:result.size || '',
  }
}

function comparable(value: unknown, execution = false) {
  const normalized=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleUpperCase('ru')
  return execution && normalized==='СТАНДАРТ' ? '' : normalized
}

export function matchingReceivingItems(items: PendingPhysicalItem[], barcode: ReceivingBarcodeIdentity) {
  return items.filter(item => {
    if (item.defaultDestination==='no_stock' || !Number.isSafeInteger(barcode.variantId)) return false
    const variants=[item.currentVariantId,item.lifecycleVariantId]
      .map(value=>Number(value)).filter(value=>Number.isSafeInteger(value)&&value>0)
    if (!variants.length || variants.some(value=>value!==barcode.variantId)) return false
    if (!comparable(item.productName) || comparable(item.productName)!==comparable(barcode.productName)) return false
    for (const key of ['gender','color','material','length','size'] as const) {
      const expected=comparable(item.identity[key],key==='material'||key==='length')
      const actual=comparable(barcode[key],key==='material'||key==='length')
      if (expected && expected!==actual) return false
    }
    return true
  })
}
