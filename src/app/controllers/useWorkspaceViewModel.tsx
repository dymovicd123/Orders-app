import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type {
  AppSector,
  CatalogProductRecord,
  CatalogResponse,
  CatalogVariantRecord,
  EditorDraft,
  EditorItem,
  ExchangeDraft,
  InventoryDraft,
  InventoryMatrixDraft,
  InventoryResponse,
  InventorySourceKey,
  InventoryStockRecord,
  OrderPanel,
  ReferenceData,
  ReferenceKind,
  ReferenceListItem,
} from '../types'
import { FALLBACK_REFERENCE_DATA, emptyReferenceData, referenceKindOptions } from '../constants'
import {
  canonicalCatalogProductKey,
  canonicalStockPositionValue,
  getCatalogVariantCategory,
  inventoryMatrixCellKey,
  isLikelyAdultSizeValue,
  isLikelyChildAgeValue,
  normalizeAudienceTypeValue,
  normalizeSearchText,
  normalizeSuggestion,
  rankSmartPickerOption,
  sortSizeLikeValues,
  sourceLabel,
} from '../utils'

type ReferenceGroupSummary = { kind: ReferenceKind; label: string; count: number; help: string }

type WorkspaceViewModelArgs = {
  activeCatalogVariants: CatalogVariantRecord[]
  activeSector: AppSector
  catalogData: CatalogResponse | null
  catalogVariantsByProductId: Map<number, CatalogVariantRecord[]>
  createDraft: EditorDraft
  editorDraft: EditorDraft | null
  getCatalogProductEffectiveCategory: (product?: CatalogProductRecord | null) => 'adult' | 'child'
  getInventoryRowCategory: (row: Pick<InventoryStockRecord, 'productId' | 'productName' | 'variantId' | 'gender' | 'size'>) => 'adult' | 'child'
  getStockQuantityForVariant: (source: InventorySourceKey, variantId: string | number) => number | null
  inventoryData: { warehouse: InventoryResponse | null; boutique: InventoryResponse | null }
  inventoryDraft: InventoryDraft
  inventoryMatrix: InventoryMatrixDraft
  inventoryOperationSourceRows: InventoryStockRecord[]
  orderPanel: OrderPanel
  referenceGroups: ReferenceGroupSummary[]
  referenceItems: ReferenceListItem[]
  referenceKind: ReferenceKind
  referenceSearch: string
  referenceStatusFilter: 'all' | 'active' | 'inactive'
  references: ReferenceData | null
  setCreateDraft: Dispatch<SetStateAction<EditorDraft>>
  setEditorDraft: Dispatch<SetStateAction<EditorDraft | null>>
  setExchangeDraft: Dispatch<SetStateAction<ExchangeDraft>>
  variantsForProduct: (productId: string | number) => CatalogVariantRecord[]
}

