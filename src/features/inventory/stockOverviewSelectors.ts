// Read-only selectors for the Stock overview. Searching a model must NEVER
// remove its sizes or affect totals calculated from the original snapshot.
export type StockOverviewMode = 'all' | 'withStock'

export function selectStockOverviewModels<
  Row,
  Group extends { productName: string; rows: Row[] },
>(
  groups: Group[],
  query: string,
  mode: StockOverviewMode,
  hasStockOrReserve: (row: Row) => boolean,
): (Group & { allRows: Row[] })[] {
  const q = query.trim().toLocaleLowerCase('ru-RU')
  return groups
    .filter(group =>
      (!q || group.productName.toLocaleLowerCase('ru-RU').includes(q))
      && (mode === 'all' || group.rows.some(hasStockOrReserve)),
    )
    .map(group => ({ ...group, rows: group.rows, allRows: group.rows }))
}
