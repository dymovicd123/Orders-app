import type { InventoryRenderContext } from './types'
import { renderInventoryCatalogPanel as renderLegacyInventoryCatalogPanel } from './catalogLegacyAdminModes'

type PanelContext = Pick<InventoryRenderContext,
  | 'catalogActiveProducts'
  | 'catalogAdminMode'
  | 'catalogCategoryFilter'
  | 'catalogData'
  | 'catalogIssueStats'
  | 'catalogOnlyWithoutVariants'
  | 'catalogProductDraft'
  | 'catalogReview'
  | 'catalogReviewActiveGroup'
  | 'catalogReviewActiveItem'
  | 'catalogReviewBlockingFields'
  | 'catalogReviewBusy'
  | 'catalogReviewContext'
  | 'catalogReviewContextBusy'
  | 'catalogReviewCreateFields'
  | 'catalogReviewCreateProduct'
  | 'catalogReviewFacts'
  | 'catalogReviewGroups'
  | 'catalogReviewIssue'
  | 'catalogReviewNewProductName'
  | 'catalogReviewTaskIndex'
  | 'catalogVariantDraft'
  | 'catalogVariantsByProductId'
  | 'excludeCurrentCatalogReviewItem'
  | 'expandedCatalogProducts'
  | 'getCatalogProductEffectiveCategory'
  | 'getCatalogVariantCategory'
  | 'getStockQuantityForVariant'
  | 'inventoryLifecycle'
  | 'inventoryLifecycleActiveItem'
  | 'inventoryLifecycleBlockingFields'
  | 'inventoryLifecycleBusy'
  | 'inventoryLifecycleContext'
  | 'inventoryLifecycleContextBusy'
  | 'inventoryLifecycleCreateFields'
  | 'inventoryLifecycleCreateProduct'
  | 'inventoryLifecycleFacts'
  | 'inventoryLifecycleGenderNeedsChoice'
  | 'inventoryLifecycleItems'
  | 'inventoryLifecycleNewProductName'
  | 'inventoryLifecycleTaskIndex'
  | 'inventoryPanelStyle'
  | 'inventoryProductReferenceGroups'
  | 'inventoryQuery'
  | 'lifecycleFactsMatchExactVariant'
  | 'lifecycleOptionsWithCurrent'
  | 'lifecycleValueNeedsCreation'
  | 'loadCatalogData'
  | 'loadCatalogReview'
  | 'loadInventoryLifecycle'
  | 'loadReferenceItems'
  | 'normalizeSuggestion'
  | 'openInventoryPanel'
  | 'openOrderFromFinance'
  | 'productCategoryLabel'
  | 'reconcileCatalogReview'
  | 'referenceItems'
  | 'referenceKind'
  | 'renderInventoryReferenceManager'
  | 'reviewFieldUnknown'
  | 'reviewOptionsWithCurrent'
  | 'reviewValueNeedsCreation'
  | 'saveCatalogProduct'
  | 'saveCatalogVariant'
  | 'selectReferenceKind'
  | 'selectedCatalogProduct'
  | 'setCatalogAdminMode'
  | 'setCatalogCategoryFilter'
  | 'setCatalogOnlyWithoutVariants'
  | 'setCatalogProductDraft'
  | 'setCatalogReviewCreateFields'
  | 'setCatalogReviewCreateProduct'
  | 'setCatalogReviewFacts'
  | 'setCatalogReviewNewProductName'
  | 'setCatalogReviewTaskIndex'
  | 'setCatalogVariantDraft'
  | 'setExpandedCatalogProducts'
  | 'setInventoryLifecycleCreateFields'
  | 'setInventoryLifecycleCreateProduct'
  | 'setInventoryLifecycleFacts'
  | 'setInventoryLifecycleNewProductName'
  | 'setInventoryLifecycleTaskIndex'
  | 'setInventoryQuery'
  | 'sourceLabel'
  | 'stocktakeReferenceReady'
  | 'submitCatalogReviewFacts'
  | 'submitInventoryLifecycleFacts'
  | 'suggestionValues'
  | 'visibleCatalogProducts'
>


const W6_NEW_PRODUCT = '__w6_new_product'
const W6_EDIT_PRODUCT = '__w6_edit_product'
const W6_VARIANT_EDITOR = '__w6_variant_editor'

const normalizedText = (value: unknown) => String(value || '').trim()
const normalizedKey = (value: unknown) => normalizedText(value).toUpperCase() || 'СТАНДАРТ'
const isStandardValue = (value: unknown) => normalizedKey(value) === 'СТАНДАРТ'

const executionKey = (material: unknown, length: unknown) => `${normalizedKey(material)}¦${normalizedKey(length)}`

