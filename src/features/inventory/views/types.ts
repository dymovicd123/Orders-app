import type { ComponentType, InputHTMLAttributes, ReactNode } from 'react'
import type { WarehouseAttentionSummaryResponse } from '../../../../shared/api-contracts.ts'

/**
 * Transitional typed presentation boundary for Step 190.6B.
 *
 * InventorySection still owns the wide controller state. Render modules are deliberately
 * lifecycle-free and receive the already-computed view model. Step 190.6E narrows each renderer
 * to an explicit Pick<> boundary and removes @ts-nocheck from the controller; this transitional
 * presentation context stays local and must not be reused as a network/API contract.
 */
type LooseSetter = {
  (updater: (current: any) => any): void
  (value: any): void
}

type LooseArraySetter = {
  (updater: (current: any[]) => any[]): void
  (value: any[]): void
}

type SmartPickerProps = {
  value: string
  options: string[]
  onChange: (value: string) => void
  onPick?: (value: string) => void
  [key: string]: any
}

type ChoicePillsProps = {
  value?: any
  options?: any[]
  onChange?: (value: string) => void
  [key: string]: any
}

export interface InventoryRenderContext {
  [key: string]: any

  SmartPickerInput: ComponentType<SmartPickerProps>
  FriendlyNumberInput: ComponentType<InputHTMLAttributes<HTMLInputElement> & Record<string, any>>
  ChoicePills: ComponentType<ChoicePillsProps>
  arrivalWorkspace: ReactNode
  warehouseAttention: WarehouseAttentionSummaryResponse | null

  catalogActiveProducts: any[]
  catalogData: { products?: any[]; variants?: any[] } | null
  catalogReviewGroups: any[]
  catalogReviewBlockingFields: any[]
  inventoryLifecycleBlockingFields: any[]
  visibleCatalogProducts: any[]
  filteredStocktakeProductGroups: any[]
  filteredStocktakeSelectableProducts: any[]
  inventoryMatrixColors: any[]
  inventoryMatrixSizes: any[]
  inventoryOperationAllProductGroups: any[]
  inventoryOperationProductGroups: any[]
  operationVisibleRows: any[]
  simpleStockGroups: any[]
  stocktakeFoundSizes: any[]
  stocktakeSelectedProductIds: any[]
  stocktakeSelectableProducts: any[]
  stocktakeInlineAdd: { mode: 'size' | 'color'; positionKey: string; color: string; sizes: string[] } | null
  stocktakeReviewRows: any[]

  setCatalogAdminMode: LooseSetter
  setCatalogCategoryFilter: LooseSetter
  setCatalogOnlyWithoutVariants: LooseSetter
  setCatalogProductDraft: LooseSetter
  setCatalogReviewCreateFields: LooseSetter
  setCatalogReviewCreateProduct: LooseSetter
  setCatalogReviewFacts: LooseSetter
  setCatalogReviewNewProductName: LooseSetter
  setCatalogReviewTaskIndex: LooseSetter
  setCatalogVariantDraft: LooseSetter
  setExpandedCatalogProducts: LooseSetter
  setInventoryLifecycleCreateFields: LooseSetter
  setInventoryLifecycleCreateProduct: LooseSetter
  setInventoryLifecycleFacts: LooseSetter
  setInventoryLifecycleNewProductName: LooseSetter
  setInventoryLifecycleTaskIndex: LooseSetter
  setInventoryQuery: LooseSetter
  setInventoryDraft: LooseSetter
  setInventoryMatrix: LooseSetter
  setInventoryMatrixCell: (...args: any[]) => any
  setInventoryMatrixColorToAdd: LooseSetter
  setInventoryMatrixSizeToAdd: LooseSetter
  setInventoryCorrectionValue: (...args: any[]) => any
  setInventoryExistingVariantSearch: LooseSetter
  setInventoryTransferObservedQuantity: (...args: any[]) => any
  setInventoryVariantOperationQuantity: (...args: any[]) => any
  setMovementSourceRefreshToken: LooseSetter
  setQuickStocktakeNotice: LooseSetter
  setQuickStocktakeOpen: LooseSetter
  setQuickStocktakeValues: LooseSetter
  setSimpleStockAvailabilityFilter: LooseSetter
  setSimpleStockCategory: LooseSetter
  setSimpleStockDetail: LooseSetter
  setSimpleStockOpenProductKey: LooseSetter
  setSimpleStockSource: LooseSetter
  setInventoryCategoryFilter: LooseSetter
  setInventoryQuickFilters: LooseSetter
  setInventorySortMode: LooseSetter
  setInventoryStatusFilter: LooseSetter
  setCycleCountData: LooseSetter
  setCycleCountNotice: LooseSetter
  setCycleCountOpen: LooseSetter
  setCycleCountValues: LooseSetter
  setStocktakeFact: (...args: any[]) => any
  setStocktakeFoundCustom: LooseSetter
  setStocktakeFoundDraft: LooseSetter
  setStocktakeFoundNewFields: LooseSetter
  setStocktakeFoundOpen: LooseSetter
  setStocktakeFoundOtherProduct: LooseSetter
  setStocktakeFoundProductId: LooseSetter
  setStocktakeFoundSizes: LooseArraySetter
  setStocktakeInlineAdd: LooseSetter
  setStocktakeNotice: LooseSetter
  setStocktakeProductIndex: LooseSetter
  setStocktakeProductSearch: LooseSetter
  setStocktakeReviewMode: LooseSetter
  setStocktakeSelectedProductIds: LooseArraySetter
  setStocktakeSource: LooseSetter
  setStocktakeStartMode: LooseSetter
  setStocktakeStartSearch: LooseSetter
}
