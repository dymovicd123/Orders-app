import type { InventoryRenderContext } from './types'
import { renderInventoryCatalogPanel as renderLegacyInventoryCatalogPanel } from './catalogLegacyAdminModes'
import { CatalogPolishExecutionGroups, pluralRu } from './catalogPolishExecutionGroups'

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
  | 'openSimpleStockHistory'
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
> & { isAdmin?: boolean }


const W6_NEW_PRODUCT = '__w6_new_product'
const W6_EDIT_PRODUCT = '__w6_edit_product'
const W6_VARIANT_EDITOR = '__w6_variant_editor'

const normalizedText = (value: unknown) => String(value || '').trim()
const normalizedKey = (value: unknown) => normalizedText(value).toUpperCase() || 'СТАНДАРТ'
const isStandardValue = (value: unknown) => normalizedKey(value) === 'СТАНДАРТ'

const productGenderScope = (product: any): 'female' | 'male' | 'unisex' => ['female', 'male', 'unisex'].includes(String(product?.genderScope || '')) ? product.genderScope : 'unisex'
const fixedGenderForProduct = (product: any) => productGenderScope(product) === 'female' ? 'ЖЕН' : productGenderScope(product) === 'male' ? 'МУЖ' : ''
const productGenderScopeLabel = (product: any) => productGenderScope(product) === 'female' ? 'Женский' : productGenderScope(product) === 'male' ? 'Мужской' : 'Унисекс'

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

