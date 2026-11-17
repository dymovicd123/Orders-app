export type BarcodePrintMode = 'a4' | 'thermal'
export const A4_LABELS_PER_PAGE = 21
export const MAX_BARCODE_PRINT_LABELS = 1000

export function paginateBarcodeLabels<T>(labels: T[], mode: BarcodePrintMode): T[][] {
  if (!labels.length) return []
  const perPage = mode === 'a4' ? A4_LABELS_PER_PAGE : 1
  const pages: T[][] = []
  for (let offset = 0; offset < labels.length; offset += perPage) {
    pages.push(labels.slice(offset, offset + perPage))
  }
  return pages
}