export function useWorkspaceViewModel({
  activeCatalogVariants,
  activeSector,
  catalogData,
  catalogVariantsByProductId,
  createDraft,
  editorDraft,
  getCatalogProductEffectiveCategory,
  getInventoryRowCategory,
  getStockQuantityForVariant,
  inventoryData,
  inventoryDraft,
  inventoryMatrix,
  inventoryOperationSourceRows,
  orderPanel,
  referenceGroups,
  referenceItems,
  referenceKind,
  referenceSearch,
  referenceStatusFilter,
  references,
  setCreateDraft,
  setEditorDraft,
  setExchangeDraft,
  variantsForProduct,
}: WorkspaceViewModelArgs) {
const sectorStyle = (sector: typeof activeSector) => ({ display: activeSector === sector ? undefined : 'none' })
  const orderPanelStyle = (panel: OrderPanel) => ({
    display: activeSector === 'orders' && orderPanel === panel ? undefined : 'none',
  })

  const pageTitleMap: Record<AppSector, { title: string; subtitle: string }> = {
    overview: {
      title: 'Инфопанель',
      subtitle: 'Краткая сводка по системе и быстрые переходы к основным разделам.',
    },
    orders: {
      title: 'Заказы',
      subtitle: 'Отдельные карточки для ввода, таблицы, долгов, возвратов и обмена. Ничего не смешивается в одну массу.',
    },
    clients: {
      title: 'Клиенты',
      subtitle: 'Быстрый информационный список клиентов и история их заказов.',
    },
    workshop: {
      title: 'Цех',
      subtitle: 'Текущие позиции цеха и быстрый перевод заказа в готово.',
    },
    inventory: {
      title: 'Склад',
      subtitle: 'Единый модуль: склад, бутик, каталог товаров, приход, списания, перемещения и движения.',
    },
    finance: {
      title: 'Финансы',
      subtitle: 'Фактические поступления, возвраты, долги, обмены и способы оплаты.',
    },
    references: {
      title: 'Справочники',
      subtitle: 'Общие списки заказов: города, доставка и причины возврата. Характеристики товаров теперь находятся в Складе.',
    },
    team: {
      title: 'Команда',
      subtitle: 'Активные и бывшие сотрудники, доступ, даты работы и история без смешивания людей.',
    },
    leads: {
      title: 'Лиды',
      subtitle: 'Лиды и Call Centre разделены режимами, как в старой системе.',
    },
    plan: {
      title: 'План',
      subtitle: 'План менеджера, план отдела и выполнение за период.',
    },
    reports: {
      title: 'Отчёты',
      subtitle: 'Сводные финансовые и операционные отчёты отдельной вкладкой.',
    },
  }
  const pageTitle = pageTitleMap[activeSector]

  const selectedReferenceKindConfig = useMemo(
    () => referenceKindOptions.find((entry) => entry.kind === referenceKind) || referenceKindOptions[0],
    [referenceKind],
  )

  const filteredReferenceItems = useMemo(() => {
    const query = normalizeSuggestion(referenceSearch)
    return (referenceItems || []).filter((item) => {
      if (referenceStatusFilter === 'active' && !item.isActive) return false
      if (referenceStatusFilter === 'inactive' && item.isActive) return false
      if (!query) return true
      const searchable = [item.value, String(item.sortOrder), item.isActive ? 'АКТИВЕН' : 'НЕАКТИВЕН']
        .map((value) => normalizeSuggestion(value))
        .join(' ')
      return searchable.includes(query)
    })
  }, [referenceItems, referenceSearch, referenceStatusFilter])

  const referenceStats = useMemo(() => {
    const active = referenceItems.filter((item) => item.isActive).length
    const inactive = referenceItems.length - active
    return {
      total: referenceItems.length,
      active,
      inactive,
      filtered: filteredReferenceItems.length,
      kinds: referenceGroups.length,
    }
  }, [filteredReferenceItems.length, referenceGroups.length, referenceItems])

  const suggestionValues = useMemo(() => {
    const refs = references || emptyReferenceData
    void FALLBACK_REFERENCE_DATA
    const catalogProducts = catalogData?.products?.map((product) => product.name) || []
    const optionSort = (a: string, b: string) => {
      const aNum = Number(String(a).replace(',', '.'))
      const bNum = Number(String(b).replace(',', '.'))
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && String(a).match(/^[0-9]+/) && String(b).match(/^[0-9]+/)) {
        return aNum - bNum || a.localeCompare(b, 'ru')
      }
      return a.localeCompare(b, 'ru', { numeric: true })
    }

    const collect = (...groups: Array<Array<unknown> | readonly unknown[] | undefined>) => {
      const result = new Set<string>()
      for (const group of groups) {
        for (const value of group || []) {
          const normalized = normalizeSuggestion(value)
          if (normalized) result.add(normalized)
        }
      }
      return [...result].sort(optionSort)
    }

    return {
      // Канонические источники подсказок:
      // менеджеры — только из «Команда», товары — только из «Склад → Товары»,
      // характеристики — только из справочников. История заказов и старые fallback-списки
      // больше не подмешиваются в рабочие формы.
      managers: collect(refs.managers),
      cities: collect(refs.cities),
      deliveryTypes: collect(refs.deliveryTypes),
      paymentMethods: collect(refs.paymentMethods),
      products: collect(catalogProducts),
      genders: collect((catalogData?.variants || []).map((variant) => variant.gender)),
      colors: collect(refs.colors),
      materials: collect(refs.materials),
      lengths: collect(refs.lengths),
      sizes: sortSizeLikeValues(collect(refs.sizes).filter(isLikelyAdultSizeValue)),
      childAges: sortSizeLikeValues(collect(refs.childAges).filter(isLikelyChildAgeValue)),
      returnReasons: collect(refs.returnReasons),
      writeoffReasons: collect(refs.writeoffReasons),
    }
  }, [references, catalogData])

  const arrivalSuggestionValues = useMemo(() => {
    const variants = (catalogData?.variants || []).filter((variant) => variant.isActive)
    const merge = (base: string[], extra: unknown[]) => {
      const map = new Map<string, string>()
      for (const raw of [...base, ...extra]) {
        const value = String(raw || '').trim()
        const key = normalizeSearchText(value)
        if (value && key && !map.has(key)) map.set(key, value)
      }
      return [...map.values()].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    }
    return {
      genders: merge(suggestionValues.genders || [], variants.map((variant) => variant.gender)),
      colors: merge(suggestionValues.colors || [], variants.map((variant) => variant.color)),
      materials: merge(suggestionValues.materials || [], variants.map((variant) => variant.material)),
      lengths: merge(suggestionValues.lengths || [], variants.map((variant) => variant.length)),
      sizes: sortSizeLikeValues(merge(suggestionValues.sizes || [], variants.filter((variant) => getCatalogVariantCategory(variant) === 'adult').map((variant) => variant.sizeLabel)).filter(isLikelyAdultSizeValue)),
      childAges: sortSizeLikeValues(merge(suggestionValues.childAges || [], variants.filter((variant) => getCatalogVariantCategory(variant) === 'child').map((variant) => variant.sizeLabel)).filter(isLikelyChildAgeValue)),
    }
  }, [catalogData, suggestionValues])

  const childProductLookup = useMemo(() => {
    return new Set((references?.childProducts || []).map((value) => normalizeSuggestion(value)))
  }, [references?.childProducts])

  const getSizeOptions = (productName?: string, type?: string) => {
    const typeKey = normalizeAudienceTypeValue(type)
    if (typeKey === 'ДЕТСКИЙ') return suggestionValues.childAges
    const key = normalizeSuggestion(productName)
    if (!type && key && (childProductLookup.has(key) || key.includes('ДЕТСК'))) return suggestionValues.childAges
    return suggestionValues.sizes
  }

  function buildOrderItemFromCatalogPick(currentItem: EditorItem, productName: string): EditorItem {
    const cleanProductName = String(productName || '').trim()
    if (!cleanProductName) {
      return {
        ...currentItem,
        productName: '',
        audienceType: 'ВЗРОСЛЫЙ',
        gender: '',
        color: '',
        material: 'СТАНДАРТ',
        length: 'СТАНДАРТ',
        size: '',
      }
    }

    const product = (catalogData?.products || []).find((row) => (
      row.isActive && normalizeSuggestion(row.name) === normalizeSuggestion(cleanProductName)
    )) || null
    if (!product) {
      return {
        ...currentItem,
        productName: cleanProductName,
        material: canonicalStockPositionValue(currentItem.material),
        length: canonicalStockPositionValue(currentItem.length),
      }
    }

    const variants = (catalogVariantsByProductId.get(Number(product.id)) || []).filter((variant) => variant.isActive)
    if (!variants.length) {
      return {
        ...currentItem,
        productName: product.name,
        audienceType: getCatalogProductEffectiveCategory(product) === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
        gender: '',
        color: '',
        material: 'СТАНДАРТ',
        length: 'СТАНДАРТ',
        size: '',
      }
    }

    const adultVariants = variants.filter((variant) => getCatalogVariantCategory(variant) === 'adult')
    const childVariants = variants.filter((variant) => getCatalogVariantCategory(variant) === 'child')
    const currentCategory = normalizeAudienceTypeValue(currentItem.audienceType) === 'ДЕТСКИЙ' ? 'child' : 'adult'
    const targetCategory: 'adult' | 'child' = childVariants.length && !adultVariants.length
      ? 'child'
      : adultVariants.length && !childVariants.length
        ? 'adult'
        : currentCategory

    const source = currentItem.sourceType === 'boutique' ? 'boutique' : 'warehouse'
    const stockByVariant = new Map<number, number>()
    for (const row of inventoryData[source]?.items || []) {
      if (Number(row.productId || 0) !== Number(product.id)) continue
      const variantId = Number(row.variantId || 0)
      stockByVariant.set(variantId, (stockByVariant.get(variantId) || 0) + Number(row.quantity || 0))
    }

    // Autocomplete is based on the most common catalogue combination, not on
    // the first arbitrary variant. A "combination" here is category + gender +
    // material + length; colors and sizes form the variants inside that group.
    const groups = new Map<string, { variants: CatalogVariantRecord[]; frequency: number; stockTotal: number; bestSortOrder: number }>()
    for (const variant of variants) {
      const category = getCatalogVariantCategory(variant)
      const key = [category, variant.gender, canonicalStockPositionValue(variant.material), canonicalStockPositionValue(variant.length)].map(normalizeSuggestion).join('||')
      const group = groups.get(key) || { variants: [], frequency: 0, stockTotal: 0, bestSortOrder: Number.POSITIVE_INFINITY }
      group.variants.push(variant)
      group.frequency += 1
      group.stockTotal += Math.max(0, stockByVariant.get(Number(variant.id)) || 0)
      group.bestSortOrder = Math.min(group.bestSortOrder, Math.max(0, Number(variant.sortOrder || 0)))
      groups.set(key, group)
    }

    const selectedGroup = [...groups.values()].sort((left, right) => {
      const leftCategory = getCatalogVariantCategory(left.variants[0]) === targetCategory ? 0 : 1
      const rightCategory = getCatalogVariantCategory(right.variants[0]) === targetCategory ? 0 : 1
      if (leftCategory !== rightCategory) return leftCategory - rightCategory
      if (left.frequency !== right.frequency) return right.frequency - left.frequency
      if (currentItem.sourceType !== 'workshop' && left.stockTotal !== right.stockTotal) return right.stockTotal - left.stockTotal
      if (left.bestSortOrder !== right.bestSortOrder) return left.bestSortOrder - right.bestSortOrder
      return String(left.variants[0].gender || '').localeCompare(String(right.variants[0].gender || ''), 'ru')
    })[0]

    const selected = [...(selectedGroup?.variants || variants)].sort((left, right) => {
      const leftStock = stockByVariant.get(Number(left.id)) || 0
      const rightStock = stockByVariant.get(Number(right.id)) || 0
      if (currentItem.sourceType !== 'workshop' && leftStock !== rightStock) return rightStock - leftStock
      const sortDifference = Math.max(0, Number(left.sortOrder || 0)) - Math.max(0, Number(right.sortOrder || 0))
      if (sortDifference) return sortDifference
      return String(left.color || '').localeCompare(String(right.color || ''), 'ru')
        || String(left.sizeLabel || '').localeCompare(String(right.sizeLabel || ''), 'ru', { numeric: true })
    })[0]

    return {
      ...currentItem,
      productName: product.name,
      audienceType: getCatalogVariantCategory(selected) === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
      gender: selected.gender || '',
      color: selected.color || '',
      material: canonicalStockPositionValue(selected.material),
      length: canonicalStockPositionValue(selected.length),
      size: selected.sizeLabel || '',
      stockObservationEnabled: false,
      observedPhysicalQuantity: null,
    }
  }

  function applyCreateProductPick(index: number, productName: string) {
    setCreateDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? buildOrderItemFromCatalogPick(item, productName) : item
      )),
    }))
  }

  function applyEditorProductPick(index: number, productName: string) {
    setEditorDraft((current) => current ? ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? buildOrderItemFromCatalogPick(item, productName) : item
      )),
    }) : current)
  }


  function applyExchangeProductPick(productName: string) {
    setExchangeDraft((current) => ({
      ...current,
      newItem: {
        ...buildOrderItemFromCatalogPick(current.newItem, productName),
        stockObservationEnabled: false,
        observedPhysicalQuantity: null,
      },
    }))
  }

  function resolveClientCatalogProduct(productName: unknown) {
    const inputKey = canonicalCatalogProductKey(productName)
    if (!inputKey) return null
    const direct = (catalogData?.products || []).find((product) => product.isActive && canonicalCatalogProductKey(product.name) === inputKey) || null
    if (direct) return direct
    const alias = (catalogData?.productAliases || []).find((candidate) => canonicalCatalogProductKey(candidate.rawValue) === inputKey) || null
    return alias
      ? (catalogData?.products || []).find((product) => product.isActive && Number(product.id) === Number(alias.productId)) || null
      : null
  }

  const resolveClientCatalogValue = (kind: string, value: unknown) => {
    const normalized = normalizeSuggestion(value)
    if (!normalized) return normalized
    const alias = (catalogData?.valueAliases || []).find((candidate) => candidate.kind === kind && normalizeSuggestion(candidate.rawValue) === normalized)
    return normalizeSuggestion(alias?.canonicalValue || normalized)
  }
  const canonicalOrderGender = (value: unknown) => {
    const normalized = normalizeSuggestion(value)
    if (!normalized) return ''
    if (normalized.includes('ЖЕН')) return 'ЖЕН'
    if (normalized.includes('МУЖ')) return 'МУЖ'
    return normalized
  }
  const canonicalOrderColor = (value: unknown) => resolveClientCatalogValue('color', value) || 'БЕЗ ЦВЕТА'
  const canonicalOrderMaterial = (value: unknown) => resolveClientCatalogValue('material', canonicalStockPositionValue(value)) || 'СТАНДАРТ'
  const canonicalOrderLength = (value: unknown) => resolveClientCatalogValue('length', canonicalStockPositionValue(value)) || 'СТАНДАРТ'
  const canonicalOrderSize = (value: unknown, category: 'adult' | 'child' = 'adult') => {
    const normalized = normalizeSuggestion(value)
    const compact = !normalized || ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(normalized) ? '' : normalized
    return compact ? resolveClientCatalogValue(category === 'child' ? 'child_age' : 'size', compact) : ''
  }

  function getOrderSourceAvailability(item: EditorItem, requiredQuantity = Math.max(1, Number(item.quantity || 1))) {
    const productName = String(item.productName || '').trim()
    if (!productName) return null

    const source = (item.sourceType || 'warehouse') as 'warehouse' | 'boutique' | 'workshop'
    const sourceTitle = sourceLabel(source)
    const searchName = normalizeSearchText(productName)
    const searchTokens = searchName.split(/\s+/).filter(Boolean)
    const expectedCategory = normalizeAudienceTypeValue(item.audienceType) === 'ДЕТСКИЙ' ? 'child' : 'adult'
    const same = (left: unknown, right: unknown) => normalizeSuggestion(left) === normalizeSuggestion(right)
    const sameProduct = (left: unknown, right: unknown) => canonicalCatalogProductKey(left) === canonicalCatalogProductKey(right)
    const hasReference = (values: string[], value: unknown, standardAllowed = false) => {
      const normalized = normalizeSuggestion(value)
      if (!normalized) return true
      if (standardAllowed && normalized === 'СТАНДАРТ') return true
      return values.some((candidate) => same(candidate, normalized))
    }

    const catalogProduct = resolveClientCatalogProduct(productName)
    const resolvedProductName = catalogProduct?.name || productName
    const catalogVariants = catalogProduct
      ? (catalogVariantsByProductId.get(Number(catalogProduct.id)) || []).filter((variant) => variant.isActive)
      : []

    const catalogVariantIsExact = (variant: CatalogVariantRecord) => (
      getCatalogVariantCategory(variant) === expectedCategory
      && canonicalOrderGender(variant.gender) === canonicalOrderGender(item.gender)
      && canonicalOrderColor(variant.color) === canonicalOrderColor(item.color)
      && canonicalOrderMaterial(variant.material) === canonicalOrderMaterial(item.material)
      && canonicalOrderLength(variant.length) === canonicalOrderLength(item.length)
      && canonicalOrderSize(variant.sizeLabel, expectedCategory) === canonicalOrderSize(item.size, expectedCategory)
    )
    const exactCatalogVariants = catalogVariants.filter(catalogVariantIsExact)

    const unknownFacts: string[] = []
    const normalizedGender = canonicalOrderGender(item.gender)
    if (normalizedGender && normalizedGender !== 'ЖЕН' && normalizedGender !== 'МУЖ') unknownFacts.push('пол')
    if (!hasReference(suggestionValues.materials, canonicalOrderMaterial(item.material), true)) unknownFacts.push('материал')
    if (!hasReference(suggestionValues.lengths, canonicalOrderLength(item.length), true)) unknownFacts.push('длина')
    if (!hasReference(suggestionValues.colors, canonicalOrderColor(item.color))) unknownFacts.push('цвет')
    const sizeValues = expectedCategory === 'child' ? suggestionValues.childAges : suggestionValues.sizes
    if (!hasReference(sizeValues, canonicalOrderSize(item.size, expectedCategory))) unknownFacts.push(expectedCategory === 'child' ? 'возраст' : 'размер')
    const canonicalFactsKnown = Boolean(catalogProduct) && unknownFacts.length === 0
    // Step 188E invariant: an already-existing exact catalog combination is authoritative
    // even if a reference dictionary row is stale or temporarily missing.
    const canonicalIdentityKnown = Boolean(catalogProduct) && (exactCatalogVariants.length > 0 || canonicalFactsKnown)

    const sourceRows = source === 'workshop' ? [] : (inventoryData[source]?.items || [])
    const sameProductRows = sourceRows.filter((row) => {
      if (!catalogProduct?.id) return sameProduct(row.productName, resolvedProductName)
      const rowProductId = Number(row.productId || 0)
      return rowProductId === Number(catalogProduct.id) || (!rowProductId && sameProduct(row.productName, resolvedProductName))
    })
    const rowIsExact = (row: InventoryStockRecord) => (
      getInventoryRowCategory(row) === expectedCategory
      && canonicalOrderGender(row.gender) === canonicalOrderGender(item.gender)
      && canonicalOrderColor(row.color) === canonicalOrderColor(item.color)
      && canonicalOrderMaterial(row.material) === canonicalOrderMaterial(item.material)
      && canonicalOrderLength(row.length) === canonicalOrderLength(item.length)
      && canonicalOrderSize(row.size, expectedCategory) === canonicalOrderSize(item.size, expectedCategory)
    )
    const exactSourceRows = sameProductRows.filter(rowIsExact)
    const physicalFor = (row: InventoryStockRecord) => Number(row.quantity || 0)
    const reservedFor = (row: InventoryStockRecord) => Number(row.reservedQuantity || 0)
    const availableFor = (row: InventoryStockRecord) => Number(row.availableQuantity ?? (physicalFor(row) - reservedFor(row)))
    const stockSummary = (rows: InventoryStockRecord[]) => {
      const physical = rows.reduce((sum, row) => sum + physicalFor(row), 0)
      const reserved = rows.reduce((sum, row) => sum + reservedFor(row), 0)
      const available = rows.reduce((sum, row) => sum + availableFor(row), 0)
      return { physical, reserved, available }
    }

    const mismatchScore = (row: InventoryStockRecord) => {
      let score = getInventoryRowCategory(row) === expectedCategory ? 0 : 4
      for (const [actual, expected, normalizer] of [
        [row.gender, item.gender, canonicalOrderGender],
        [row.color, item.color, canonicalOrderColor],
        [row.material, item.material, canonicalOrderMaterial],
        [row.length, item.length, canonicalOrderLength],
        [row.size, item.size, (value: unknown) => canonicalOrderSize(value, expectedCategory)],
      ] as Array<[unknown, unknown, (value: unknown) => string]>) {
        if (normalizeSuggestion(expected) && normalizer(actual) !== normalizer(expected)) score += 1
      }
      return score
    }

    const fuzzySourceRows = sourceRows
      .filter((row) => searchName && rankSmartPickerOption(row.productName, searchName, searchTokens).matched)
      .sort((a, b) => mismatchScore(a) - mismatchScore(b) || availableFor(b) - availableFor(a))

    const similarSourceRows = (sameProductRows.length ? sameProductRows : fuzzySourceRows)
      .filter((row) => !exactSourceRows.some((exact) => exact.id === row.id))
      .sort((a, b) => mismatchScore(a) - mismatchScore(b) || availableFor(b) - availableFor(a))
      .slice(0, 6)

    const fuzzyCatalogProducts = (catalogData?.products || [])
      .filter((product) => product.isActive && !sameProduct(product.name, productName))
      .filter((product) => searchName && rankSmartPickerOption(product.name, searchName, searchTokens).matched)
      .slice(0, 5)

    if (source === 'workshop') {
      if (exactCatalogVariants.length || canonicalFactsKnown) {
        return {
          tone: 'success',
          label: exactCatalogVariants.length ? 'Товар распознан' : 'Товар и характеристики распознаны',
          note: exactCatalogVariants.length
            ? 'Для цеха остаток не проверяется. Позиция уже известна каталогу.'
            : 'Такой комбинации ещё могло не быть в каталоге. Все значения известны системе, поэтому отдельная проверка администратора не нужна.',
          rows: exactCatalogVariants.slice(0, 4).map((variant) => ({
            key: `catalog-exact-${variant.id}`,
            title: [variant.productName, variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel].filter(Boolean).join(' · '),
            quantity: null as number | null,
          })),
          canObservePhysical: false,
          currentPhysical: 0,
          currentReserved: 0,
        }
      }
      if (catalogProduct && unknownFacts.length) {
        return {
          tone: 'warning',
          label: 'Есть новое значение характеристики',
          note: `Администратору нужно будет проверить только: ${unknownFacts.join(', ')}. Остальные известные характеристики не требуют отдельного разбора.`,
          rows: catalogVariants.slice(0, 5).map((variant) => ({
            key: `catalog-similar-${variant.id}`,
            title: [variant.productName, variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel].filter(Boolean).join(' · '),
            quantity: null as number | null,
          })),
          canObservePhysical: false,
          currentPhysical: 0,
          currentReserved: 0,
        }
      }
      return {
        tone: fuzzyCatalogProducts.length ? 'warning' : 'muted',
        label: fuzzyCatalogProducts.length ? 'Похоже на товар из каталога' : 'Новый товар',
        note: fuzzyCatalogProducts.length
          ? 'Проверьте название. Если это действительно другое название, администратор разберёт только сам новый товар.'
          : 'Заказ в цех сохранить можно. Администратор увидит эту позицию только потому, что такого товара ещё нет в каталоге.',
        rows: fuzzyCatalogProducts.map((product) => ({ key: `catalog-product-${product.id}`, title: product.name, quantity: null as number | null })),
        canObservePhysical: false,
        currentPhysical: 0,
        currentReserved: 0,
      }
    }

    if (exactSourceRows.length) {
      const { physical, reserved, available } = stockSummary(exactSourceRows)
      const shortageForOrder = Math.max(0, requiredQuantity - available)
      const needsAttention = physical < 0 || shortageForOrder > 0
      return {
        tone: needsAttention ? 'danger' : 'success',
        label: physical < 0
          ? 'Остаток нужно уточнить'
          : shortageForOrder > 0
            ? `Для заказа не хватает ${shortageForOrder} шт.`
            : `Хватает для заказа · свободно ${available} шт.`,
        note: physical < 0
          ? `По учёту в «${sourceTitle}» на месте получилось ${physical} шт. Если товар перед вами, подтвердите реальное количество ниже.`
          : shortageForOrder > 0
            ? `Для этого заказа нужно ${requiredQuantity} шт., а свободно ${available} шт. Если товар находится перед вами, уточните фактическое количество — это сразу исправит физический остаток перед резервом.`
            : `Для заказа нужно ${requiredQuantity} шт. · в «${sourceTitle}» на месте ${physical} шт. · уже в заказах ${reserved} шт. · свободно ${available} шт.`,
        summaryDetail: physical < 0 ? `По учёту на месте ${physical} шт.` : `Нужно ${requiredQuantity} · свободно ${available}`,
        needsAttention,
        rows: exactSourceRows.slice(0, 4).map((row) => ({
          key: `source-exact-${row.id}`,
          title: [row.productName, row.gender, row.color, row.material, row.length, row.size].filter(Boolean).join(' · '),
          quantity: availableFor(row),
          detail: `На месте ${physicalFor(row)} · в заказах ${reservedFor(row)} · свободно ${availableFor(row)}`,
        })),
        canObservePhysical: canonicalIdentityKnown,
        currentPhysical: physical,
        currentReserved: reserved,
      }
    }

    if (canonicalIdentityKnown) {
      const rows = exactCatalogVariants.length
        ? exactCatalogVariants.slice(0, 4).map((variant) => ({
          key: `catalog-only-${variant.id}`,
          title: [variant.productName, variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel].filter(Boolean).join(' · '),
          quantity: null as number | null,
        }))
        : similarSourceRows.slice(0, 4).map((row) => ({
          key: `source-similar-${row.id}`,
          title: [row.productName, row.gender, row.color, row.material, row.length, row.size].filter(Boolean).join(' · '),
          quantity: availableFor(row),
          detail: `На месте ${physicalFor(row)} · в заказах ${reservedFor(row)} · свободно ${availableFor(row)}`,
        }))
      return {
        tone: 'danger',
        label: exactCatalogVariants.length ? `Для заказа не хватает ${requiredQuantity} шт.` : 'Остаток этой комбинации ещё не зафиксирован',
        note: exactCatalogVariants.length
          ? `В каталоге такой вариант есть, но в «${sourceTitle}» по учёту свободно 0. Для заказа нужно ${requiredQuantity} шт. Если товар перед вами, уточните фактическое количество.`
          : `Все значения известны системе и новая комбинация создастся автоматически, но её физический остаток ещё не зафиксирован. Если товар перед вами, укажите реальное количество перед сохранением заказа.`,
        rows,
        canObservePhysical: true,
        currentPhysical: 0,
        currentReserved: 0,
        needsAttention: true,
      }
    }

    if (catalogProduct && unknownFacts.length) {
      const rows = similarSourceRows.length
        ? similarSourceRows.map((row) => ({
          key: `source-similar-${row.id}`,
          title: [row.productName, row.gender, row.color, row.material, row.length, row.size].filter(Boolean).join(' · '),
          quantity: availableFor(row),
          detail: `На месте ${physicalFor(row)} · в заказах ${reservedFor(row)} · свободно ${availableFor(row)}`,
        }))
        : catalogVariants.slice(0, 6).map((variant) => ({
          key: `catalog-similar-${variant.id}`,
          title: [variant.productName, variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel].filter(Boolean).join(' · '),
          quantity: null as number | null,
        }))
      return {
        tone: 'warning',
        label: 'Есть неизвестная характеристика',
        note: `Администратору нужно будет проверить только: ${unknownFacts.join(', ')}. Пока значение не подтверждено, менеджер не может этой формой менять физический остаток.`,
        rows,
        canObservePhysical: false,
        currentPhysical: 0,
        currentReserved: 0,
      }
    }

    return {
      tone: fuzzySourceRows.length || fuzzyCatalogProducts.length ? 'warning' : 'muted',
      label: fuzzySourceRows.length || fuzzyCatalogProducts.length ? 'Похоже на другой товар' : 'Товар пока не распознан',
      note: fuzzySourceRows.length || fuzzyCatalogProducts.length
        ? 'Проверьте похожее название. Если это действительно новый товар, заказ сохранится, а администратор проверит только его название.'
        : 'Заказ можно сохранить. Эта позиция попадёт администратору на разбор только потому, что такого товара ещё нет в каталоге.',
      rows: [
        ...fuzzySourceRows.slice(0, 5).map((row) => ({
          key: `source-fuzzy-${row.id}`,
          title: [row.productName, row.gender, row.color, row.material, row.length, row.size].filter(Boolean).join(' · '),
          quantity: availableFor(row) as number | null,
          detail: `На месте ${physicalFor(row)} · в заказах ${reservedFor(row)} · свободно ${availableFor(row)}`,
        })),
        ...fuzzyCatalogProducts.map((product) => ({ key: `catalog-fuzzy-${product.id}`, title: product.name, quantity: null as number | null })),
      ].slice(0, 6),
      canObservePhysical: false,
      currentPhysical: 0,
      currentReserved: 0,
    }
  }

  function renderOrderSourceAvailability(item: EditorItem, keyPrefix: string, itemIndex?: number, mode: 'create' | 'edit' = 'create') {
    const itemIdentityKey = (value: EditorItem) => {
      const resolvedProduct = resolveClientCatalogProduct(value.productName)
      const category = normalizeAudienceTypeValue(value.audienceType) === 'ДЕТСКИЙ' ? 'child' : 'adult'
      return [
        value.sourceType || 'warehouse',
        resolvedProduct?.id ? `product:${resolvedProduct.id}` : `raw:${canonicalCatalogProductKey(value.productName)}`,
        normalizeAudienceTypeValue(value.audienceType),
        canonicalOrderGender(value.gender),
        canonicalOrderColor(value.color),
        canonicalOrderMaterial(value.material),
        canonicalOrderLength(value.length),
        canonicalOrderSize(value.size, category),
      ].join('¦')
    }
    const targetDraft = mode === 'edit' ? editorDraft : createDraft
    const requiredInOrder = itemIndex === undefined || !targetDraft
      ? Math.max(1, Number(item.quantity || 1))
      : targetDraft.items
        .filter((candidate) => candidate.sourceType !== 'workshop' && itemIdentityKey(candidate) === itemIdentityKey(item))
        .reduce((sum, candidate) => sum + Math.max(1, Number(candidate.quantity || 1)), 0)
    const serverShortage = item.serverShortage
    const localAvailability = getOrderSourceAvailability(item, Math.max(1, requiredInOrder))
    if (mode === 'edit' && !serverShortage) return null
    const availability = localAvailability || (serverShortage ? {
      tone: 'danger',
      label: 'Нужно уточнить остаток',
      note: 'Сервер обнаружил нехватку по свежим данным.',
      rows: [],
      canObservePhysical: true,
      currentPhysical: serverShortage.physicalQuantity,
      currentReserved: serverShortage.reservedQuantity,
    } : null)
    if (!availability) return null
    const observationEnabled = Boolean(item.stockObservationEnabled)
    const observedPhysical = item.observedPhysicalQuantity
    const shortageAcknowledged = Boolean(item.shortageAcknowledged)
    const needsShortageDecision = Boolean(serverShortage) || Boolean('needsAttention' in availability && availability.needsAttention)
    const canEditObservation = Boolean(itemIndex !== undefined && (availability.canObservePhysical || serverShortage))
    const effectiveReserved = serverShortage ? Math.max(0, Number(serverShortage.reservedQuantity || 0)) : Math.max(0, Number(availability.currentReserved || 0))
    const effectiveRequested = serverShortage ? Math.max(1, Number(serverShortage.requestedQuantity || 1)) : Math.max(1, requiredInOrder)
    const reservedAfterOrder = effectiveReserved + effectiveRequested
    const updateMatchingStockDecision = (patch: Partial<EditorItem>) => {
      if (itemIndex === undefined) return
      const identity = itemIdentityKey(item)
      if (mode === 'edit') {
        setEditorDraft((current) => current ? ({
          ...current,
          items: current.items.map((currentItem) => currentItem.sourceType !== 'workshop' && itemIdentityKey(currentItem) === identity
            ? { ...currentItem, ...patch }
            : currentItem),
        }) : current)
        return
      }
      setCreateDraft((current) => ({
        ...current,
        items: current.items.map((currentItem) => currentItem.sourceType !== 'workshop' && itemIdentityKey(currentItem) === identity
          ? { ...currentItem, ...patch }
          : currentItem),
      }))
    }
    const observedFreeAfter = observedPhysical === null || observedPhysical === undefined
      ? null
      : Number(observedPhysical) - reservedAfterOrder
    return (
      <details className={`order-source-availability is-${serverShortage ? 'danger' : availability.tone}${needsShortageDecision ? ' needs-attention' : ''}`} key={`${keyPrefix}-availability`} open={observationEnabled || needsShortageDecision || undefined}>
        <summary>
          <span className="order-source-availability-dot" aria-hidden="true" />
          <span>{serverShortage ? `По свежим данным не хватает ${serverShortage.shortage} шт.` : availability.label}</span>
          <small>{serverShortage ? `Нужно ${serverShortage.requestedQuantity} · на месте ${serverShortage.physicalQuantity} · в заказах ${serverShortage.reservedQuantity}` : ('summaryDetail' in availability && availability.summaryDetail ? String(availability.summaryDetail) : 'Проверить')}</small>
        </summary>
        <div className="order-source-availability-body">
          <p>{serverShortage ? `Сервер перечитал актуальный остаток перед сохранением: на месте ${serverShortage.physicalQuantity} шт., уже зарезервировано ${serverShortage.reservedQuantity} шт., этому заказу нужно ${serverShortage.requestedQuantity} шт.` : availability.note}</p>
          {availability.rows.length ? (
            <div className="order-source-availability-list">
              {availability.rows.map((row) => (
                <div key={row.key}>
                  <span>{row.title || 'Без характеристик'}{'detail' in row && row.detail ? <small>{String(row.detail)}</small> : null}</span>
                  {row.quantity === null ? <small>каталог</small> : <strong>{row.quantity} шт.</strong>}
                </div>
              ))}
            </div>
          ) : null}
          {canEditObservation ? (
            <div className={`order-stock-observation${observationEnabled ? ' is-open' : ''}${shortageAcknowledged ? ' is-deferred' : ''}`}>
              {needsShortageDecision && !observationEnabled && !shortageAcknowledged ? (
                <div className="order-stock-shortage-choice">
                  <strong>Что вы знаете прямо сейчас?</strong>
                  <span>Если товар перед вами — посчитайте всё физическое количество. Если проверить сейчас нельзя, заказ всё равно можно сохранить.</span>
                  <div>
                    <button
                      type="button"
                      className="primary compact"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        updateMatchingStockDecision({ stockObservationEnabled: true, observedPhysicalQuantity: null, shortageAcknowledged: false })
                      }}
                    >
                      Посчитать сейчас
                    </button>
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        updateMatchingStockDecision({ stockObservationEnabled: false, observedPhysicalQuantity: null, shortageAcknowledged: true })
                      }}
                    >
                      Сейчас проверить не могу
                    </button>
                  </div>
                </div>
              ) : shortageAcknowledged && !observationEnabled ? (
                <div className="order-stock-shortage-deferred">
                  <div>
                    <strong>Проверку отложили</strong>
                    <span>Заказ сохранится. Нехватка останется видна в разделе «Склад → Внимание», пока кто-нибудь не сверит фактическое количество или ситуация не изменится.</span>
                  </div>
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={(event) => {
                      event.preventDefault()
                      updateMatchingStockDecision({ stockObservationEnabled: true, observedPhysicalQuantity: null, shortageAcknowledged: false })
                    }}
                  >
                    Посчитать сейчас
                  </button>
                </div>
              ) : !observationEnabled ? (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    updateMatchingStockDecision({ stockObservationEnabled: true, observedPhysicalQuantity: null, shortageAcknowledged: false })
                  }}
                >
                  Сверить количество
                </button>
              ) : (
                <>
                  <div className="order-stock-observation-head">
                    <div>
                      <strong>Сколько сейчас физически на месте?</strong>
                      <span>Считайте всё в этой точке, включая уже отложенные заказы. Существующие резервы система не переписывает.</span>
                    </div>
                    {needsShortageDecision ? (
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={(event) => {
                          event.preventDefault()
                          updateMatchingStockDecision({ stockObservationEnabled: false, observedPhysicalQuantity: null, shortageAcknowledged: true })
                        }}
                      >
                        Сейчас проверить не могу
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={(event) => {
                          event.preventDefault()
                          updateMatchingStockDecision({ stockObservationEnabled: false, observedPhysicalQuantity: null, shortageAcknowledged: false })
                        }}
                      >
                        Отмена
                      </button>
                    )}
                  </div>
                  <div className="order-stock-observation-row">
                    <label>
                      <span>На месте сейчас</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={observedPhysical ?? ''}
                        onChange={(event) => {
                          const raw = event.target.value
                          updateMatchingStockDecision({ observedPhysicalQuantity: raw === '' ? null : Math.max(0, Math.trunc(Number(raw) || 0)), shortageAcknowledged: false })
                        }}
                        placeholder="Например: 5"
                      />
                    </label>
                    <div className="order-stock-observation-result">
                      <span>Сейчас в заказах: <strong>{effectiveReserved}</strong></span>
                      <span>После этого заказа: <strong>{reservedAfterOrder}</strong></span>
                      {observedFreeAfter === null ? <span>Введите число, которое видите физически.</span> : observedFreeAfter < 0 ? <strong className="is-shortage">После резерва не хватит {Math.abs(observedFreeAfter)} шт.</strong> : <strong>После резерва свободно {observedFreeAfter} шт.</strong>}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </details>
    )
  }

  const inventoryMatrixProductVariants = useMemo(() => inventoryMatrix.productId ? variantsForProduct(inventoryMatrix.productId) : [], [activeCatalogVariants, inventoryMatrix.productId])
  const inventoryMatrixMatchingVariants = useMemo(() => inventoryMatrixProductVariants.filter((variant) => (
    getCatalogVariantCategory(variant) === inventoryMatrix.category
    && String(variant.gender || '') === inventoryMatrix.gender
    && String(variant.material || '') === inventoryMatrix.material
    && String(variant.length || '') === inventoryMatrix.length
  )), [inventoryMatrixProductVariants, inventoryMatrix.category, inventoryMatrix.gender, inventoryMatrix.material, inventoryMatrix.length])
  const inventoryMatrixMatchingStockRows = useMemo(() => inventoryOperationSourceRows.filter((row) => (
    (inventoryMatrix.productId ? String(row.productId || '') === inventoryMatrix.productId : normalizeSuggestion(row.productName) === normalizeSuggestion(inventoryMatrix.productName))
    && getInventoryRowCategory(row) === inventoryMatrix.category
    && String(row.gender || '') === inventoryMatrix.gender
    && String(row.material || '') === inventoryMatrix.material
    && String(row.length || '') === inventoryMatrix.length
  )), [inventoryOperationSourceRows, inventoryMatrix])
  const inventoryMatrixBaseRows = inventoryDraft.movementType === 'manual_set' ? inventoryMatrixMatchingStockRows : inventoryMatrixMatchingVariants
  const inventoryMatrixColors = useMemo(() => {
    const base = inventoryMatrixBaseRows.map((row) => 'sizeLabel' in row ? String(row.color || '') : String(row.color || ''))
    return Array.from(new Set([...base, ...inventoryMatrix.extraColors])).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [inventoryMatrixBaseRows, inventoryMatrix.extraColors])
  const inventoryMatrixSizes = useMemo(() => {
    const base = inventoryMatrixBaseRows.map((row) => 'sizeLabel' in row ? String(row.sizeLabel || '') : String(row.size || ''))
    return sortSizeLikeValues(Array.from(new Set([...base, ...inventoryMatrix.extraSizes])))
  }, [inventoryMatrixBaseRows, inventoryMatrix.extraSizes])
  const inventoryMatrixCellMap = useMemo(() => {
    const map = new Map<string, { variantId: number; current: number; color: string; size: string }>()
    if (inventoryDraft.movementType === 'manual_set') {
      for (const row of inventoryMatrixMatchingStockRows) map.set(inventoryMatrixCellKey(row.size, row.color), { variantId: Number(row.variantId || 0), current: Number(row.quantity || 0), color: row.color || '', size: row.size || '' })
    } else {
      for (const variant of inventoryMatrixMatchingVariants) map.set(inventoryMatrixCellKey(variant.sizeLabel, variant.color), { variantId: Number(variant.id || 0), current: Number(getStockQuantityForVariant(inventoryDraft.source, variant.id) || 0), color: variant.color || '', size: variant.sizeLabel || '' })
    }
    return map
  }, [inventoryDraft.movementType, inventoryDraft.source, inventoryMatrixMatchingStockRows, inventoryMatrixMatchingVariants, inventoryData])
  return {
    applyCreateProductPick,
    applyEditorProductPick,
    applyExchangeProductPick,
    arrivalSuggestionValues,
    filteredReferenceItems,
    getOrderSourceAvailability,
    getSizeOptions,
    inventoryMatrixCellMap,
    inventoryMatrixColors,
    inventoryMatrixSizes,
    orderPanelStyle,
    pageTitle,
    referenceStats,
    renderOrderSourceAvailability,
    sectorStyle,
    selectedReferenceKindConfig,
    suggestionValues,
  }
}
