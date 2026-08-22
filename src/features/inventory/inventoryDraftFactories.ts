import type { InventoryArrivalPosition, InventoryOperationVariantDraft } from '../../app/types'

export function inventoryUiId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyArrivalPosition(seed: Partial<InventoryArrivalPosition> = {}): InventoryArrivalPosition {
  return {
    id: seed.id || inventoryUiId('arrival'),
    productId: seed.productId || '',
    productName: seed.productName || '',
    category: seed.category === 'child' ? 'child' : 'adult',
    gender: seed.gender || '',
    material: seed.material || 'СТАНДАРТ',
    length: seed.length || 'СТАНДАРТ',
    sizes: seed.sizes?.length ? seed.sizes : [{ id: inventoryUiId('size'), size: '', color: '', quantity: 1 }],
  }
}

export function createEmptyInventoryOperationVariantDraft(): InventoryOperationVariantDraft {
  return {
    category: 'adult',
    gender: '',
    color: '',
    material: 'СТАНДАРТ',
    length: 'СТАНДАРТ',
    size: '',
  }
}
