/**
 * Client-side guard only. The Worker remains authoritative when a plan is stale.
 * Stock lines can be partially dispatched; Workshop lines must be complete.
 */
export function clampDispatchQuantity(input: unknown, ready: unknown, workshop = false): number {
  const max = Number(ready)
  const value = Number(input)
  if (!Number.isSafeInteger(max) || max <= 0 || !Number.isSafeInteger(value) || value <= 0) return 0
  return workshop ? max : Math.min(value, max)
}

type DispatchLine = { orderItemId: number; readyQuantity: number; selectable: boolean; sourceType: string; dispatchPriorIssued?: boolean; needsStockConfirmation?: boolean }

export function dispatchSelectionError(lines: DispatchLine[], selection: Record<number, number>): string {
  for (const line of lines) {
    const selected = Number(selection[line.orderItemId] ?? 0)
    if (selected === 0) continue
    const ready = Number(line.readyQuantity)
    if (!line.selectable || !Number.isSafeInteger(selected) || selected < 0 ||
        !Number.isSafeInteger(ready) || ready < 1 || selected > ready ||
        ((line.sourceType === 'workshop' || line.dispatchPriorIssued) && selected !== ready)) {
      return 'Количество изменилось или превышает доступное. Обновите отправку.'
    }
  }
  return ''
}

type DispatchAccessibleLine = {
  orderItemId: number
  productName: string
  color?: string | null
  size?: string | null
  material?: string | null
  length?: string | null
  sourceType: string
}

/** A unique, human-readable label even when one model has several order lines. */
export function dispatchLineAccessibleName(line: DispatchAccessibleLine): string {
  const source = line.sourceType === 'workshop' ? 'Цех'
    : line.sourceType === 'boutique' ? 'Бутик' : 'Склад'
  const details = [line.productName, line.color, line.size, line.material, line.length]
    .map(part => String(part || '').trim())
    .filter(part => part && part.toUpperCase() !== 'СТАНДАРТ')
  return [...details, source, `позиция №${line.orderItemId}`].join(' · ')
}
