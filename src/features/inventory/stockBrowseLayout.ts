// One catalog execution/color/size layout used solely to display balances.
// The stock truth remains in InventorySection and all operations remain unchanged.
export type StockBrowseRow = {
  variantId: number
  size?: string
  color?: string
  material?: string
  length?: string
  gender?: string
  category?: string
  productName?: string
}
export type StockBrowseColorGroup<Row extends StockBrowseRow> = {
  key: string
  color: string
  rows: Row[]
}
export type StockBrowseExecution<Row extends StockBrowseRow> = {
  key: string
  title: string
  colors: StockBrowseColorGroup<Row>[]
}
const text = (value: unknown) => String(value ?? '').trim()
const normal = (value: unknown) => text(value).toLocaleUpperCase('ru-RU')
export const stockRowHasBalance = (physical: number, reserved: number, free: number) =>
  physical !== 0 || reserved !== 0 || free !== 0

export function buildStockBrowseLayout<Row extends StockBrowseRow>(rows: Row[]): StockBrowseExecution<Row>[] {
  const groups = new Map<string, { key: string; title: string; colors: Map<string, StockBrowseColorGroup<Row>> }>()
  for (const row of rows) {
    // Keep material, length, gender, and child/adult category distinct:
    // sizes from unlike variants must never be conflated.
    const material = text(row.material)
    const length = text(row.length)
    const gender = text(row.gender)
    const kind = row.category === 'child' ? 'Детский' : 'Взрослый'
    const identity = [
      normal(material || 'СТАНДАРТ'), normal(length || 'СТАНДАРТ'), normal(gender), kind,
    ].join('¦')
    let execution = groups.get(identity)
    if (!execution) {
      const parts = [
        material && normal(material) !== 'СТАНДАРТ' ? material : '',
        length && normal(length) !== 'СТАНДАРТ' ? length : '',
        gender, row.category === 'child' ? 'Детский' : '',
      ].filter(Boolean)
      execution = { key: identity, title: parts.join(' · ') || 'Основное исполнение', colors: new Map() }
      groups.set(identity, execution)
    }
    const colorName = text(row.color) || 'Без цвета'
    const colorKey = normal(colorName)
    let color = execution.colors.get(colorKey)
    if (!color) {
      color = { key: colorKey, color: colorName, rows: [] }
      execution.colors.set(colorKey, color)
    }
    color.rows.push(row)
  }
  return [...groups.values()]
    .map(group => ({
      key: group.key,
      title: group.title,
      colors: [...group.colors.values()]
        .map(color => ({ ...color, rows: [...color.rows].sort((a, b) =>
          text(a.size).localeCompare(text(b.size), 'ru', { numeric: true })) }))
        .sort((a, b) => a.color.localeCompare(b.color, 'ru')),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}