const executionLabel = (material: unknown, length: unknown) => {
  const materialText = normalizedText(material) || 'СТАНДАРТ'
  const lengthText = normalizedText(length) || 'СТАНДАРТ'
  const materialStandard = isStandardValue(materialText)
  const lengthStandard = isStandardValue(lengthText)

  if (materialStandard && lengthStandard) return 'Основное исполнение'
  if (!materialStandard && lengthStandard) return materialText
  if (materialStandard && !lengthStandard) return `Длина: ${lengthText}`
  return `${materialText} · ${lengthText}`
}

const blankVariant = (productId: number, category: string) => ({
  id: 0,
  productId: productId ? String(productId) : '',
  category: category === 'child' ? 'child' : 'adult',
  gender: '',
  color: '',
  material: 'СТАНДАРТ',
  length: 'СТАНДАРТ',
  sizeLabel: '',
  sortOrder: '0',
})

export function renderInventoryCatalogPanel(ctx: PanelContext) {
  if (ctx.catalogAdminMode !== 'catalog') return renderLegacyInventoryCatalogPanel(ctx as any)

  const {
    catalogActiveProducts,
    catalogCategoryFilter,
    catalogData,
    catalogIssueStats,
    catalogOnlyWithoutVariants,
    catalogProductDraft,
    catalogReview,
    catalogVariantDraft,
    catalogVariantsByProductId,
    expandedCatalogProducts,
    getCatalogProductEffectiveCategory,
    getCatalogVariantCategory,
    getStockQuantityForVariant,
    inventoryLifecycle,
    inventoryPanelStyle,
    loadCatalogData,
    loadCatalogReview,
    loadInventoryLifecycle,
    loadReferenceItems,
    productCategoryLabel,
    referenceItems,
    referenceKind,
    saveCatalogProduct,
    saveCatalogVariant,
    selectReferenceKind,
    setCatalogAdminMode,
    setCatalogCategoryFilter,
    setCatalogOnlyWithoutVariants,
    setCatalogProductDraft,
    setCatalogReviewTaskIndex,
    setCatalogVariantDraft,
    setExpandedCatalogProducts,
    setInventoryLifecycleTaskIndex,
    setInventoryQuery,
    stocktakeReferenceReady,
    suggestionValues,
  } = ctx

  const query = normalizedText(ctx.inventoryQuery).toLocaleLowerCase('ru')
  const activeProducts = (catalogActiveProducts || []).filter((product: any) => product?.isActive !== false)

  const activeVariantsFor = (productId: number) => [...(catalogVariantsByProductId?.get?.(Number(productId)) || [])]
    .filter((variant: any) => variant?.isActive !== false)

  const pluralRu = (value: number, one: string, few: string, many: string) => {
    const absolute = Math.abs(value)
    const lastTwo = absolute % 100
    const last = absolute % 10
    if (lastTwo >= 11 && lastTwo <= 19) return many
    if (last === 1) return one
    if (last >= 2 && last <= 4) return few
    return many
  }

  const variantMatchesCategory = (variant: any) => catalogCategoryFilter === 'all' || getCatalogVariantCategory(variant) === catalogCategoryFilter

  const variantMatchesQuery = (variant: any) => {
    if (!query) return true
    return [
      productCategoryLabel(getCatalogVariantCategory(variant)),
      variant.gender,
      variant.color,
      variant.material,
      variant.length,
      variant.sizeLabel,
    ].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query)
  }

  const colorGroupsFor = (variants: any[]) => {
    const groups = new Map<string, any>()
    for (const variant of variants) {
      const colorLabel = normalizedText(variant.color) || 'Цвет не указан'
      const colorKey = normalizedKey(colorLabel)
      if (!groups.has(colorKey)) groups.set(colorKey, { key: colorKey, label: colorLabel, variants: [], subgroupMap: new Map<string, any>() })
      const colorGroup = groups.get(colorKey)!
      colorGroup.variants.push(variant)
      const category = getCatalogVariantCategory(variant)
      const gender = normalizedText(variant.gender) || 'Пол не указан'
      const subgroupKey = `${category}¦${normalizedKey(gender)}`
      if (!colorGroup.subgroupMap.has(subgroupKey)) colorGroup.subgroupMap.set(subgroupKey, { key: subgroupKey, category, gender, variants: [] })
      colorGroup.subgroupMap.get(subgroupKey)!.variants.push(variant)
    }

    return Array.from(groups.values()).map((group: any) => ({
      ...group,
      subgroups: Array.from(group.subgroupMap.values()).map((subgroup: any) => ({
        ...subgroup,
        variants: [...subgroup.variants].sort((a: any, b: any) => normalizedText(a.sizeLabel).localeCompare(normalizedText(b.sizeLabel), 'ru', { numeric: true })),
      })).sort((a: any, b: any) => a.category.localeCompare(b.category) || a.gender.localeCompare(b.gender, 'ru')),
    })).sort((a: any, b: any) => a.label.localeCompare(b.label, 'ru', { numeric: true }))
  }

  const executionHumanSummary = (variants: any[]) => {
    const colors = new Set(variants.map((variant: any) => normalizedText(variant.color) || 'Цвет не указан'))
    const sizes = Array.from(new Set(variants.map((variant: any) => normalizedText(variant.sizeLabel)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    const colorText = `${colors.size} ${pluralRu(colors.size, 'цвет', 'цвета', 'цветов')}`
    if (!sizes.length) return colorText
    const categories = new Set(variants.map((variant: any) => getCatalogVariantCategory(variant)))
    if (categories.size === 1 && categories.has('child')) {
      return sizes.length === 1 ? `${colorText} · возраст ${sizes[0]}` : `${colorText} · возраст ${sizes[0]}–${sizes[sizes.length - 1]}`
    }
    if (categories.size === 1) {
      return sizes.length === 1 ? `${colorText} · размер ${sizes[0]}` : `${colorText} · размеры ${sizes[0]}–${sizes[sizes.length - 1]}`
    }
    return `${colorText} · ${sizes.length} ${pluralRu(sizes.length, 'значение размера/возраста', 'значения размера/возраста', 'значений размера/возраста')}`
  }

  const browseProducts = activeProducts.filter((product: any) => {
    const variants = activeVariantsFor(Number(product.id))

    if (catalogOnlyWithoutVariants && variants.length) return false

    if (catalogCategoryFilter === 'adult' || catalogCategoryFilter === 'child') {
      if (variants.length) {
        if (!variants.some((variant: any) => getCatalogVariantCategory(variant) === catalogCategoryFilter)) return false
      } else if (getCatalogProductEffectiveCategory(product) !== catalogCategoryFilter) {
        return false
      }
    }

    if (!query) return true

    const productText = normalizedText(product.name).toLocaleLowerCase('ru')
    if (productText.includes(query)) return true

    return variants.some(variantMatchesQuery)
  })

  const selectedNumericKey = Object.keys(expandedCatalogProducts || {}).find((key) => /^\d+$/.test(key) && expandedCatalogProducts[key]) || ''
  const selectedNumericId = Number(selectedNumericKey || 0)
  const showNewProduct = Boolean(expandedCatalogProducts?.[W6_NEW_PRODUCT])
  const showEditProduct = Boolean(expandedCatalogProducts?.[W6_EDIT_PRODUCT])
  const showVariantEditor = Boolean(expandedCatalogProducts?.[W6_VARIANT_EDITOR])
  const editingSelectedProduct = Boolean(showEditProduct || showVariantEditor)
  const explicitSelectedProduct = browseProducts.find((product: any) => Number(product.id) === selectedNumericId) || null
  const explicitSelectedProductAny = activeProducts.find((product: any) => Number(product.id) === selectedNumericId) || null
  const selectedProduct = editingSelectedProduct && explicitSelectedProductAny ? explicitSelectedProductAny : explicitSelectedProduct || browseProducts[0] || null
  const selectedProductHiddenByFilter = Boolean(selectedProduct && !browseProducts.some((product: any) => Number(product.id) === Number(selectedProduct.id)))
  const hasExplicitDetail = Boolean(explicitSelectedProduct || (editingSelectedProduct && explicitSelectedProductAny))

  const selectProduct = (product: any) => {
    const category = getCatalogProductEffectiveCategory(product)
    setExpandedCatalogProducts({ [String(product.id)]: true })
    setCatalogProductDraft({ id: product.id, name: product.name, category })
    setCatalogVariantDraft(blankVariant(Number(product.id), catalogCategoryFilter === 'child' ? 'child' : category))
  }

  const openNewProduct = () => {
    const category = catalogCategoryFilter === 'child' ? 'child' : 'adult'
    setExpandedCatalogProducts({ [W6_NEW_PRODUCT]: true })
    setCatalogProductDraft({ id: 0, name: '', category })
    setCatalogVariantDraft(blankVariant(0, category))
  }

  const openProductEditor = (product: any) => {
    const category = getCatalogProductEffectiveCategory(product)
    setExpandedCatalogProducts({ [String(product.id)]: true, [W6_EDIT_PRODUCT]: true })
    setCatalogProductDraft({ id: product.id, name: product.name, category })
    setCatalogVariantDraft(blankVariant(Number(product.id), category))
  }

  const openNewVariant = (product: any) => {
    const category = catalogCategoryFilter === 'child' ? 'child' : getCatalogProductEffectiveCategory(product)
    setExpandedCatalogProducts({ [String(product.id)]: true, [W6_VARIANT_EDITOR]: true })
    setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product) })
    setCatalogVariantDraft(blankVariant(Number(product.id), category))
  }

  const openVariantEditor = (product: any, variant: any) => {
    setExpandedCatalogProducts({ [String(product.id)]: true, [W6_VARIANT_EDITOR]: true })
    setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product) })
    setCatalogVariantDraft({
      id: variant.id,
      productId: String(variant.productId),
      category: getCatalogVariantCategory(variant),
      gender: variant.gender,
      color: variant.color,
      material: variant.material || 'СТАНДАРТ',
      length: variant.length || 'СТАНДАРТ',
      sizeLabel: variant.sizeLabel,
      sortOrder: String(variant.sortOrder),
    })
  }

  const closeEditor = () => {
    if (!selectedProduct) {
      setExpandedCatalogProducts({})
      return
    }
    setExpandedCatalogProducts({ [String(selectedProduct.id)]: true })
    setCatalogProductDraft({ id: selectedProduct.id, name: selectedProduct.name, category: getCatalogProductEffectiveCategory(selectedProduct) })
    setCatalogVariantDraft(blankVariant(Number(selectedProduct.id), getCatalogProductEffectiveCategory(selectedProduct)))
  }

  const selectedVariants = selectedProduct
    ? activeVariantsFor(Number(selectedProduct.id)).sort((a: any, b: any) => {
      const executionDiff = executionLabel(a.material, a.length).localeCompare(executionLabel(b.material, b.length), 'ru', { numeric: true })
      const categoryDiff = getCatalogVariantCategory(a).localeCompare(getCatalogVariantCategory(b))
      const detailDiff = [a.color, a.gender, a.sizeLabel].join(' ').localeCompare([b.color, b.gender, b.sizeLabel].join(' '), 'ru', { numeric: true })
      return executionDiff || categoryDiff || detailDiff
    })
    : []

  const selectedProductNameMatchesQuery = Boolean(query && selectedProduct && normalizedText(selectedProduct.name).toLocaleLowerCase('ru').includes(query))
  const visibleSelectedVariants = selectedVariants.filter((variant: any) => {
    if (!variantMatchesCategory(variant)) return false
    if (!query || selectedProductNameMatchesQuery) return true
    return variantMatchesQuery(variant)
  })

  const executionGroups = (() => {
    const groups = new Map<string, { key: string; label: string; material: string; length: string; variants: any[] }>()
    for (const variant of visibleSelectedVariants) {
      const key = executionKey(variant.material, variant.length)
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: executionLabel(variant.material, variant.length),
          material: normalizedText(variant.material) || 'СТАНДАРТ',
          length: normalizedText(variant.length) || 'СТАНДАРТ',
          variants: [],
        })
      }
      groups.get(key)!.variants.push(variant)
    }
    return Array.from(groups.values()).sort((a, b) => {
      const aDefault = a.label === 'Основное исполнение' ? 0 : 1
      const bDefault = b.label === 'Основное исполнение' ? 0 : 1
      return aDefault - bDefault || a.label.localeCompare(b.label, 'ru', { numeric: true })
    })
  })()

  const selectedExecutionCount = new Set(selectedVariants.map((variant: any) => executionKey(variant.material, variant.length))).size
  const selectedAdultCount = selectedVariants.filter((variant: any) => getCatalogVariantCategory(variant) === 'adult').length
  const selectedChildCount = selectedVariants.filter((variant: any) => getCatalogVariantCategory(variant) === 'child').length
  const activeProductCount = (catalogData?.products || []).filter((product: any) => product.isActive).length
  const activeVariantCount = (catalogData?.variants || []).filter((variant: any) => variant.isActive).length

  const productListSummary = (product: any) => {
    const variants = activeVariantsFor(Number(product.id))
    if (!variants.length) return 'Нет вариантов'
    const adult = variants.filter((variant: any) => getCatalogVariantCategory(variant) === 'adult').length
    const child = variants.filter((variant: any) => getCatalogVariantCategory(variant) === 'child').length
    if (adult && child) return `${adult} взрослых · ${child} детских`
    if (child) return `${child} детских ${pluralRu(child, 'вариант', 'варианта', 'вариантов')}`
    return `${variants.length} ${pluralRu(variants.length, 'вариант', 'варианта', 'вариантов')}`
  }

  return (
    <div className="inventory-catalog-panel w6-catalog-panel" id="catalog" style={inventoryPanelStyle('catalog')}>
      <div className="inventory-panel-headline w6-catalog-headline">
        <div>
          <h3>Каталог</h3>
          <p>Товары и их реальные исполнения. Технические идентификаторы остаются внутри системы.</p>
        </div>
        <div className="w6-catalog-head-actions">
          <button className="secondary compact" type="button" onClick={() => void loadCatalogData(true)}>Обновить</button>
        </div>
      </div>

      <div className="inventory-products-subtabs human-catalog-subtabs" role="tablist" aria-label="Управление товарами">
        <button type="button" className="is-active" onClick={() => setCatalogAdminMode('catalog')}>Каталог товаров</button>
        <button type="button" className={(catalogReview?.count || 0) > 0 ? 'has-attention' : ''} onClick={() => { setCatalogAdminMode('review'); setCatalogReviewTaskIndex(0); void loadCatalogReview(true) }}>
          Уточнить товары{catalogReview && (catalogReview.count || 0) > 0 ? ` (${catalogReview.count})` : ''}
        </button>
        <button type="button" className={(inventoryLifecycle?.count || 0) > 0 ? 'has-attention' : ''} onClick={() => { setCatalogAdminMode('lifecycle'); setInventoryLifecycleTaskIndex(0); void loadInventoryLifecycle(true) }}>
          Ожидают движения{inventoryLifecycle && (inventoryLifecycle.count || 0) > 0 ? ` (${inventoryLifecycle.count})` : ''}
        </button>
        <button type="button" onClick={() => { setCatalogAdminMode('attributes'); const productKinds = ['colors', 'materials', 'lengths', 'sizes', 'childAges']; if (!productKinds.includes(referenceKind)) selectReferenceKind('colors'); else void loadReferenceItems(referenceKind, !referenceItems.length) }}>Характеристики одежды</button>
      </div>

      {(catalogReview?.count || 0) > 0 ? (
        <button className="catalog-review-callout w6-catalog-callout" type="button" onClick={() => { setCatalogAdminMode('review'); setCatalogReviewTaskIndex(0); void loadCatalogReview(true) }}>
          <span><b>{catalogReview.count}</b> {catalogReview.count === 1 ? 'позиция заказа требует уточнения товара' : 'позиций заказов требуют уточнения товара'}</span>
          <strong>Разобрать →</strong>
        </button>
      ) : null}

      {(inventoryLifecycle?.count || 0) > 0 ? (
        <button className="catalog-review-callout inventory-lifecycle-callout w6-catalog-callout" type="button" onClick={() => { setCatalogAdminMode('lifecycle'); setInventoryLifecycleTaskIndex(0); void loadInventoryLifecycle(true) }}>
          <span><b>{inventoryLifecycle.count}</b> {inventoryLifecycle.count === 1 ? 'физическая позиция ждёт подтверждения движения' : 'физических позиций ждут подтверждения движения'}</span>
          <strong>Проверить →</strong>
        </button>
      ) : null}

      <div className="w6-catalog-toolbar">
        <label className="w6-catalog-search">
          <span>Поиск</span>
          <input
            value={ctx.inventoryQuery || ''}
            onChange={(event) => setInventoryQuery(event.target.value)}
            placeholder="Название, цвет, материал, размер…"
          />
        </label>
        <div className="catalog-category-switcher w6-catalog-category-switcher">
          {([
            { value: 'all' as const, label: 'Все' },
            { value: 'adult' as const, label: 'Взрослые' },
            { value: 'child' as const, label: 'Детские' },
          ]).map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={catalogCategoryFilter === entry.value ? 'is-active' : ''}
              onClick={() => { setCatalogOnlyWithoutVariants(false); setCatalogCategoryFilter(entry.value) }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="w6-catalog-toolbar-actions">
          <button className="primary w6-toolbar-new-product" type="button" onClick={openNewProduct}>+ Новый товар</button>
        </div>
        <div className="w6-catalog-stats" aria-label="Сводка каталога">
          <span>Всего: <b>{activeProductCount}</b> {pluralRu(activeProductCount, 'товар', 'товара', 'товаров')}</span>
          <span><b>{activeVariantCount}</b> {pluralRu(activeVariantCount, 'вариант', 'варианта', 'вариантов')}</span>
          {catalogIssueStats.productsWithoutVariants > 0 ? (
            <button type="button" className={`w6-catalog-issue-filter ${catalogOnlyWithoutVariants ? 'is-active' : ''}`} onClick={() => { setCatalogCategoryFilter('all'); setCatalogOnlyWithoutVariants(true); setInventoryQuery('') }}>
              <b>{catalogIssueStats.productsWithoutVariants}</b> без вариантов
            </button>
          ) : <span className="is-ok">✓ все товары с вариантами</span>}
        </div>
      </div>

      {catalogOnlyWithoutVariants ? (
        <div className="w6-catalog-filter-note" role="status">
          <span>Показаны только товары без активных вариантов. Добавляйте вариант только если это реальная складская позиция.</span>
          <button className="ghost compact" type="button" onClick={() => setCatalogOnlyWithoutVariants(false)}>Показать весь каталог</button>
        </div>
      ) : null}

      <div className={`catalog-master-detail ${hasExplicitDetail ? 'has-explicit-selection' : ''} ${showNewProduct ? 'is-new-product' : ''}`}>
        <aside className="catalog-master-pane" aria-label="Список товаров">
          <div className="catalog-master-pane-head">
            <strong>{query ? 'Найдено ' : ''}{browseProducts.length} {pluralRu(browseProducts.length, 'товар', 'товара', 'товаров')}</strong>
            {query ? <span>по текущему поиску</span> : <span>в текущем фильтре</span>}
          </div>
          <div className="catalog-master-list">
            {browseProducts.length ? browseProducts.map((product: any) => {
              const isSelected = Number(selectedProduct?.id || 0) === Number(product.id) && !showNewProduct
              return (
                <button
                  key={`w6-product-${product.id}`}
                  type="button"
                  className={`catalog-master-row ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => selectProduct(product)}
                >
                  <span>
                    <strong>{product.name}</strong>
                    <em>{productListSummary(product)}</em>
                  </span>
                  <b aria-hidden="true">›</b>
                </button>
              )
            }) : (
              <div className="empty-state compact-empty">Ничего не найдено. Измените поиск или фильтр.</div>
            )}
          </div>
        </aside>

        <section className="catalog-detail-pane" aria-label="Карточка товара">
          <button className="catalog-detail-back secondary compact" type="button" onClick={() => setExpandedCatalogProducts({})}>← К товарам</button>

          {showNewProduct ? (
            <div className="catalog-detail-editor catalog-new-product-editor">
              <div className="catalog-detail-editor-head">
                <div>
                  <span className="catalog-detail-eyebrow">Master-data</span>
                  <h3>Новый товар</h3>
                  <p>Создайте только базовое название. Цвет, материал, длина, размер и пол добавляются как варианты.</p>
                </div>
                <button className="secondary compact" type="button" onClick={() => setExpandedCatalogProducts({})}>Отмена</button>
              </div>
              <div className="catalog-product-form catalog-product-form-v2 w6-new-product-form">
                <label className="wide-field">
                  <span>Базовое название</span>
                  <input
                    value={catalogProductDraft.id ? '' : catalogProductDraft.name}
                    onChange={(event) => setCatalogProductDraft((current: any) => ({ ...current, id: 0, name: event.target.value }))}
                    placeholder="Например: БАЙСАЛ ЖИЛЕТ"
                  />
                </label>
                <label>
                  <span>Тип по умолчанию</span>
                  <select
                    value={catalogProductDraft.id ? (catalogCategoryFilter === 'child' ? 'child' : 'adult') : catalogProductDraft.category}
                    onChange={(event) => setCatalogProductDraft((current: any) => ({ ...current, id: 0, category: event.target.value === 'child' ? 'child' : 'adult' }))}
                  >
                    <option value="adult">Взрослый</option>
                    <option value="child">Детский</option>
                  </select>
                </label>
                <button className="primary" type="button" onClick={() => void saveCatalogProduct()}>Добавить товар</button>
              </div>
            </div>
          ) : selectedProduct ? (
            <>
              <header className="catalog-detail-head">
                <div className="catalog-detail-title">
                  <span className="catalog-detail-eyebrow">Товар</span>
                  <h2>{selectedProduct.name}</h2>
                  <div className="catalog-detail-meta catalog-product-commercial-anchor">
                    <span><b>{selectedVariants.length}</b> {pluralRu(selectedVariants.length, 'вариант', 'варианта', 'вариантов')}</span>
                    <span><b>{selectedExecutionCount}</b> {pluralRu(selectedExecutionCount, 'исполнение', 'исполнения', 'исполнений')}</span>
                    {visibleSelectedVariants.length !== selectedVariants.length ? <span className="is-filtered"><b>{visibleSelectedVariants.length}</b> показано</span> : null}
                    {selectedAdultCount && selectedChildCount ? <span>{selectedAdultCount} взрослых · {selectedChildCount} детских</span> : selectedChildCount ? <span>Детский товар</span> : <span>Взрослый товар</span>}
                  </div>
                  {selectedProductHiddenByFilter ? <span className="catalog-filter-context-note">Редактируемый товар скрыт текущим поиском или фильтром. Контекст сохранён до закрытия редактора.</span> : null}
                </div>
                <div className="catalog-detail-actions">
                  <button className="secondary compact" type="button" onClick={() => { setInventoryQuery(selectedProduct.name); ctx.openInventoryPanel('overview') }}>Найти в остатках</button>
                  <button className="secondary compact" type="button" onClick={() => openProductEditor(selectedProduct)}>Редактировать товар</button>
                  <button className="primary compact" type="button" disabled={!stocktakeReferenceReady} title={!stocktakeReferenceReady ? 'Сначала загружаются справочники характеристик' : undefined} onClick={() => openNewVariant(selectedProduct)}>+ Вариант</button>
                </div>
              </header>

              {showEditProduct ? (
                <section className="catalog-detail-editor catalog-product-editor-inline">
                  <div className="catalog-detail-editor-head compact-head">
                    <div>
                      <span className="catalog-detail-eyebrow">Редактирование</span>
                      <h3>Основные данные товара</h3>
                    </div>
                    <button className="secondary compact" type="button" onClick={closeEditor}>Закрыть</button>
                  </div>
                  <div className="catalog-product-edit-strip w6-product-edit-strip">
                    <label className="wide-field">
                      <span>Название товара</span>
                      <input
                        value={catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.name : selectedProduct.name}
                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: event.target.value, category: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(selectedProduct) })}
                      />
                    </label>
                    <label>
                      <span>Тип по умолчанию</span>
                      <select
                        value={catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(selectedProduct)}
                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.name : selectedProduct.name, category: event.target.value === 'child' ? 'child' : 'adult' })}
                      >
                        <option value="adult">Взрослый</option>
                        <option value="child">Детский</option>
                      </select>
                    </label>
                    <button className="primary compact" type="button" onClick={() => void saveCatalogProduct()}>Сохранить товар</button>
                  </div>
                </section>
              ) : null}

              <div className="catalog-execution-list">
                {executionGroups.length ? executionGroups.map((group) => {
                  const groupPhysical = group.variants.reduce((sum, variant) => sum + (getStockQuantityForVariant('warehouse', variant.id) || 0) + (getStockQuantityForVariant('boutique', variant.id) || 0), 0)
                  const colorGroups = colorGroupsFor(group.variants)
                  return (
                    <section key={`execution-${group.key}`} className="catalog-execution-card">
                      <div className="catalog-execution-head">
                        <div>
                          <span className="catalog-detail-eyebrow">Исполнение</span>
                          <h3>{group.label}</h3>
                          <p>{group.label === 'Основное исполнение' ? `Базовое исполнение · ${executionHumanSummary(group.variants)}` : executionHumanSummary(group.variants)}</p>
                        </div>
                        <div className="catalog-execution-summary catalog-execution-commercial-anchor" data-execution-key={group.key}>
                          <strong>{groupPhysical}</strong>
                          <span>физически в точках</span>
                        </div>
                      </div>

                      <div className="catalog-color-list">
                        {colorGroups.map((colorGroup: any) => {
                          const colorPhysical = colorGroup.variants.reduce((sum: number, variant: any) => sum + (getStockQuantityForVariant('warehouse', variant.id) || 0) + (getStockQuantityForVariant('boutique', variant.id) || 0), 0)
                          const colorSizeCount = new Set(colorGroup.variants.map((variant: any) => normalizedText(variant.sizeLabel)).filter(Boolean)).size
                          return (
                            <section key={`color-${group.key}-${colorGroup.key}`} className="catalog-color-group">
                              <div className="catalog-color-head">
                                <div className="catalog-color-title">
                                  <strong>{colorGroup.label}</strong>
                                  <span>{colorSizeCount ? `${colorSizeCount} ${pluralRu(colorSizeCount, 'размер/возраст', 'размера/возраста', 'размеров/возрастов')}` : 'Без указанного размера/возраста'}</span>
                                </div>
                                <div className="catalog-color-total">
                                  <strong>{colorPhysical}</strong>
                                  <span>на месте</span>
                                </div>
                              </div>

                              <div className="catalog-color-subgroups">
                                {colorGroup.subgroups.map((subgroup: any) => (
                                  <div key={`subgroup-${group.key}-${colorGroup.key}-${subgroup.key}`} className="catalog-color-subgroup">
                                    <div className="catalog-color-subgroup-label">
                                      <strong>{subgroup.gender}</strong>
                                      <span>{productCategoryLabel(subgroup.category)} · {subgroup.category === 'child' ? 'возраст' : 'размер'}</span>
                                    </div>
                                    <div className="catalog-size-grid">
                                      {subgroup.variants.map((variant: any) => {
                                        const warehouseQty = getStockQuantityForVariant('warehouse', variant.id) || 0
                                        const boutiqueQty = getStockQuantityForVariant('boutique', variant.id) || 0
                                        const totalQty = warehouseQty + boutiqueQty
                                        const sizeLabel = normalizedText(variant.sizeLabel) || (subgroup.category === 'child' ? '— возраст' : '— размер')
                                        const selected = catalogVariantDraft.id === variant.id && showVariantEditor
                                        return (
                                          <button
                                            key={`w6-variant-${variant.id}`}
                                            type="button"
                                            className={`catalog-size-tile catalog-variant-commercial-anchor ${totalQty > 0 ? 'has-stock' : 'is-zero'} ${selected ? 'is-selected' : ''}`}
                                            data-variant-id={variant.id}
                                            title="Нажмите, чтобы изменить этот точный вариант"
                                            aria-label={`Редактировать ${colorGroup.label}, ${subgroup.category === 'child' ? 'возраст' : 'размер'} ${sizeLabel}, на месте ${totalQty}`}
                                            onClick={() => openVariantEditor(selectedProduct, variant)}
                                          >
                                            <span className="catalog-size-value">{sizeLabel}</span>
                                            <span className="catalog-size-stock">{totalQty} шт</span>
                                            <small>Склад {warehouseQty} · Бутик {boutiqueQty}</small>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                    </section>
                  )
                }) : (
                  <div className="catalog-detail-empty">
                    <strong>{selectedVariants.length ? 'Нет вариантов по текущему фильтру' : 'У товара пока нет вариантов'}</strong>
                    <p>{selectedVariants.length ? 'Измените поиск или фильтр, чтобы снова показать варианты этого товара.' : 'Создайте первый вариант только если это реальная комбинация характеристик, которая должна участвовать в заказах и остатках.'}</p>
                    {!selectedVariants.length ? <button className="primary compact" type="button" disabled={!stocktakeReferenceReady} onClick={() => openNewVariant(selectedProduct)}>+ Добавить первый вариант</button> : null}
                  </div>
                )}
              </div>

              {showVariantEditor ? (
                <section className="catalog-detail-editor catalog-variant-editor-v2 w6-variant-editor">
                  <div className="catalog-detail-editor-head">
                    <div>
                      <span className="catalog-detail-eyebrow">{catalogVariantDraft.id ? 'Редактирование варианта' : 'Новый вариант'}</span>
                      <h3>{catalogVariantDraft.id ? 'Изменить комбинацию' : 'Добавить комбинацию'}</h3>
                      <p>Техническое значение «СТАНДАРТ» допустимо в данных; в обычном просмотре оно показывается как «Основное исполнение».</p>
                    </div>
                    <button className="secondary compact" type="button" onClick={closeEditor}>Закрыть</button>
                  </div>
                  {!stocktakeReferenceReady ? <div className="catalog-reference-loading-note">Загружаю цвета, материалы, длины и размеры из справочников.</div> : null}
                  <div className="subgrid inventory-subgrid catalog-variant-form-grid w6-variant-form-grid">
                    <label>
                      <span>Тип</span>
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(selectedProduct)} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), category: event.target.value === 'child' ? 'child' : 'adult', sizeLabel: '' }))}>
                        <option value="adult">Взрослый</option>
                        <option value="child">Детский</option>
                      </select>
                    </label>
                    <label>
                      <span>Пол</span>
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.gender : ''} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), gender: event.target.value }))}>
                        <option value="">Не указан</option>
                        <option value="МУЖ">МУЖ</option>
                        <option value="ЖЕН">ЖЕН</option>
                      </select>
                    </label>
                    <label>
                      <span>Цвет</span>
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.color : ''} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), color: event.target.value }))}>
                        <option value="">Не указан</option>
                        {catalogVariantDraft.color && !suggestionValues.colors.includes(catalogVariantDraft.color) ? <option value={catalogVariantDraft.color}>{catalogVariantDraft.color}</option> : null}
                        {suggestionValues.colors.map((value: string) => <option key={`w6-color-${value}`} value={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Материал</span>
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.material : 'СТАНДАРТ'} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), material: event.target.value }))}>
                        <option value="СТАНДАРТ">СТАНДАРТ</option>
                        {catalogVariantDraft.material && catalogVariantDraft.material !== 'СТАНДАРТ' && !suggestionValues.materials.includes(catalogVariantDraft.material) ? <option value={catalogVariantDraft.material}>{catalogVariantDraft.material}</option> : null}
                        {suggestionValues.materials.filter((value: string) => value !== 'СТАНДАРТ').map((value: string) => <option key={`w6-material-${value}`} value={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Длина</span>
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.length : 'СТАНДАРТ'} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), length: event.target.value }))}>
                        <option value="СТАНДАРТ">СТАНДАРТ</option>
                        {catalogVariantDraft.length && catalogVariantDraft.length !== 'СТАНДАРТ' && !suggestionValues.lengths.includes(catalogVariantDraft.length) ? <option value={catalogVariantDraft.length}>{catalogVariantDraft.length}</option> : null}
                        {suggestionValues.lengths.filter((value: string) => value !== 'СТАНДАРТ').map((value: string) => <option key={`w6-length-${value}`} value={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>{(catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(selectedProduct)) === 'child' ? 'Возраст' : 'Размер'}</span>
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.sizeLabel : ''} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), sizeLabel: event.target.value }))}>
                        <option value="">Не указан</option>
                        {catalogVariantDraft.sizeLabel && !(((catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(selectedProduct)) === 'child' ? suggestionValues.childAges : suggestionValues.sizes).includes(catalogVariantDraft.sizeLabel)) ? <option value={catalogVariantDraft.sizeLabel}>{catalogVariantDraft.sizeLabel}</option> : null}
                        {((catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(selectedProduct)) === 'child' ? suggestionValues.childAges : suggestionValues.sizes).map((value: string) => <option key={`w6-size-${value}`} value={value}>{value}</option>)}
                      </select>
                    </label>
                    <button className="primary" type="button" disabled={!stocktakeReferenceReady} onClick={() => void saveCatalogVariant()}>
                      {catalogVariantDraft.id && catalogVariantDraft.productId === String(selectedProduct.id) ? 'Сохранить вариант' : 'Добавить вариант'}
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="catalog-detail-empty">
              <strong>Выберите товар</strong>
              <p>Слева находится компактный список каталога. Здесь появятся исполнения и варианты выбранного товара.</p>
              <button className="primary compact" type="button" onClick={openNewProduct}>+ Новый товар</button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
