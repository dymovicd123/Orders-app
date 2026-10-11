import type { InventoryResponse } from '../../app/types'

// Cursor paging prevents catalog and stock screens from silently losing all
// entries after the first 1,000 inventory rows. Never publish a partial page.
export async function loadCompleteInventorySnapshot(
  fetchPage: (cursor: number, includeMovements: boolean) => Promise<InventoryResponse | null>,
  includeMovements: boolean,
): Promise<InventoryResponse | null> {
  let cursor = 0
  let firstPage: InventoryResponse | null = null
  const rows: InventoryResponse['items'] = []
  const seen = new Set<number>()

  for (let page = 0; page < 1000; page += 1) {
    const response = await fetchPage(cursor, includeMovements && page === 0)
    if (!response) return null
    if (!response.ok || !response.pageInfo || response.pageInfo.cursor !== cursor) {
      throw new Error('Склад вернул неполную или несовместимую страницу остатков.')
    }
    if (firstPage && response.source !== firstPage.source) {
      throw new Error('При постраничной загрузке склада изменился источник остатков.')
    }
    if (!firstPage) firstPage = response

    const pageItems = response.items
    if (!Array.isArray(pageItems)) throw new Error('Склад вернул некорректные позиции.')
    for (const item of pageItems) {
      const id = Number(item.id)
      if (!Number.isSafeInteger(id) || id <= cursor || seen.has(id)) {
        throw new Error('Страницы склада пересеклись или пришли не по порядку. Обновите остатки.')
      }
      seen.add(id)
      rows.push(item)
    }
    if (!response.pageInfo.hasMore) {
      const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0)
      const reservedTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.reservedQuantity) || 0), 0)
      const availableTotal = rows.reduce((sum, row) => sum + (Number(row.availableQuantity) || 0), 0)
      const zeroCount = rows.filter(row => Number(row.availableQuantity) === 0).length
      return {
        ...firstPage,
        items: rows,
        count: rows.length,
        total,
        reservedTotal,
        availableTotal,
        zeroCount,
        pageInfo: { cursor: 0, hasMore: false, nextCursor: null },
      }
    }

    const nextCursor = response.pageInfo.nextCursor
    if (!pageItems.length || !Number.isSafeInteger(nextCursor) || Number(nextCursor) <= cursor || Number(nextCursor) !== Number(pageItems[pageItems.length - 1]?.id)) {
      throw new Error('Склад не смог продолжить постраничную загрузку остатков.')
    }
    cursor = Number(nextCursor)
  }

  throw new Error('Превышен предел страниц склада. Полные остатки не загружены.')
}
