import type { CatalogResponse, OrderItem } from './types'
import { canonicalCatalogProductKey, canonicalStockPositionValue, normalizeSuggestion } from './utils'

export type CatalogOrderPriceResolution =
  | {
      status: 'matched'
      productId: number
      stockPositionId: number
      category: 'adult' | 'child'
      salePrice: number
      catalogPriceSnapshot: number
    }
  | {
      status: 'product_missing' | 'price_missing' | 'ambiguous'
      productId: number | null
      stockPositionId: number | null
      category: 'adult' | 'child'
      salePrice: null
      catalogPriceSnapshot: null
    }

function orderAudiencePriceCategory(item: Pick<OrderItem, 'audienceType'>): 'adult' | 'child' {
  return normalizeSuggestion(item.audienceType).includes('ДЕТ') ? 'child' : 'adult'
}

function resolveCatalogProductId(catalog: CatalogResponse, productName: unknown) {
  const key = canonicalCatalogProductKey(productName)
  if (!key) return null

  const direct = (catalog.products || []).find(product => product.isActive && canonicalCatalogProductKey(product.name) === key)
  if (direct?.id) return direct.id

  const alias = (catalog.productAliases || []).find(row => canonicalCatalogProductKey(row.rawValue) === key)
  if (!alias?.productId) return null
  return (catalog.products || []).some(product => product.id === alias.productId && product.isActive)
    ? alias.productId
    : null
}

export function resolveCatalogOrderSalePrice(
  catalog: CatalogResponse | null | undefined,
  item: Pick<OrderItem, 'productName' | 'audienceType' | 'material' | 'length'>,
): CatalogOrderPriceResolution {
  const category = orderAudiencePriceCategory(item)
  if (!catalog) {
    return { status: 'product_missing', productId: null, stockPositionId: null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const productId = resolveCatalogProductId(catalog, item.productName)
  if (!productId) {
    return { status: 'product_missing', productId: null, stockPositionId: null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const material = canonicalStockPositionValue(item.material)
  const length = canonicalStockPositionValue(item.length)
  const matches = (catalog.executionPrices || []).filter(price =>
    price.productId === productId
    && price.category === category
    && canonicalStockPositionValue(price.material) === material
    && canonicalStockPositionValue(price.length) === length
  )

  if (!matches.length || matches.every(price => price.salePrice == null)) {
    return { status: 'price_missing', productId, stockPositionId: matches[0]?.stockPositionId || null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const pricedMatches = matches.filter(price => price.salePrice != null)
  const distinct = new Set(pricedMatches.map(price => Number(price.salePrice)))
  if (distinct.size !== 1 || pricedMatches.some(price => !Number.isSafeInteger(Number(price.salePrice)) || Number(price.salePrice) < 0)) {
    return { status: 'ambiguous', productId, stockPositionId: null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const winner = pricedMatches[0]
  const salePrice = Number(winner.salePrice)
  return {
    status: 'matched',
    productId,
    stockPositionId: winner.stockPositionId,
    category,
    salePrice,
    catalogPriceSnapshot: salePrice,
  }
}
