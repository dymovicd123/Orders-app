import { skuBarcodeForVariantId } from '../../../shared/barcode-sku.ts'
import { isUnitBarcode } from '../../../shared/barcode-unit.ts'

export type OperationBarcodeLookup = {
  ok?: boolean
  message?: string
  barcodeType?: string
  barcode?: string
  physicalUnit?: boolean
  variantId?: number
  productName?: string
  active?: boolean
  unitId?: string
  source?: string
  status?: string
}

export type OperationBarcodeMatch =
  | { kind: 'sku'; variantId: number; productName: string }
  | { kind: 'unit'; variantId: number; productName: string; unitId: string }

export function resolveOperationBarcode(
  codeInput: string,
  result: OperationBarcodeLookup,
  source: 'warehouse' | 'boutique',
): OperationBarcodeMatch {
  const code = codeInput.trim().toUpperCase()
  if (!result.ok || !result.active) {
    throw new Error(result.message || 'Код не найден или вариант больше не активен.')
  }
  const variantId = Number(result.variantId)
  if (!Number.isSafeInteger(variantId) || variantId <= 0) {
    throw new Error('Нельзя определить вариант товара по этому коду.')
  }
  if (result.barcodeType === 'sku') {
    if (result.physicalUnit !== false || result.barcode !== skuBarcodeForVariantId(variantId) ||
      code !== result.barcode) {
      throw new Error('Общий код варианта не прошёл проверку.')
    }
    return { kind: 'sku', variantId, productName: result.productName || 'Товар' }
  }
  if (result.barcodeType === 'unit') {
    if (!isUnitBarcode(code) || !result.unitId) {
      throw new Error('Индивидуальный код вещи недействителен.')
    }
    if (result.source !== source || !['prepared', 'on_hand'].includes(result.status || '')) {
      throw new Error('Вещь не числится в исходной точке или уже выбыла.')
    }
    return { kind: 'unit', variantId, productName: result.productName || 'Товар', unitId: result.unitId }
  }
  throw new Error('Этот тип штрихкода не поддерживается в складской операции.')
}

/**
 * A shared OCS1 barcode describes a catalog variant, not a unique tagged unit.
 * In transfer/writeoff only, each distinct operator scan adds ONE to the
 * uncommitted operation draft. Arrival and stock correction are intentionally
 * lookup-only: their quantities are always entered as totals.
 */
export function nextSharedSkuDraftQuantity(
  mode:'arrival'|'manual_set'|'writeoff'|'transfer',
  quantity:number,
):number|null{
  if(mode!=='writeoff'&&mode!=='transfer')return null
  if(!Number.isSafeInteger(quantity)||quantity<0||quantity>=999999)
    throw new Error('Для одного варианта допустимо не больше 999999 шт.')
  return quantity+1
}
