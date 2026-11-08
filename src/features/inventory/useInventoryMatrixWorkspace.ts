import { useMemo, type Dispatch, type SetStateAction, type KeyboardEvent } from 'react'
import type { CatalogResponse, CatalogVariantRecord, InventoryDraft, InventoryDraftItem, InventoryMatrixDraft, InventoryStockRecord } from '../../app/types'
import { createEmptyInventoryItem, createEmptyInventoryMatrixDraft, getCatalogVariantCategory, inventoryMatrixCellKey, normalizeSuggestion, sortSizeLikeValues } from '../../app/utils'

type InventoryMatrixWorkspaceArgs = {
  inventoryDraft: InventoryDraft
  setInventoryDraft: Dispatch<SetStateAction<InventoryDraft>>
  inventoryMatrix: InventoryMatrixDraft
  setInventoryMatrix: Dispatch<SetStateAction<InventoryMatrixDraft>>
  inventoryMatrixColorToAdd: string
  setInventoryMatrixColorToAdd: Dispatch<SetStateAction<string>>
  inventoryMatrixSizeToAdd: string
  setInventoryMatrixSizeToAdd: Dispatch<SetStateAction<string>>
  inventoryOperationSourceRows: InventoryStockRecord[]
  catalogData: CatalogResponse | null
  variantsForProduct: (productId: string | number) => CatalogVariantRecord[]
  getInventoryRowCategory: (row: InventoryStockRecord) => 'adult' | 'child'
  inventoryMatrixCellMap: ReadonlyMap<string, { variantId: number; current: number; color: string; size: string }>
  inventoryMatrixColors: string[]
  suggestionValues: { materials: string[]; lengths: string[] }
  setInventoryOperationSearch: Dispatch<SetStateAction<string>>
  setInventoryOperationProductKey: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
}

function preferredInventoryMatrixValue(values: string[], fallback = '') {
  if (!values.length) return fallback
  return values.find((value) => normalizeSuggestion(value) === 'СТАНДАРТ') ?? values[0] ?? fallback
}

function inventoryMatrixGroupKey(value: Pick<InventoryMatrixDraft, 'productId' | 'productName' | 'category' | 'gender' | 'material' | 'length'> | InventoryDraftItem) {
  const productKey = String(value.productId || '').trim()
    ? `id:${String(value.productId).trim()}`
    : `name:${normalizeSuggestion(value.productName)}`
  return [
    productKey,
    value.category,
    normalizeSuggestion(value.gender),
    normalizeSuggestion(value.material),
    normalizeSuggestion(value.length),
  ].join('¦')
}


