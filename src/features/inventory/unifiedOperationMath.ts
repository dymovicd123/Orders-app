// Shared, pure view semantics for the three physical quantity operations.
// No stock write happens here; the existing Worker remains authoritative.
export type UnifiedQuantityMode = 'arrival' | 'writeoff' | 'manual_set'
export type QuantityEntry = { quantity?: number; touched?: boolean }
export function displayQuantityInput(mode: UnifiedQuantityMode, item: QuantityEntry | undefined): string {
  if (!item || (mode === 'manual_set' && !item.touched)) return ''
  if (mode !== 'manual_set' && !(item.quantity ?? 0)) return ''
  return String(item.quantity ?? '')
}
export function previewQuantity(mode: UnifiedQuantityMode, physical: number, input: number): number {
  if (mode === 'arrival') return physical + input
  if (mode === 'writeoff') return Math.max(0, physical - input)
  return input
}
export function isEntered(mode: UnifiedQuantityMode, item: QuantityEntry | undefined): boolean {
  return displayQuantityInput(mode, item) !== ''
}
