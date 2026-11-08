import { cleanText, normalizeSourceType, toInt } from '../core/text.ts'

export type DispatchStockConfirmation = {
  source: 'warehouse' | 'boutique'
  variantId: number
  expectedQuantity: number
  operationQuantity: number
}

export type DispatchStockConfirmationItem = DispatchStockConfirmation & {
  productName: string
  trackedPhysicalQuantity: number
  operationQuantity: number
  reservationShortage: boolean
}

export class DispatchStockConfirmationRequired extends Error {
  readonly code = 'dispatch_stock_confirmation_required'
  readonly items: DispatchStockConfirmationItem[]
  constructor(items: DispatchStockConfirmationItem[]) {
    super('По учёту остатка или резерва недостаточно. Если конкретные вещи находятся у вас, подтвердите их отправку. Общий остаток не будет изменён наугад.')
    this.name = 'DispatchStockConfirmationRequired'
    this.items = items
  }
}

export function normalizeDispatchStockConfirmations(input: unknown): DispatchStockConfirmation[] {
  if (input == null) return []
  if (!Array.isArray(input) || input.length>40) throw new Error('Некорректное подтверждение наличия перед отправкой.')
  const seen=new Set<string>()
  return input.map(raw=>{
    if (!raw || typeof raw!=='object') throw new Error('Некорректное подтверждение наличия.')
    const r=raw as Record<string,unknown>
    const source=normalizeSourceType(r.source)
    const variantId=Number(r.variantId)
    const expectedQuantity=Number(r.expectedQuantity)
    const operationQuantity=Number(r.operationQuantity)
    if(!['warehouse','boutique'].includes(cleanText(r.source))
      || !Number.isSafeInteger(variantId)||variantId<=0
      || !Number.isSafeInteger(expectedQuantity)||expectedQuantity<0
      || !Number.isSafeInteger(operationQuantity)||operationQuantity<=0){
      throw new Error('Остаток или количество подтверждения указаны неверно. Обновите заказ.')
    }
    const key=`${source}:${variantId}`
    if(seen.has(key))throw new Error('Один товар подтверждён несколько раз.')
    seen.add(key)
    return {source,variantId,expectedQuantity,operationQuantity}
  })
}

export function boundedDispatchStock(before:number,physicalQuantity:number,reservedBefore:number,activeReservedQuantity:number){
  const safeBefore=Math.max(0,toInt(before,0))
  const quantity=Math.max(0,toInt(physicalQuantity,0))
  const safeReserved=Math.max(0,toInt(reservedBefore,0))
  const activeReserved=Math.max(0,toInt(activeReservedQuantity,0))
  return {
    after:Math.max(0,safeBefore-quantity),
    deducted:Math.min(safeBefore,quantity),
    unaccounted:Math.max(0,quantity-safeBefore),
    reservedAfter:Math.max(0,safeReserved-activeReserved),
    reservationMismatch:activeReserved>safeReserved,
  }
}
