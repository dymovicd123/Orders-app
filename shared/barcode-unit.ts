const PREFIX = 'OCU1'
const PATTERN = /^OCU1-([0-9A-Z]{13})-([0-9A-Z]{2})$/

function checksum(value: string): string {
  let sum = 41
  for (const ch of value) sum = (sum * 37 + ch.charCodeAt(0)) % 1296
  return sum.toString(36).toUpperCase().padStart(2, '0')
}

export function unitBarcodeFromEntropy(bytes: Uint8Array): string {
  if (bytes.length !== 8) throw new Error('Для идентификатора единицы необходимо 64 бита случайности.')
  let n = 0n
  for (const byte of bytes) n = (n << 8n) | BigInt(byte)
  const payload = n.toString(36).toUpperCase().padStart(13, '0')
  return PREFIX + '-' + payload + '-' + checksum(payload)
}

export function generateUnitBarcode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return unitBarcodeFromEntropy(bytes)
}

export function isUnitBarcode(value: string): boolean {
  if (typeof value !== 'string') return false
  const match = PATTERN.exec(value.trim().toUpperCase())
  return Boolean(match && checksum(match[1]) === match[2])
}
