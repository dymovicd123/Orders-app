import type { Dispatch, SetStateAction } from 'react'
import type { InventoryDraft, InventoryDraftItem, InventoryOperationVariantDraft, InventorySourceKey, InventoryStockRecord, InventoryPanel } from '../../app/types'
import { createEmptyInventoryItem, normalizeSearchText, normalizeSuggestion } from '../../app/utils'
import { createEmptyInventoryOperationVariantDraft } from './inventoryDraftFactories'

type ProductOperationGroup = {
  key: string
  productName: string
  rows: InventoryStockRecord[]
}

type InventoryOperationEditorArgs = {
  inventoryDraft: InventoryDraft
  setInventoryDraft: Dispatch<SetStateAction<InventoryDraft>>
  inventoryOperationVariant: InventoryOperationVariantDraft
  setInventoryOperationVariant: Dispatch<SetStateAction<InventoryOperationVariantDraft>>
  inventoryOperationAllProductGroups: ProductOperationGroup[]
  selectedInventoryOperationGroup: ProductOperationGroup | null
  matchedInventoryOperationVariant: InventoryStockRecord | null
  getInventoryRowCategory: (row: InventoryStockRecord) => 'adult' | 'child'
  setInventoryOperationProductKey: Dispatch<SetStateAction<string>>
  setInventoryOperationSearch: Dispatch<SetStateAction<string>>
  setInventoryOperationActiveVariantId: Dispatch<SetStateAction<string>>
  setInventoryExistingVariantOpen: Dispatch<SetStateAction<boolean>>
  setInventoryExistingVariantSearch: Dispatch<SetStateAction<string>>
  resetInventoryOperationSelection: () => void
  setInventoryTransferRequestId: Dispatch<SetStateAction<string>>
  makeCashRequestId: (prefix: string) => string
  openInventoryPanel: (panel: InventoryPanel) => void
}