const blankVariant = (productId: number, category: string, product?: any) => ({
  id: 0,
  productId: productId ? String(productId) : '',
  category: category === 'child' ? 'child' : 'adult',
  gender: fixedGenderForProduct(product),
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
    isAdmin = true,
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
    setCatalogProductDraft({ id: product.id, name: product.name, category, genderScope: productGenderScope(product) })
    setCatalogVariantDraft(blankVariant(Number(product.id), catalogCategoryFilter === 'child' ? 'child' : category, product))
  }

  const openNewProduct = () => {
    const category = catalogCategoryFilter === 'child' ? 'child' : 'adult'
    setExpandedCatalogProducts({ [W6_NEW_PRODUCT]: true })
    setCatalogProductDraft({ id: 0, name: '', category, genderScope: '' })
    setCatalogVariantDraft(blankVariant(0, category))
  }

  const openProductEditor = (product: any) => {
    const category = getCatalogProductEffectiveCategory(product)
    setExpandedCatalogProducts({ [String(product.id)]: true, [W6_EDIT_PRODUCT]: true })
    setCatalogProductDraft({ id: product.id, name: product.name, category, genderScope: productGenderScope(product) })
    setCatalogVariantDraft(blankVariant(Number(product.id), category, product))
  }

  const openNewVariant = (product: any) => {
    const category = catalogCategoryFilter === 'child' ? 'child' : getCatalogProductEffectiveCategory(product)
    setExpandedCatalogProducts({ [String(product.id)]: true, [W6_VARIANT_EDITOR]: true })
    setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product), genderScope: productGenderScope(product) })
    setCatalogVariantDraft(blankVariant(Number(product.id), category, product))
  }

  const focusCatalogEditor = () => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const editor = document.getElementById('catalog-variant-editor')
      editor?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      ;(editor as HTMLElement | null)?.focus({ preventScroll: true })
    }))
  }

  const openVariantEditor = (product: any, variant: any) => {
    setExpandedCatalogProducts({ [String(product.id)]: true, [W6_VARIANT_EDITOR]: true })
    setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product), genderScope: productGenderScope(product) })
    setCatalogVariantDraft({
      id: variant.id,
      productId: String(variant.productId),
      category: getCatalogVariantCategory(variant),
      gender: variant.gender || fixedGenderForProduct(product),
      color: variant.color,
      material: variant.material || 'СТАНДАРТ',
      length: variant.length || 'СТАНДАРТ',
      sizeLabel: variant.sizeLabel,
      sortOrder: String(variant.sortOrder),
    })
    focusCatalogEditor()
  }

  const closeEditor = () => {
    const returnVariantId = Number(catalogVariantDraft.id || 0)
    if (!selectedProduct) {
      setExpandedCatalogProducts({})
      return
    }
    setExpandedCatalogProducts({ [String(selectedProduct.id)]: true })
    setCatalogProductDraft({ id: selectedProduct.id, name: selectedProduct.name, category: getCatalogProductEffectiveCategory(selectedProduct), genderScope: productGenderScope(selectedProduct) })
    setCatalogVariantDraft(blankVariant(Number(selectedProduct.id), getCatalogProductEffectiveCategory(selectedProduct), selectedProduct))
    if (returnVariantId) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const source = document.querySelector(`.catalog-size-tile[data-variant-id="${returnVariantId}"]`) as HTMLElement | null
        source?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        source?.focus({ preventScroll: true })
      }))
    }
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
    if (!variants.length) return 'Позиции ещё не добавлены'
    const adult = variants.filter((variant: any) => getCatalogVariantCategory(variant) === 'adult').length
    const child = variants.filter((variant: any) => getCatalogVariantCategory(variant) === 'child').length
    if (adult && child) return `${adult} взрослых · ${child} детских`
    if (child) return `${child} детских ${pluralRu(child, 'позиция', 'позиции', 'позиций')}`
    return `${variants.length} ${pluralRu(variants.length, 'позиция', 'позиции', 'позиций')}`
  }

  return (
    <div className="inventory-catalog-panel w6-catalog-panel" id="catalog" style={inventoryPanelStyle('catalog')}>
      <div className="inventory-panel-headline w6-catalog-headline catalog-clean-headline">
        <div>
          <h3>Товары</h3>
          <p>Каталог, цвета, размеры и другие характеристики.</p>
        </div>
        <div className="w6-catalog-head-actions">
          <button className="secondary compact" type="button" onClick={() => void loadCatalogData(true)}>Обновить</button>
        </div>
      </div>

      <div className="catalog-clean-taskbar" aria-label="Задачи и настройки каталога">
        <div className="catalog-clean-taskbar-main">
          {(catalogReview?.count || 0) > 0 || (inventoryLifecycle?.count || 0) > 0 ? <span className="catalog-clean-taskbar-label">Требуют разбора</span> : null}
          {(catalogReview?.count || 0) > 0 ? (
            <button type="button" className="catalog-clean-task" onClick={() => { setCatalogAdminMode('review'); setCatalogReviewTaskIndex(0); void loadCatalogReview(true) }}>
              Уточнить в заказах <b>{catalogReview.count}</b>
            </button>
          ) : null}
          {(inventoryLifecycle?.count || 0) > 0 ? (
            <button type="button" className="catalog-clean-task" onClick={() => { setCatalogAdminMode('lifecycle'); setInventoryLifecycleTaskIndex(0); void loadInventoryLifecycle(true) }}>
              Подтвердить движение <b>{inventoryLifecycle.count}</b>
            </button>
          ) : null}
        </div>
        <button type="button" className="catalog-clean-settings" onClick={() => { setCatalogAdminMode('attributes'); const productKinds = ['colors', 'materials', 'lengths', 'sizes', 'childAges']; if (!productKinds.includes(referenceKind)) selectReferenceKind('colors'); else void loadReferenceItems(referenceKind, !referenceItems.length) }}>Характеристики</button>
      </div>

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
          <span><b>{activeVariantCount}</b> {pluralRu(activeVariantCount, 'позиция', 'позиции', 'позиций')}</span>
          {catalogIssueStats.productsWithoutVariants > 0 ? (
            <button type="button" className={`w6-catalog-issue-filter ${catalogOnlyWithoutVariants ? 'is-active' : ''}`} onClick={() => { setCatalogCategoryFilter('all'); setCatalogOnlyWithoutVariants(true); setInventoryQuery('') }}>
              <b>{catalogIssueStats.productsWithoutVariants}</b> без позиций
            </button>
          ) : <span className="is-ok">✓ все товары с позициями</span>}
        </div>
      </div>

      {catalogOnlyWithoutVariants ? (
        <div className="w6-catalog-filter-note" role="status">
          <span>Показаны товары, для которых ещё не добавлены складские позиции.</span>
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
                  <span className="catalog-detail-eyebrow">Новый товар</span>
                  <h3>Новый товар</h3>
                  <p>Задайте базовое название и назначение по полу. Для женского/мужского товара пол дальше подставляется автоматически; у унисекс человек выбирает пол конкретной вещи.</p>
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
                <label>
                  <span>Назначение по полу</span>
                  <select value={catalogProductDraft.id ? '' : (catalogProductDraft.genderScope || '')} onChange={(event) => setCatalogProductDraft((current: any) => ({ ...current, id: 0, genderScope: event.target.value }))}>
                    <option value="">Выберите</option>
                    <option value="female">Женский</option>
                    <option value="male">Мужской</option>
                    <option value="unisex">Унисекс</option>
                  </select>
                  <small>Для унисекс пол конкретной вещи выбирается при добавлении позиции.</small>
                </label>
                <button className="primary" type="button" disabled={!catalogProductDraft.genderScope} onClick={() => void saveCatalogProduct()}>Добавить товар</button>
              </div>
            </div>
          ) : selectedProduct ? (
            <>
              <header className="catalog-detail-head">
                <div className="catalog-detail-title">
                  <span className="catalog-detail-eyebrow">Товар</span>
                  <h2>{selectedProduct.name}</h2>
                  <div className="catalog-detail-meta catalog-product-commercial-anchor">
                    <span><b>{selectedVariants.length}</b> {pluralRu(selectedVariants.length, 'позиция', 'позиции', 'позиций')}</span>
                    <span><b>{selectedExecutionCount}</b> {pluralRu(selectedExecutionCount, 'исполнение', 'исполнения', 'исполнений')}</span>
                    {visibleSelectedVariants.length !== selectedVariants.length ? <span className="is-filtered"><b>{visibleSelectedVariants.length}</b> показано</span> : null}
                    {selectedAdultCount && selectedChildCount ? <span>{selectedAdultCount} взрослых · {selectedChildCount} детских</span> : selectedChildCount ? <span>Детский товар</span> : <span>Взрослый товар</span>}
                    <span>Пол: <b>{productGenderScopeLabel(selectedProduct)}</b></span>
                  </div>
                  {selectedProductHiddenByFilter ? <span className="catalog-filter-context-note">Редактируемый товар скрыт текущим поиском или фильтром. Контекст сохранён до закрытия редактора.</span> : null}
                </div>
                <div className="catalog-detail-actions">
                  <button className="secondary compact" type="button" onClick={() => { setInventoryQuery(selectedProduct.name); ctx.openInventoryPanel('overview') }}>Найти в остатках</button>
                  <button className="secondary compact" type="button" onClick={() => openProductEditor(selectedProduct)}>Редактировать товар</button>
                  <button className="primary compact" type="button" disabled={!stocktakeReferenceReady} title={!stocktakeReferenceReady ? 'Сначала загружаются справочники характеристик' : undefined} onClick={() => openNewVariant(selectedProduct)}>+ Позиция</button>
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
                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: event.target.value, category: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(selectedProduct), genderScope: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.genderScope : productGenderScope(selectedProduct) })}
                      />
                    </label>
                    <label>
                      <span>Тип по умолчанию</span>
                      <select
                        value={catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(selectedProduct)}
                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.name : selectedProduct.name, category: event.target.value === 'child' ? 'child' : 'adult', genderScope: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.genderScope : productGenderScope(selectedProduct) })}
                      >
                        <option value="adult">Взрослый</option>
                        <option value="child">Детский</option>
                      </select>
                    </label>
                    <label>
                      <span>Назначение по полу</span>
                      <select value={catalogProductDraft.id === selectedProduct.id ? (catalogProductDraft.genderScope || productGenderScope(selectedProduct)) : productGenderScope(selectedProduct)} onChange={(event) => setCatalogProductDraft((current: any) => ({ ...current, id: selectedProduct.id, name: current.id === selectedProduct.id ? current.name : selectedProduct.name, category: current.id === selectedProduct.id ? current.category : getCatalogProductEffectiveCategory(selectedProduct), genderScope: event.target.value }))}>
                        <option value="female">Женский</option><option value="male">Мужской</option><option value="unisex">Унисекс</option>
                      </select>
                    </label>
                    <button className="primary compact" type="button" onClick={() => void saveCatalogProduct()}>Сохранить товар</button>
                  </div>
                </section>
              ) : null}

              <CatalogPolishExecutionGroups
                executionGroups={executionGroups}
                selectedVariants={selectedVariants}
                selectedProduct={selectedProduct}
                getStockQuantityForVariant={getStockQuantityForVariant}
                getCatalogVariantCategory={getCatalogVariantCategory}
                productCategoryLabel={productCategoryLabel}
                catalogVariantDraft={catalogVariantDraft}
                showVariantEditor={showVariantEditor}
                openVariantEditor={openVariantEditor}
                stocktakeReferenceReady={stocktakeReferenceReady}
                openNewVariant={openNewVariant}
                isAdmin={isAdmin}
                loadCatalogData={loadCatalogData}
                openVariantHistory={ctx.openSimpleStockHistory}
              />

              {showVariantEditor ? (
                <section id="catalog-variant-editor" tabIndex={-1} className="catalog-detail-editor catalog-variant-editor-v2 w6-variant-editor catalog-clean-editor">
                  <div className="catalog-detail-editor-head">
                    <div>
                      <span className="catalog-detail-eyebrow">{catalogVariantDraft.id ? 'Исправление позиции' : 'Новая позиция'}</span>
                      <h3>{catalogVariantDraft.id ? 'Исправить позицию' : 'Добавить позицию'}</h3>
                      <p>{catalogVariantDraft.id ? 'Исправляйте только ошибочно указанную характеристику. Если это другая вещь, создайте новую позицию.' : 'Выберите характеристики новой позиции. Для обычного материала или длины можно оставить «Основной».'}</p>
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
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? (catalogVariantDraft.gender || fixedGenderForProduct(selectedProduct)) : fixedGenderForProduct(selectedProduct)} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), gender: event.target.value }))}>
                        {!fixedGenderForProduct(selectedProduct) ? <option value="">Выберите для унисекс</option> : null}
                        <option value="МУЖ">МУЖ</option>
                        <option value="ЖЕН">ЖЕН</option>
                      </select>
                      <small>{fixedGenderForProduct(selectedProduct) ? 'Подставлено по товару. Если каталог ошибся, пол этой комбинации можно изменить.' : 'Унисекс: выберите пол этой конкретной комбинации.'}</small>
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
                        <option value="СТАНДАРТ">Основной</option>
                        {catalogVariantDraft.material && catalogVariantDraft.material !== 'СТАНДАРТ' && !suggestionValues.materials.includes(catalogVariantDraft.material) ? <option value={catalogVariantDraft.material}>{catalogVariantDraft.material}</option> : null}
                        {suggestionValues.materials.filter((value: string) => value !== 'СТАНДАРТ').map((value: string) => <option key={`w6-material-${value}`} value={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Длина</span>
                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.length : 'СТАНДАРТ'} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), length: event.target.value }))}>
                        <option value="СТАНДАРТ">Основной</option>
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
                      {catalogVariantDraft.id && catalogVariantDraft.productId === String(selectedProduct.id) ? 'Сохранить исправление' : 'Добавить позицию'}
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="catalog-detail-empty">
              <strong>Выберите товар</strong>
              <p>Выберите товар слева, чтобы увидеть цвета, размеры и остатки.</p>
              <button className="primary compact" type="button" onClick={openNewProduct}>+ Новый товар</button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
