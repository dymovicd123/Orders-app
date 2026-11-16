const PREFIX = 'OCS1'
const BARCODE_RE = /^OCS1-([0-9A-Z]{6,12})-([0-9A-Z]{2})$/

function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0
}

function checkCharacters(base: string): string {
  let checksum = 17
  for (const char of base) checksum = (checksum * 31 + char.charCodeAt(0)) % 1296
  return checksum.toString(36).toUpperCase().padStart(2, '0')
}

export function skuBarcodeForVariantId(variantId: number): string {
  if (!validId(variantId)) throw new Error('Некорректный идентификатор SKU.')
  const base = variantId.toString(36).toUpperCase().padStart(6, '0')
  if (base.length > 12) throw new Error('Идентификатор SKU слишком длинный.')
  return PREFIX + '-' + base + '-' + checkCharacters(base)
}

export function variantIdFromSkuBarcode(value: string): number | null {
  const match = BARCODE_RE.exec(value.trim().toUpperCase())
  if (!match) return null
  const id = Number.parseInt(match[1], 36)
  if (!validId(id)) return null
  return skuBarcodeForVariantId(id) === match[0] ? id : null
}