// Owns the operator's current SKU/variant picker and the editable transfer/write-off draft.
// The server remains the authority on stock, reservations and whether an operation can commit.
export function createInventoryOperationEditorActions({
  inventoryDraft,
  setInventoryDraft,
  inventoryOperationVariant,
  setInventoryOperationVariant,
  inventoryOperationAllProductGroups,
  selectedInventoryOperationGroup,
  matchedInventoryOperationVariant,
  getInventoryRowCategory,
  setInventoryOperationProductKey,
  setInventoryOperationSearch,
  setInventoryOperationActiveVariantId,
  setInventoryExistingVariantOpen,
  setInventoryExistingVariantSearch,
  resetInventoryOperationSelection,
  setInventoryTransferRequestId,
  makeCashRequestId,
  openInventoryPanel,
}: InventoryOperationEditorArgs) {
  function inventoryOperationVariantFromRow(row: InventoryStockRecord): InventoryOperationVariantDraft {
    return {
      category: getInventoryRowCategory(row),
      gender: row.gender || '',
      color: row.color || '',
      material: row.material || '',
      length: row.length || '',
      size: row.size || '',
    }
  }

  function selectInventoryOperationVariant(row: InventoryStockRecord) {
    const group = inventoryOperationAllProductGroups.find((entry) => entry.rows.some((candidate) => Number(candidate.variantId || 0) === Number(row.variantId || 0)))
    if (group) {
      setInventoryOperationProductKey(group.key)
      setInventoryOperationSearch(group.productName)
    }
    setInventoryOperationVariant(inventoryOperationVariantFromRow(row))
    setInventoryOperationActiveVariantId(String(row.variantId || ''))
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
  }

  function selectInventoryOperationProduct(key: string, preferredVariantId?: string | number) {
    const group = inventoryOperationAllProductGroups.find((entry) => entry.key === key)
    if (!group) {
      resetInventoryOperationSelection()
      return
    }
    const preferred = preferredVariantId
      ? group.rows.find((row) => String(row.variantId || '') === String(preferredVariantId))
      : null
    const row = preferred || group.rows[0] || null
    setInventoryOperationProductKey(group.key)
    setInventoryOperationSearch(group.productName)
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
    if (row) {
      setInventoryOperationVariant(inventoryOperationVariantFromRow(row))
      setInventoryOperationActiveVariantId(String(row.variantId || ''))
    } else {
      setInventoryOperationVariant(createEmptyInventoryOperationVariantDraft())
      setInventoryOperationActiveVariantId('')
    }
  }

  function updateInventoryDirectProductInput(value: string) {
    setInventoryOperationSearch(value)
    const normalized = normalizeSearchText(value)
    const exact = inventoryOperationAllProductGroups.find((group) => normalizeSearchText(group.productName) === normalized)
    if (exact) {
      selectInventoryOperationProduct(exact.key)
      return
    }
    setInventoryOperationProductKey('')
    setInventoryOperationVariant(createEmptyInventoryOperationVariantDraft())
    setInventoryOperationActiveVariantId('')
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
  }

  function updateInventoryOperationVariantField(field: keyof InventoryOperationVariantDraft, value: string) {
    const nextVariant = { ...inventoryOperationVariant, [field]: field === 'category' ? (value === 'child' ? 'child' : 'adult') : value } as InventoryOperationVariantDraft
    const previousRow = matchedInventoryOperationVariant
    const previousQuantity = previousRow ? Number(draftItemForVariant(previousRow.variantId)?.quantity || 0) : 0
    const same = (left: unknown, right: unknown) => normalizeSearchText(left) === normalizeSearchText(right)
    const nextRow = selectedInventoryOperationGroup?.rows.find((row) => (
      getInventoryRowCategory(row) === nextVariant.category
      && same(row.gender, nextVariant.gender)
      && same(row.color, nextVariant.color)
      && same(row.material, nextVariant.material)
      && same(row.length, nextVariant.length)
      && same(row.size, nextVariant.size)
    )) || null

    setInventoryOperationVariant(nextVariant)
    setInventoryOperationActiveVariantId(nextRow ? String(nextRow.variantId || '') : '')

    if (previousRow && String(previousRow.variantId || '') !== String(nextRow?.variantId || '') && previousQuantity > 0) {
      setInventoryDraft((current) => {
        const remaining = current.items.filter((item) => String(item.variantId || '') !== String(previousRow.variantId || ''))
        if (!nextRow) return { ...current, items: remaining.length ? remaining : [createEmptyInventoryItem()] }
        const existingTargetQuantity = Number(remaining.find((item) => String(item.variantId || '') === String(nextRow.variantId || ''))?.quantity || 0)
        const safeQuantity = Math.min(previousQuantity + existingTargetQuantity, Math.max(0, Number(nextRow.quantity || 0)))
        const withoutTarget = remaining.filter((item) => String(item.variantId || '') !== String(nextRow.variantId || ''))
        const nextItems = safeQuantity > 0 ? [...withoutTarget, createInventoryItemFromStockRow(nextRow, safeQuantity)] : withoutTarget
        return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
      })
    }
  }

  function createInventoryItemFromStockRow(row: InventoryStockRecord, quantity: number): InventoryDraftItem {
    return {
      productId: row.productId ? String(row.productId) : '',
      variantId: String(row.variantId || ''),
      productName: row.productName || '',
      category: getInventoryRowCategory(row),
      gender: row.gender || '',
      color: row.color || '',
      material: row.material || '',
      length: row.length || '',
      size: row.size || '',
      quantity,
      expectedQuantity: Number(row.quantity || 0),
      observedPhysicalQuantity: null,
    }
  }

  function draftItemForVariant(variantId: string | number) {
    const id = String(variantId || '')
    return inventoryDraft.items.find((item) => String(item.variantId || '') === id)
  }

  function setInventoryVariantOperationQuantity(row: InventoryStockRecord, quantity: number) {
    const physical = Math.max(0, Number(row.quantity || 0))
    const requested = Math.max(0, Math.trunc(Number(quantity || 0)))
    const nextQuantity = inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'writeoff' || inventoryDraft.movementType === 'arrival' ? requested : Math.min(physical, requested)
    const variantId = String(row.variantId || '')
    if (!variantId) return
    setInventoryDraft((current) => {
      const withoutEmpty = current.items.filter((item) => item.variantId || item.productName)
      const exists = withoutEmpty.some((item) => String(item.variantId || '') === variantId)
      let nextItems = exists
        ? withoutEmpty.map((item) => String(item.variantId || '') === variantId
          ? {
              ...item,
              quantity: nextQuantity,
              observedPhysicalQuantity: current.movementType === 'manual_set' ? item.observedPhysicalQuantity : null,
            }
          : item)
        : [...withoutEmpty, createInventoryItemFromStockRow(row, nextQuantity)]
      nextItems = nextItems.filter((item) => item.quantity > 0 || String(item.variantId || '') !== variantId)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }

  function startInventoryTransferFromStockRow(source: InventorySourceKey, row: InventoryStockRecord) {
    if (!row.variantId || Number(row.quantity || 0) <= 0) return
    const targetSource: InventorySourceKey = source === 'warehouse' ? 'boutique' : 'warehouse'
    setInventoryTransferRequestId(makeCashRequestId('inventory-transfer'))
    setInventoryDraft({
      source,
      targetSource,
      movementType: 'transfer',
      comment: '',
      items: [createInventoryItemFromStockRow(row, 0)],
    })
    setInventoryOperationSearch(row.productName || '')
    const key = row.productId ? `id:${row.productId}` : `name:${normalizeSuggestion(row.productName)}`
    setInventoryOperationProductKey(key)
    setInventoryOperationVariant(inventoryOperationVariantFromRow(row))
    setInventoryOperationActiveVariantId(String(row.variantId || ''))
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
    openInventoryPanel('movement')
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-transfer-variant="${row.variantId}"] input[type="number"]`)
      input?.focus()
      input?.select()
    })
  }

  function removeInventoryVariantOperationItem(variantId: string | number) {
    const id = String(variantId || '')
    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => String(item.variantId || '') !== id)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }




  return {
    selectInventoryOperationVariant,
    selectInventoryOperationProduct,
    updateInventoryDirectProductInput,
    updateInventoryOperationVariantField,
    setInventoryVariantOperationQuantity,
    startInventoryTransferFromStockRow,
    removeInventoryVariantOperationItem,
  }
}