export function useInventoryMatrixWorkspace({
  inventoryDraft,
  setInventoryDraft,
  inventoryMatrix,
  setInventoryMatrix,
  inventoryMatrixColorToAdd,
  setInventoryMatrixColorToAdd,
  inventoryMatrixSizeToAdd,
  setInventoryMatrixSizeToAdd,
  inventoryOperationSourceRows,
  catalogData,
  variantsForProduct,
  getInventoryRowCategory,
  inventoryMatrixCellMap,
  inventoryMatrixColors,
  suggestionValues,
  setInventoryOperationSearch,
  setInventoryOperationProductKey,
  setError,
  setMessage,
}: InventoryMatrixWorkspaceArgs) {
  const inventoryMatrixActiveGroupKey = inventoryMatrixGroupKey(inventoryMatrix)
  const inventoryMatrixCurrentGroupItems = useMemo(() => inventoryDraft.items.filter((item) => (
    item.touched
    && item.productName
    && inventoryMatrixGroupKey(item) === inventoryMatrixActiveGroupKey
  )), [inventoryDraft.items, inventoryMatrixActiveGroupKey])
  const inventoryMatrixBatchGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string
      productId: string
      productName: string
      category: 'adult' | 'child'
      gender: string
      material: string
      length: string
      colors: string[]
      sizes: string[]
      rows: number
      totalQuantity: number
    }>()

    for (const item of inventoryDraft.items) {
      if (!item.touched || !item.productName) continue
      if (inventoryDraft.movementType !== 'manual_set' && Number(item.quantity || 0) <= 0) continue
      const key = inventoryMatrixGroupKey(item)
      const existing = groups.get(key) || {
        key,
        productId: String(item.productId || ''),
        productName: item.productName,
        category: item.category,
        gender: item.gender,
        material: item.material,
        length: item.length,
        colors: [],
        sizes: [],
        rows: 0,
        totalQuantity: 0,
      }
      existing.rows += 1
      existing.totalQuantity += Number(item.quantity || 0)
      if (item.color && !existing.colors.includes(item.color)) existing.colors.push(item.color)
      if (item.size && !existing.sizes.includes(item.size)) existing.sizes.push(item.size)
      groups.set(key, existing)
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      colors: [...group.colors].sort((left, right) => left.localeCompare(right, 'ru')),
      sizes: sortSizeLikeValues(group.sizes),
    }))
  }, [inventoryDraft.items, inventoryDraft.movementType])
  const inventoryMatrixSummary = useMemo(() => {
    const edited = inventoryMatrixCurrentGroupItems
    const currentTotal = Array.from(inventoryMatrixCellMap.values()).reduce((sum, cell) => sum + cell.current, 0)
    if (inventoryDraft.movementType === 'manual_set') {
      const delta = edited.reduce((sum, item) => sum + Number(item.quantity || 0) - Number(item.expectedQuantity || 0), 0)
      return { edited: edited.length, entered: edited.reduce((sum, item) => sum + Number(item.quantity || 0), 0), currentTotal, afterTotal: currentTotal + delta, delta }
    }
    const entered = edited.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    return { edited: edited.length, entered, currentTotal, afterTotal: currentTotal + entered, delta: entered }
  }, [inventoryMatrixCurrentGroupItems, inventoryDraft.movementType, inventoryMatrixCellMap])



  function clearInventoryMatrixValues() {
    const activeKey = inventoryMatrixGroupKey(inventoryMatrix)
    if (!inventoryMatrix.productName.trim()) return
    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => !item.touched || inventoryMatrixGroupKey(item) !== activeKey)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }

  function startNextInventoryMatrixProduct() {
    if (!inventoryMatrixCurrentGroupItems.length) {
      setError('Сначала укажите количество хотя бы в одной клетке текущего товара.')
      return
    }
    setError(null)
    setMessage(inventoryDraft.movementType === 'arrival'
      ? `«${inventoryMatrix.productName}» добавлен в текущий приход. Теперь выберите следующий товар.`
      : `«${inventoryMatrix.productName}» добавлен в текущую операцию. Теперь выберите следующую группу.`)
    setInventoryOperationSearch('')
    setInventoryOperationProductKey('')
    setInventoryMatrix(createEmptyInventoryMatrixDraft())
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
  }

  function openInventoryMatrixBatchGroup(groupKey: string) {
    const group = inventoryMatrixBatchGroups.find((entry) => entry.key === groupKey)
    if (!group) return
    setError(null)
    setInventoryOperationSearch(group.productName)
    setInventoryOperationProductKey(group.productId ? `id:${group.productId}` : `name:${normalizeSuggestion(group.productName)}`)
    setInventoryMatrix({
      productId: group.productId,
      productName: group.productName,
      category: group.category,
      gender: group.gender,
      material: group.material,
      length: group.length,
      extraColors: group.colors,
      extraSizes: group.sizes,
      ready: true,
    })
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
  }

  function removeInventoryMatrixBatchGroup(groupKey: string) {
    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => !item.touched || inventoryMatrixGroupKey(item) !== groupKey)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
    if (inventoryMatrixActiveGroupKey === groupKey) {
      setInventoryOperationSearch('')
      setInventoryOperationProductKey('')
      setInventoryMatrix(createEmptyInventoryMatrixDraft())
      setInventoryMatrixColorToAdd('')
      setInventoryMatrixSizeToAdd('')
    }
  }

  function configureInventoryMatrixProduct(productId: string | number, productName: string, stockRows?: InventoryStockRecord[]) {
    const variants = productId ? variantsForProduct(productId) : []
    const sourceRows = stockRows || []
    const source = sourceRows.length ? sourceRows : variants

    const combinations = new Map<string, {
      category: 'adult' | 'child'
      gender: string
      material: string
      length: string
      count: number
      standardScore: number
    }>()

    for (const row of source) {
      const category = 'inventorySource' in row ? getInventoryRowCategory(row) : getCatalogVariantCategory(row)
      const gender = String(row.gender || '').trim()
      const material = String(row.material || '').trim()
      const length = String(row.length || '').trim()
      const key = [category, normalizeSuggestion(gender), normalizeSuggestion(material), normalizeSuggestion(length)].join('¦')
      const existing = combinations.get(key)
      if (existing) {
        existing.count += 1
      } else {
        combinations.set(key, {
          category,
          gender,
          material,
          length,
          count: 1,
          standardScore: (normalizeSuggestion(material) === 'СТАНДАРТ' ? 1 : 0) + (normalizeSuggestion(length) === 'СТАНДАРТ' ? 1 : 0),
        })
      }
    }

    const preferred = [...combinations.values()].sort((left, right) => (
      right.count - left.count
      || right.standardScore - left.standardScore
      || left.category.localeCompare(right.category)
      || left.gender.localeCompare(right.gender, 'ru')
      || left.material.localeCompare(right.material, 'ru')
      || left.length.localeCompare(right.length, 'ru', { numeric: true })
    ))[0]

    const category = preferred?.category || 'adult'
    const gender = preferred?.gender || (category === 'child' ? 'ДЕТСКИЙ' : '')
    const material = preferred?.material || preferredInventoryMatrixValue(suggestionValues.materials, 'СТАНДАРТ')
    const length = preferred?.length || preferredInventoryMatrixValue(suggestionValues.lengths, 'СТАНДАРТ')

    setInventoryMatrix({
      productId: String(productId || ''),
      productName,
      category,
      gender,
      material,
      length,
      extraColors: [],
      extraSizes: [],
      ready: false,
    })
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixProductInput(value: string) {
    setInventoryOperationSearch(value)
    const normalized = normalizeSuggestion(value)

    if (!normalized) {
      setInventoryOperationProductKey('')
      setInventoryMatrix(createEmptyInventoryMatrixDraft())
      clearInventoryMatrixValues()
      return
    }

    if (inventoryDraft.movementType === 'arrival') {
      const product = (catalogData?.products || []).find((entry) => entry.isActive && normalizeSuggestion(entry.name) === normalized)
      if (product) {
        if (String(inventoryMatrix.productId) !== String(product.id)) {
          configureInventoryMatrixProduct(product.id, product.name)
        }
        return
      }

      setInventoryOperationProductKey('')
      setInventoryMatrix((current) => {
        const switchedFromCatalog = Boolean(current.productId)
        return {
          ...current,
          productId: '',
          productName: value,
          category: switchedFromCatalog ? 'adult' : current.category,
          gender: switchedFromCatalog ? '' : current.gender,
          material: switchedFromCatalog
            ? preferredInventoryMatrixValue(suggestionValues.materials, 'СТАНДАРТ')
            : (current.material || preferredInventoryMatrixValue(suggestionValues.materials, 'СТАНДАРТ')),
          length: switchedFromCatalog
            ? preferredInventoryMatrixValue(suggestionValues.lengths, 'СТАНДАРТ')
            : (current.length || preferredInventoryMatrixValue(suggestionValues.lengths, 'СТАНДАРТ')),
          extraColors: [],
          extraSizes: [],
          ready: false,
        }
      })
      clearInventoryMatrixValues()
      return
    }

    const stockRows = inventoryOperationSourceRows.filter((row) => normalizeSuggestion(row.productName) === normalized)
    if (stockRows.length) {
      const first = stockRows[0]
      const key = first.productId ? `id:${first.productId}` : `name:${normalized}`
      setInventoryOperationProductKey(key)
      if (String(inventoryMatrix.productId) !== String(first.productId || '') || normalizeSuggestion(inventoryMatrix.productName) !== normalized) {
        configureInventoryMatrixProduct(first.productId || '', first.productName, stockRows)
      }
      return
    }

    // An exact catalog product may have no row on the selected point yet. It is still
    // a valid choice: the matrix can create the missing combination instead of blocking it.
    const catalogProduct = (catalogData?.products || []).find((entry) => entry.isActive && normalizeSuggestion(entry.name) === normalized)
    if (catalogProduct) {
      setInventoryOperationProductKey(`id:${catalogProduct.id}`)
      configureInventoryMatrixProduct(catalogProduct.id, catalogProduct.name)
      return
    }

    setInventoryOperationProductKey('')
    setInventoryMatrix((current) => ({
      ...current,
      productId: '',
      productName: value,
      ready: false,
      extraColors: [],
      extraSizes: [],
    }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixCategory(category: 'adult' | 'child') {
    setInventoryMatrix((current) => ({
      ...current,
      category,
      gender: category === 'child' && !current.gender ? 'ДЕТСКИЙ' : current.gender,
      extraColors: [],
      extraSizes: [],
      ready: false,
    }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixGender(gender: string) {
    setInventoryMatrix((current) => ({ ...current, gender, extraColors: [], extraSizes: [], ready: false }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixMaterial(material: string) {
    setInventoryMatrix((current) => ({ ...current, material, extraColors: [], extraSizes: [], ready: false }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixLength(length: string) {
    setInventoryMatrix((current) => ({ ...current, length, extraColors: [], extraSizes: [], ready: false }))
    clearInventoryMatrixValues()
  }

  function buildInventoryMatrix() {
    const cleanProductName = inventoryMatrix.productName.trim()
    if (!cleanProductName) {
      setError('Сначала выберите или введите товар.')
      return
    }
    if (!inventoryMatrix.productId && inventoryMatrix.category === 'adult' && !inventoryMatrix.gender) {
      setError('Для нового взрослого товара выберите пол.')
      return
    }
    const finalProductName = inventoryDraft.movementType === 'arrival' && !inventoryMatrix.productId
      ? cleanProductName.toUpperCase()
      : cleanProductName
    setError(null)
    setInventoryOperationSearch(finalProductName)
    setInventoryMatrix((current) => ({ ...current, productName: finalProductName, ready: true }))
    clearInventoryMatrixValues()
  }

  function addInventoryMatrixColor(rawValue?: string) {
    const value = String(rawValue ?? inventoryMatrixColorToAdd).trim().toUpperCase()
    if (!value) return
    setInventoryMatrix((current) => ({ ...current, extraColors: Array.from(new Set([...current.extraColors, value])), ready: true }))
    setInventoryMatrixColorToAdd('')
  }

  function addInventoryMatrixSize(rawValue?: string) {
    const value = String(rawValue ?? inventoryMatrixSizeToAdd).trim().toUpperCase()
    if (!value) return
    setInventoryMatrix((current) => ({ ...current, extraSizes: Array.from(new Set([...current.extraSizes, value])), ready: true }))
    setInventoryMatrixSizeToAdd('')
  }

  function inventoryMatrixDraftItem(size: string, color: string) {
    const key = inventoryMatrixCellKey(size, color)
    return inventoryDraft.items.find((item) => (
      item.touched
      && inventoryMatrixGroupKey(item) === inventoryMatrixActiveGroupKey
      && inventoryMatrixCellKey(item.size, item.color) === key
    ))
  }

  function setInventoryMatrixCell(size: string, color: string, rawValue: string) {
    const key = inventoryMatrixCellKey(size, color)
    const existingCell = inventoryMatrixCellMap.get(key)
    const touched = rawValue !== ''
    const parsed = touched ? Math.max(0, Math.trunc(Number(rawValue || 0))) : 0
    const shouldKeep = touched && (inventoryDraft.movementType === 'manual_set' || parsed > 0)

    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => !(
        item.touched
        && inventoryMatrixGroupKey(item) === inventoryMatrixActiveGroupKey
        && inventoryMatrixCellKey(item.size, item.color) === key
      ))
      if (shouldKeep) {
        nextItems.push({
          productId: inventoryMatrix.productId,
          variantId: existingCell?.variantId ? String(existingCell.variantId) : '',
          productName: inventoryMatrix.productName,
          category: inventoryMatrix.category,
          gender: inventoryMatrix.gender,
          color,
          material: inventoryMatrix.material,
          length: inventoryMatrix.length,
          size,
          quantity: parsed,
          touched: true,
          expectedQuantity: existingCell?.current ?? 0,
        })
      }
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }

  function handleInventoryMatrixKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!['Enter', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.inventory-matrix-input:not(:disabled)'))
    const index = inputs.indexOf(event.currentTarget)
    if (index < 0) return
    const columns = Math.max(1, inventoryMatrixColors.length)
    const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : 1
    const next = inputs[index + offset]
    if (next) {
      event.preventDefault()
      next.focus()
      next.select()
    }
  }


  return {
    inventoryMatrixActiveGroupKey,
    inventoryMatrixCurrentGroupItems,
    inventoryMatrixBatchGroups,
    inventoryMatrixSummary,
    clearInventoryMatrixValues,
    startNextInventoryMatrixProduct,
    openInventoryMatrixBatchGroup,
    removeInventoryMatrixBatchGroup,
    configureInventoryMatrixProduct,
    updateInventoryMatrixProductInput,
    updateInventoryMatrixCategory,
    updateInventoryMatrixGender,
    updateInventoryMatrixMaterial,
    updateInventoryMatrixLength,
    buildInventoryMatrix,
    addInventoryMatrixColor,
    addInventoryMatrixSize,
    inventoryMatrixDraftItem,
    setInventoryMatrixCell,
    handleInventoryMatrixKeyDown,
  }
}
