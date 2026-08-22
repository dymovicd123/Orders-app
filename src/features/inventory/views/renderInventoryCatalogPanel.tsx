import type { InventoryRenderContext } from './types'

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


export function renderInventoryCatalogPanel(ctx: PanelContext) {
  const {
    catalogActiveProducts,
    catalogAdminMode,
    catalogCategoryFilter,
    catalogData,
    catalogIssueStats,
    catalogOnlyWithoutVariants,
    catalogProductDraft,
    catalogReview,
    catalogReviewActiveGroup,
    catalogReviewActiveItem,
    catalogReviewBlockingFields,
    catalogReviewBusy,
    catalogReviewContext,
    catalogReviewContextBusy,
    catalogReviewCreateFields,
    catalogReviewCreateProduct,
    catalogReviewFacts,
    catalogReviewGroups,
    catalogReviewIssue,
    catalogReviewNewProductName,
    catalogReviewTaskIndex,
    catalogVariantDraft,
    catalogVariantsByProductId,
    excludeCurrentCatalogReviewItem,
    expandedCatalogProducts,
    getCatalogProductEffectiveCategory,
    getCatalogVariantCategory,
    getStockQuantityForVariant,
    inventoryLifecycle,
    inventoryLifecycleActiveItem,
    inventoryLifecycleBlockingFields,
    inventoryLifecycleBusy,
    inventoryLifecycleContext,
    inventoryLifecycleContextBusy,
    inventoryLifecycleCreateFields,
    inventoryLifecycleCreateProduct,
    inventoryLifecycleFacts,
    inventoryLifecycleGenderNeedsChoice,
    inventoryLifecycleItems,
    inventoryLifecycleNewProductName,
    inventoryLifecycleTaskIndex,
    inventoryPanelStyle,
    inventoryProductReferenceGroups,
    lifecycleFactsMatchExactVariant,
    lifecycleOptionsWithCurrent,
    lifecycleValueNeedsCreation,
    loadCatalogData,
    loadCatalogReview,
    loadInventoryLifecycle,
    loadReferenceItems,
    normalizeSuggestion,
    openInventoryPanel,
    openOrderFromFinance,
    productCategoryLabel,
    reconcileCatalogReview,
    referenceItems,
    referenceKind,
    renderInventoryReferenceManager,
    reviewFieldUnknown,
    reviewOptionsWithCurrent,
    reviewValueNeedsCreation,
    saveCatalogProduct,
    saveCatalogVariant,
    selectReferenceKind,
    selectedCatalogProduct,
    setCatalogAdminMode,
    setCatalogCategoryFilter,
    setCatalogOnlyWithoutVariants,
    setCatalogProductDraft,
    setCatalogReviewCreateFields,
    setCatalogReviewCreateProduct,
    setCatalogReviewFacts,
    setCatalogReviewNewProductName,
    setCatalogReviewTaskIndex,
    setCatalogVariantDraft,
    setExpandedCatalogProducts,
    setInventoryLifecycleCreateFields,
    setInventoryLifecycleCreateProduct,
    setInventoryLifecycleFacts,
    setInventoryLifecycleNewProductName,
    setInventoryLifecycleTaskIndex,
    setInventoryQuery,
    sourceLabel,
    stocktakeReferenceReady,
    submitCatalogReviewFacts,
    submitInventoryLifecycleFacts,
    suggestionValues,
    visibleCatalogProducts
  } = ctx

  return (
    <div className="inventory-catalog-panel" id="catalog" style={inventoryPanelStyle('catalog')}>
                    <div className="inventory-panel-headline">
                      <div>
                        <h3>Товары</h3>
                        <p>Здесь администратор управляет каталогом и характеристиками одежды. Остатки склада и бутика остаются отдельными от каталога.</p>
                      </div>
                      <button className="secondary compact" type="button" onClick={() => {
                        if (catalogAdminMode === 'review') void loadCatalogReview(true)
                        else if (catalogAdminMode === 'lifecycle') void loadInventoryLifecycle(true)
                        else if (catalogAdminMode === 'catalog') void loadCatalogData(true)
                        else void loadReferenceItems(referenceKind, true)
                      }}>Обновить</button>
                    </div>
    
                    <div className="inventory-products-subtabs human-catalog-subtabs" role="tablist" aria-label="Управление товарами">
                      <button type="button" className={catalogAdminMode === 'catalog' ? 'is-active' : ''} onClick={() => setCatalogAdminMode('catalog')}>Каталог товаров</button>
                      <button type="button" className={`${catalogAdminMode === 'review' ? 'is-active' : ''} ${(catalogReview?.count || 0) > 0 ? 'has-attention' : ''}`} onClick={() => { setCatalogAdminMode('review'); setCatalogReviewTaskIndex(0); void loadCatalogReview(true) }}>
                        Требуют разбора{catalogReview && (catalogReview.count || 0) > 0 ? ` (${catalogReview.count})` : ''}
                      </button>
                      <button type="button" className={`${catalogAdminMode === 'lifecycle' ? 'is-active' : ''} ${(inventoryLifecycle?.count || 0) > 0 ? 'has-attention' : ''}`} onClick={() => { setCatalogAdminMode('lifecycle'); setInventoryLifecycleTaskIndex(0); void loadInventoryLifecycle(true) }}>
                        Ожидают движения{inventoryLifecycle && (inventoryLifecycle.count || 0) > 0 ? ` (${inventoryLifecycle.count})` : ''}
                      </button>
                      <button type="button" className={catalogAdminMode === 'attributes' ? 'is-active' : ''} onClick={() => { setCatalogAdminMode('attributes'); const productKinds = ['colors', 'materials', 'lengths', 'sizes', 'childAges']; if (!productKinds.includes(referenceKind)) selectReferenceKind('colors'); else void loadReferenceItems(referenceKind, !referenceItems.length) }}>Характеристики одежды</button>
                    </div>
    
                    {(catalogReview?.count || 0) > 0 && catalogAdminMode !== 'review' ? (
                      <button className="catalog-review-callout" type="button" onClick={() => { setCatalogAdminMode('review'); setCatalogReviewTaskIndex(0); void loadCatalogReview(true) }}>
                        <span><b>{catalogReview.count}</b> {catalogReview.count === 1 ? 'позиция заказа не распознана каталогом' : 'позиций заказов не распознаны каталогом'}</span>
                        <strong>Разобрать →</strong>
                      </button>
                    ) : null}
    
                    {(inventoryLifecycle?.count || 0) > 0 && catalogAdminMode !== 'lifecycle' ? (
                      <button className="catalog-review-callout inventory-lifecycle-callout" type="button" onClick={() => { setCatalogAdminMode('lifecycle'); setInventoryLifecycleTaskIndex(0); void loadInventoryLifecycle(true) }}>
                        <span><b>{inventoryLifecycle.count}</b> {inventoryLifecycle.count === 1 ? 'физическая позиция ждёт подтверждения перед движением остатка' : 'физических позиций ждут подтверждения перед движением остатка'}</span>
                        <strong>Проверить →</strong>
                      </button>
                    ) : null}
    
                    {catalogAdminMode === 'catalog' ? (<>
                    <div className="human-catalog-summary">
                      <div><strong>{(catalogData?.products || []).filter((product) => product.isActive).length}</strong><span>товаров в каталоге</span></div>
                      <div><strong>{(catalogData?.variants || []).filter((variant) => variant.isActive).length}</strong><span>вариантов</span></div>
                      {catalogIssueStats.productsWithoutVariants > 0 ? <button type="button" className={catalogOnlyWithoutVariants ? 'is-active' : ''} onClick={() => { setCatalogCategoryFilter('all'); setCatalogOnlyWithoutVariants(true); setInventoryQuery('') }}><strong>{catalogIssueStats.productsWithoutVariants}</strong><span>товаров без вариантов — проверить</span></button> : <div className="is-ok"><strong>✓</strong><span>у всех товаров есть варианты</span></div>}
                    </div>
        
                    <div className="catalog-category-switcher">
                      <span>Категория каталога:</span>
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
        
                    {catalogOnlyWithoutVariants ? (
                      <div className="catalog-review-callout" role="status">
                        <span><b>{catalogIssueStats.productsWithoutVariants}</b> активных товаров пока без вариантов. Это не ошибка само по себе: добавьте варианты только тем товарам, которые реально используются как обычные складские позиции.</span>
                        <button className="ghost compact" type="button" onClick={() => setCatalogOnlyWithoutVariants(false)}>Показать весь каталог</button>
                      </div>
                    ) : null}
    
                    <div className="catalog-workspace catalog-workspace-v2">
                      <section className="mini-panel catalog-new-product-panel">
                        <div className="mini-panel-head">
                          <div>
                            <h3>Новый товар</h3>
                            <p className="mini-panel-note">Добавляйте только базовое название товара. Цвет, материал, длина, размер и пол — это варианты внутри карточки.</p>
                          </div>
                          <button
                            className="secondary compact"
                            type="button"
                            onClick={() => {
                              setCatalogProductDraft({ id: 0, name: '', category: catalogCategoryFilter === 'child' ? 'child' : 'adult' })
                              setCatalogVariantDraft({ id: 0, productId: '', category: catalogCategoryFilter === 'child' ? 'child' : 'adult', gender: '', color: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', sizeLabel: '', sortOrder: '0' })
                            }}
                          >
                            Очистить
                          </button>
                        </div>
                        <div className="catalog-product-form catalog-product-form-v2">
                          <label className="wide-field">
                            <span>Базовое название</span>
                            <input
                              value={catalogProductDraft.id ? '' : catalogProductDraft.name}
                              onChange={(event) => setCatalogProductDraft((current) => ({ ...current, id: 0, name: event.target.value }))}
                              placeholder="Например: БАЙСАЛ ЖИЛЕТ"
                            />
                          </label>
                          <label>
                            <span>Тип по умолчанию</span>
                            <select
                              value={catalogProductDraft.id ? (catalogCategoryFilter === 'child' ? 'child' : 'adult') : catalogProductDraft.category}
                              onChange={(event) =>
                                setCatalogProductDraft((current) => ({
                                  ...current,
                                  id: 0,
                                  category: event.target.value === 'child' ? 'child' : 'adult',
                                }))
                              }
                            >
                              <option value="adult">Взрослый</option>
                              <option value="child">Детский</option>
                            </select>
                          </label>
                          <button className="primary compact" type="button" onClick={() => void saveCatalogProduct()}>
                            Добавить товар
                          </button>
                        </div>
                      </section>
        
                      <section className="catalog-accordion-list">
                        {visibleCatalogProducts.length ? visibleCatalogProducts.map((product) => {
                          const productKey = String(product.id)
                          const selected = selectedCatalogProduct?.id === product.id
                          const expanded = expandedCatalogProducts[productKey] ?? selected
                          const productVariants = [...(catalogVariantsByProductId.get(Number(product.id)) || [])]
                            .filter((variant) => variant.isActive)
                            .sort((a, b) => {
                              const categoryDiff = getCatalogVariantCategory(a).localeCompare(getCatalogVariantCategory(b))
                              return categoryDiff || [a.gender, a.color, a.material, a.length, a.sizeLabel].join(' ').localeCompare([b.gender, b.color, b.material, b.length, b.sizeLabel].join(' '), 'ru', { numeric: true })
                            })
                          const adultCount = productVariants.filter((variant) => getCatalogVariantCategory(variant) === 'adult').length
                          const childCount = productVariants.filter((variant) => getCatalogVariantCategory(variant) === 'child').length
                          return (
                            <article key={product.id} className={`catalog-product-accordion ${expanded ? 'is-open' : ''} ${product.isActive ? '' : 'is-muted'}`}>
                              <div className="catalog-product-accordion-head">
                                <button
                                  type="button"
                                  className="catalog-product-open-button"
                                  onClick={() => {
                                    const nextExpanded = !expanded
                                    setExpandedCatalogProducts((current) => ({ ...current, [productKey]: nextExpanded }))
                                    setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product) })
                                    setCatalogVariantDraft((current) => ({
                                      ...current,
                                      id: 0,
                                      productId: String(product.id),
                                      category: catalogCategoryFilter === 'child' ? 'child' : getCatalogProductEffectiveCategory(product),
                                      gender: '',
                                      color: '',
                                      material: 'СТАНДАРТ',
                                      length: 'СТАНДАРТ',
                                      sizeLabel: '',
                                      sortOrder: '0',
                                    }))
                                  }}
                                >
                                  <span className="catalog-product-title-block">
                                    <strong>{product.name}</strong>
                                    <em>{adultCount ? `Взрослые: ${adultCount}` : 'Взрослые: 0'} · {childCount ? `Детские: ${childCount}` : 'Детские: 0'} · всего вариантов: {productVariants.length}</em>
                                  </span>
                                  <span className="catalog-product-toggle">{expanded ? 'Свернуть' : 'Открыть'}</span>
                                </button>
                                <div className="catalog-product-actions-v2">
                                  <button className="secondary compact" type="button" onClick={() => { setInventoryQuery(product.name); openInventoryPanel('overview') }}>Найти в остатках</button>
                                  <button
                                    className="secondary compact"
                                    type="button"
                                    onClick={() => {
                                      setExpandedCatalogProducts((current) => ({ ...current, [productKey]: true }))
                                      setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product) })
                                      setCatalogVariantDraft({ id: 0, productId: String(product.id), category: catalogCategoryFilter === 'child' ? 'child' : getCatalogProductEffectiveCategory(product), gender: '', color: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', sizeLabel: '', sortOrder: '0' })
                                    }}
                                  >
                                    Редактировать
                                  </button>
                                  <button
                                    className="primary compact"
                                    type="button"
                                    disabled={!stocktakeReferenceReady}
                                    title={!stocktakeReferenceReady ? 'Сначала загружаются справочники характеристик' : undefined}
                                    onClick={() => {
                                      setExpandedCatalogProducts((current) => ({ ...current, [productKey]: true }))
                                      setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product) })
                                      setCatalogVariantDraft({ id: 0, productId: String(product.id), category: catalogCategoryFilter === 'child' ? 'child' : getCatalogProductEffectiveCategory(product), gender: '', color: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', sizeLabel: '', sortOrder: '0' })
                                    }}
                                  >
                                    + Вариант
                                  </button>
                                </div>
                              </div>
        
                              {expanded ? (
                                <div className="catalog-product-accordion-body">
                                  <div className="catalog-product-edit-strip">
                                    <label className="wide-field">
                                      <span>Название товара</span>
                                      <input
                                        value={catalogProductDraft.id === product.id ? catalogProductDraft.name : product.name}
                                        onChange={(event) => setCatalogProductDraft({ id: product.id, name: event.target.value, category: catalogProductDraft.id === product.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(product) })}
                                      />
                                    </label>
                                    <label>
                                      <span>Тип по умолчанию</span>
                                      <select
                                        value={catalogProductDraft.id === product.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(product)}
                                        onChange={(event) => setCatalogProductDraft({ id: product.id, name: catalogProductDraft.id === product.id ? catalogProductDraft.name : product.name, category: event.target.value === 'child' ? 'child' : 'adult' })}
                                      >
                                        <option value="adult">Взрослый</option>
                                        <option value="child">Детский</option>
                                      </select>
                                    </label>
                                    <button className="primary compact" type="button" onClick={() => void saveCatalogProduct()}>
                                      Сохранить товар
                                    </button>
                                  </div>
        
                                  <div className="catalog-variant-list-v2">
                                    <div className="catalog-variant-list-head">
                                      <span>Тип</span>
                                      <span>Пол</span>
                                      <span>Характеристики</span>
                                      <span>Размер / возраст</span>
                                      <span>На месте</span>
                                      <span>Действие</span>
                                    </div>
                                    {productVariants.length ? productVariants.map((variant) => {
                                      const warehouseQty = getStockQuantityForVariant('warehouse', variant.id) || 0
                                      const boutiqueQty = getStockQuantityForVariant('boutique', variant.id) || 0
                                      const totalQty = warehouseQty + boutiqueQty
                                      return (
                                        <div key={`catalog-v2-variant-${variant.id}`} className={`catalog-variant-row-v2 ${catalogVariantDraft.id === variant.id ? 'is-selected' : ''}`}>
                                          <span><b className={`category-inline-badge ${getCatalogVariantCategory(variant) === 'child' ? 'is-child' : 'is-adult'}`}>{productCategoryLabel(getCatalogVariantCategory(variant))}</b></span>
                                          <span>{variant.gender || '—'}</span>
                                          <span className="catalog-variant-characteristics">{[variant.color, variant.material, variant.length].filter(Boolean).join(' · ') || '—'}</span>
                                          <span><strong>{variant.sizeLabel || '—'}</strong></span>
                                          <span className="catalog-variant-stock-pill"><b>{totalQty}</b><em>Склад {warehouseQty} · Бутик {boutiqueQty} · без учёта резервов</em></span>
                                          <span>
                                            <button
                                              className="secondary compact"
                                              type="button"
                                              onClick={() => {
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
                                              }}
                                            >
                                              Править
                                            </button>
                                          </span>
                                        </div>
                                      )
                                    }) : (
                                      <div className="empty-state compact-empty">У товара нет активных вариантов. Добавьте первый вариант ниже.</div>
                                    )}
                                  </div>
        
                                  <div className="catalog-variant-editor catalog-variant-editor-v2">
                                    <div className="mini-panel-head compact-head">
                                      <div>
                                        <h3>{catalogVariantDraft.id && catalogVariantDraft.productId === String(product.id) ? 'Редактировать вариант' : 'Добавить вариант'}</h3>
                                        <p className="mini-panel-note">Вариант появится в заказах, приходе и остатках. Не добавляйте цвет или размер в название товара.</p>
                                      </div>
                                      <button className="secondary compact" type="button" disabled={!stocktakeReferenceReady} onClick={() => setCatalogVariantDraft({ id: 0, productId: String(product.id), category: catalogCategoryFilter === 'child' ? 'child' : getCatalogProductEffectiveCategory(product), gender: '', color: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', sizeLabel: '', sortOrder: '0' })}>
                                        Новый вариант
                                      </button>
                                    </div>
                                    {!stocktakeReferenceReady ? <div className="catalog-reference-loading-note">Загружаю цвета, материалы, длины и размеры из справочников. Добавление варианта будет доступно после загрузки.</div> : null}
                                    <div className="subgrid inventory-subgrid catalog-variant-form-grid catalog-variant-form-grid-v2">
                                      <label>
                                        <span>Тип</span>
                                        <select value={catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(product)} onChange={(event) => setCatalogVariantDraft((current) => ({ ...current, productId: String(product.id), category: event.target.value === 'child' ? 'child' : 'adult', sizeLabel: '' }))}>
                                          <option value="adult">Взрослый</option>
                                          <option value="child">Детский</option>
                                        </select>
                                      </label>
                                      <label>
                                        <span>Пол</span>
                                        <select value={catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.gender : ''} onChange={(event) => setCatalogVariantDraft((current) => ({ ...current, productId: String(product.id), gender: event.target.value }))}>
                                          <option value="">Не указан</option>
                                          <option value="МУЖ">МУЖ</option>
                                          <option value="ЖЕН">ЖЕН</option>
                                        </select>
                                      </label>
                                      <label><span>Цвет</span><select value={catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.color : ''} onChange={(event) => setCatalogVariantDraft((current) => ({ ...current, productId: String(product.id), color: event.target.value }))}><option value="">Не указан</option>{catalogVariantDraft.color && !suggestionValues.colors.includes(catalogVariantDraft.color) ? <option value={catalogVariantDraft.color}>{catalogVariantDraft.color}</option> : null}{suggestionValues.colors.map((value: string) => <option key={`catalog-color-${value}`} value={value}>{value}</option>)}</select></label>
                                      <label><span>Материал</span><select value={catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.material : 'СТАНДАРТ'} onChange={(event) => setCatalogVariantDraft((current) => ({ ...current, productId: String(product.id), material: event.target.value }))}><option value="СТАНДАРТ">СТАНДАРТ</option>{catalogVariantDraft.material && catalogVariantDraft.material !== 'СТАНДАРТ' && !suggestionValues.materials.includes(catalogVariantDraft.material) ? <option value={catalogVariantDraft.material}>{catalogVariantDraft.material}</option> : null}{suggestionValues.materials.filter((value: string) => value !== 'СТАНДАРТ').map((value: string) => <option key={`catalog-material-${value}`} value={value}>{value}</option>)}</select></label>
                                      <label><span>Длина</span><select value={catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.length : 'СТАНДАРТ'} onChange={(event) => setCatalogVariantDraft((current) => ({ ...current, productId: String(product.id), length: event.target.value }))}><option value="СТАНДАРТ">СТАНДАРТ</option>{catalogVariantDraft.length && catalogVariantDraft.length !== 'СТАНДАРТ' && !suggestionValues.lengths.includes(catalogVariantDraft.length) ? <option value={catalogVariantDraft.length}>{catalogVariantDraft.length}</option> : null}{suggestionValues.lengths.filter((value: string) => value !== 'СТАНДАРТ').map((value: string) => <option key={`catalog-length-${value}`} value={value}>{value}</option>)}</select></label>
                                      <label><span>{(catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(product)) === 'child' ? 'Возраст' : 'Размер'}</span><select value={catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.sizeLabel : ''} onChange={(event) => setCatalogVariantDraft((current) => ({ ...current, productId: String(product.id), sizeLabel: event.target.value }))}><option value="">Не указан</option>{catalogVariantDraft.sizeLabel && !(((catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(product)) === 'child' ? suggestionValues.childAges : suggestionValues.sizes).includes(catalogVariantDraft.sizeLabel)) ? <option value={catalogVariantDraft.sizeLabel}>{catalogVariantDraft.sizeLabel}</option> : null}{((catalogVariantDraft.productId === String(product.id) ? catalogVariantDraft.category : getCatalogProductEffectiveCategory(product)) === 'child' ? suggestionValues.childAges : suggestionValues.sizes).map((value: string) => <option key={`catalog-size-${value}`} value={value}>{value}</option>)}</select></label>
                                      <button className="primary" type="button" disabled={!stocktakeReferenceReady} onClick={() => void saveCatalogVariant()}>
                                        {catalogVariantDraft.id && catalogVariantDraft.productId === String(product.id) ? 'Сохранить вариант' : 'Добавить вариант'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </article>
                          )
                        }) : (
                          <div className="empty-state">Каталог товаров пока пуст или не найден по поиску.</div>
                        )}
                      </section>
                    </div>
                    </>) : catalogAdminMode === 'review' ? (
                      <div className="catalog-calm-review catalog-resolution-v2">
                        <div className="catalog-calm-review-head">
                          <div>
                            <span className="catalog-review-eyebrow">Только то, что нужно решить сейчас</span>
                            <h3>{catalogReview?.mode === 'order' ? `Разбор заказа ${catalogReview.items?.[0]?.externalId || ''}`.trim() : catalogReview?.count ? `Нужно разобрать: ${catalogReview.count}` : 'Разбор товаров'}</h3>
                            <p>{catalogReview?.mode === 'order' ? 'Показаны только неразобранные товары этого заказа. После решения можно вернуться к текущей очереди.' : 'Здесь только недавние позиции, которые действительно требуют решения для текущей работы.'}</p>
                          </div>
                          <div className="catalog-review-head-actions">
                            {catalogReview?.mode !== 'order' && (catalogReview?.count || 0) > 0 ? <button className="secondary compact" type="button" disabled={catalogReviewBusy} onClick={() => { setCatalogReviewTaskIndex(0); void reconcileCatalogReview(20) }}>{catalogReviewBusy ? 'Проверяю…' : 'Убрать очевидные автоматически'}</button> : null}
                            {catalogReview?.mode === 'order' ? <button className="secondary compact" type="button" disabled={catalogReviewBusy} onClick={() => { setCatalogReviewTaskIndex(0); void loadCatalogReview(true) }}>Вернуться к текущим задачам</button> : <button className="secondary compact" type="button" onClick={() => { setCatalogReviewTaskIndex(0); void loadCatalogReview(true) }}>{catalogReviewBusy ? 'Обновляю…' : 'Обновить'}</button>}
                          </div>
                        </div>
    
                        {(catalogReview as any)?.truncated ? <div className="catalog-review-controlled-note">Очередь большая: загружена первая часть. После решения задач нажмите «Обновить».</div> : null}
                        {catalogReviewBusy && !catalogReview ? <div className="empty-state">Загружаю список задач…</div> : null}
                        {!catalogReviewBusy && catalogReview && catalogReviewGroups.length === 0 ? <div className="catalog-review-empty"><strong>{catalogReview.mode === 'order' ? 'Этот заказ разобран' : 'Разбирать нечего'}</strong><p>{catalogReview.mode === 'order' ? 'Неразобранных товаров в этом заказе больше нет.' : 'Текущих исключений нет.'}</p></div> : null}
    
                        {catalogReviewActiveGroup && catalogReviewActiveItem ? <>
                          <div className="catalog-calm-progress"><span>Одна задача за раз</span><strong>{catalogReviewTaskIndex + 1} из {catalogReviewGroups.length} загруженных</strong></div>
                          <article className="catalog-calm-task catalog-resolution-task">
                            <div className="catalog-calm-task-input">
                              <span>Менеджер ввёл</span>
                              <h3>{catalogReviewActiveItem.productName || 'Без названия'}</h3>
                              <p>{[productCategoryLabel(catalogReviewActiveItem.category), catalogReviewActiveItem.gender, catalogReviewActiveItem.color, catalogReviewActiveItem.material, catalogReviewActiveItem.length, catalogReviewActiveItem.size].filter(Boolean).join(' · ') || 'Характеристики не указаны'}</p>
                            </div>
                            <div className="catalog-calm-orders"><span>Пример заказа:</span><div>{catalogReviewActiveGroup.items.slice(0, 1).map((entry: any) => <button key={`review-order-${entry.orderItemId}`} type="button" onClick={() => void openOrderFromFinance({ orderId: entry.orderId, externalId: entry.externalId, orderDate: entry.orderDate })}>{entry.externalId || `#${entry.orderId}`} →</button>)}{catalogReviewActiveGroup.affectedCount > 1 ? <span>Это решение затронет {catalogReviewActiveGroup.affectedCount} позиций заказов.</span> : null}</div></div>
    
                            {catalogReviewContextBusy ? <div className="catalog-resolution-loading">Определяю, что именно здесь неизвестно…</div> : catalogReviewContext?.error ? <div className="catalog-calm-warning"><strong>Не удалось определить причину</strong><span>{catalogReviewContext.error}</span></div> : catalogReviewContext ? <>
                              <div className={`catalog-resolution-issue issue-${catalogReviewContext.issueType || 'unknown'}`}><strong>{catalogReviewIssue.title}</strong><span>{catalogReviewIssue.text}</span></div>
    
                              <section className="catalog-resolution-form">
                                {catalogReviewContext.product?.id ? (
                                  <div className="catalog-resolution-known-product"><span>Базовый товар распознан</span><strong>{catalogReviewContext.product.name}</strong></div>
                                ) : (
                                  <label className="catalog-resolution-product"><span>Какой это товар?</span><select value={catalogReviewFacts.productId || ''} onChange={(event) => { setCatalogReviewFacts((current: any) => ({ ...current, productId: Number(event.target.value || 0) })); setCatalogReviewCreateProduct(false) }}><option value="">Выберите из каталога</option>{(catalogReviewContext.products || []).map((product: any) => <option key={`review-v2-product-${product.id}`} value={product.id}>{product.name}</option>)}</select></label>
                                )}
                                {!catalogReviewFacts.productId ? <div className={`catalog-resolution-new-product${catalogReviewCreateProduct ? ' is-open' : ''}`}><span>Если такого товара действительно ещё нет:</span><button className={catalogReviewCreateProduct ? 'primary compact' : 'secondary compact'} type="button" onClick={() => { setCatalogReviewCreateProduct((current) => !current); if (!catalogReviewNewProductName.trim()) setCatalogReviewNewProductName(String(catalogReviewActiveItem.productName || '').trim()) }}>{catalogReviewCreateProduct ? '✓ Создать новый товар' : 'Создать новый товар'}</button>{catalogReviewCreateProduct ? <label><span>Название в каталоге</span><input value={catalogReviewNewProductName} onChange={(event) => setCatalogReviewNewProductName(event.target.value)} placeholder="Исправьте опечатку или задайте нормальное название" /><small>Менеджер ввёл: {catalogReviewActiveItem.productName || 'Без названия'}. Исходный текст останется в истории заказа.</small></label> : null}</div> : null}
    
                                {catalogReviewContext.issueType !== 'workshop_product' ? <div className="catalog-resolution-facts-grid">
                                  {(['material', 'length'] as const).map((field) => {
                                    const label = field === 'material' ? 'Материал' : 'Длина'
                                    if (!reviewFieldUnknown(field)) return <div key={`review-v2-${field}`} className="catalog-resolution-known-fact"><span>{label}</span><strong>{catalogReviewFacts[field] || 'СТАНДАРТ'}</strong><small>распознано</small></div>
                                    return <label key={`review-v2-${field}`} className="needs-choice"><span>{label} требует решения</span><select value={catalogReviewFacts[field] || ''} onChange={(event) => { setCatalogReviewFacts((current: any) => ({ ...current, [field]: event.target.value })); setCatalogReviewCreateFields((current) => ({ ...current, [field]: false })) }}>{reviewOptionsWithCurrent(field).map((value: string) => <option key={`${field}-${value}`} value={value}>{value}{reviewValueNeedsCreation(field, value) ? ' · введено менеджером' : ''}</option>)}</select>{reviewValueNeedsCreation(field, String(catalogReviewFacts[field] || '')) ? <button className={catalogReviewCreateFields[field] ? 'primary compact' : 'secondary compact'} type="button" onClick={() => setCatalogReviewCreateFields((current) => ({ ...current, [field]: !current[field] }))}>{catalogReviewCreateFields[field] ? `✓ Добавить «${catalogReviewFacts[field]}»` : `Это новое значение — добавить в справочник`}</button> : null}</label>
                                  })}
                                  <div className="catalog-resolution-known-fact"><span>Тип</span><strong>{catalogReviewFacts.category === 'child' ? 'Детский' : 'Взрослый'}</strong><small>распознано</small></div>
                                  {reviewFieldUnknown('gender') ? <label className="needs-choice"><span>Пол требует решения</span><select value={catalogReviewFacts.gender || ''} onChange={(event) => setCatalogReviewFacts((current: any) => ({ ...current, gender: event.target.value }))}>{catalogReviewFacts.gender && !['ЖЕН', 'МУЖ'].includes(normalizeSuggestion(catalogReviewFacts.gender)) ? <option value={catalogReviewFacts.gender}>{catalogReviewFacts.gender} · введено менеджером</option> : null}<option value="">Не указан</option><option value="ЖЕН">ЖЕН</option><option value="МУЖ">МУЖ</option></select></label> : <div className="catalog-resolution-known-fact"><span>Пол</span><strong>{catalogReviewFacts.gender || 'Не указан'}</strong><small>распознано</small></div>}
                                  {(['color', 'size'] as const).map((field) => {
                                    const label = field === 'color' ? 'Цвет' : (catalogReviewFacts.category === 'child' ? 'Возраст' : 'Размер')
                                    if (!reviewFieldUnknown(field)) return <div key={`review-v2-${field}`} className="catalog-resolution-known-fact"><span>{label}</span><strong>{catalogReviewFacts[field] || 'Не указан'}</strong><small>распознано</small></div>
                                    return <label key={`review-v2-${field}`} className="needs-choice"><span>{label} требует решения</span><select value={catalogReviewFacts[field] || ''} onChange={(event) => { setCatalogReviewFacts((current: any) => ({ ...current, [field]: event.target.value })); setCatalogReviewCreateFields((current) => ({ ...current, [field]: false })) }}><option value="">Не указан</option>{reviewOptionsWithCurrent(field).map((value: string) => <option key={`${field}-${value}`} value={value}>{value}{reviewValueNeedsCreation(field, value) ? ' · введено менеджером' : ''}</option>)}</select>{reviewValueNeedsCreation(field, String(catalogReviewFacts[field] || '')) ? <button className={catalogReviewCreateFields[field] ? 'primary compact' : 'secondary compact'} type="button" onClick={() => setCatalogReviewCreateFields((current) => ({ ...current, [field]: !current[field] }))}>{catalogReviewCreateFields[field] ? `✓ Добавить «${catalogReviewFacts[field]}»` : `Это новое значение — добавить в справочник`}</button> : null}</label>
                                  })}
                                </div> : <div className="catalog-resolution-workshop-note">Это цеховая позиция. После выбора базового товара система не будет создавать складскую комбинацию и резерв.</div>}
                              </section>
    
                              {catalogReviewBlockingFields.length ? <div className="catalog-review-controlled-note">Нужно решить: {catalogReviewBlockingFields.map((field) => ({ material: 'материал', length: 'длина', color: 'цвет', size: catalogReviewFacts.category === 'child' ? 'возраст' : 'размер', gender: 'пол' } as any)[field]).join(', ')}. Выберите допустимое значение или явно подтвердите добавление нового справочного значения.</div> : null}
                              <div className="catalog-resolution-actions"><button className="primary" type="button" disabled={catalogReviewBusy || catalogReviewContextBusy || (!catalogReviewFacts.productId && !catalogReviewCreateProduct) || (catalogReviewCreateProduct && !catalogReviewNewProductName.trim()) || catalogReviewBlockingFields.length > 0} onClick={() => void submitCatalogReviewFacts()}>{catalogReviewBusy ? 'Сохраняю…' : catalogReviewContext.issueType === 'workshop_product' ? 'Связать с товаром' : catalogReviewContext.issueType === 'exact_existing' ? 'Связать точное совпадение' : 'Подтвердить факты'}</button><button className="secondary" type="button" disabled={catalogReviewBusy || catalogReviewContextBusy} onClick={() => void excludeCurrentCatalogReviewItem()}>Не добавлять в каталог</button><span>«Не добавлять в каталог» оставит исходное название только в заказе и исключит эту позицию из складского учёта. История заказа сохранится.</span></div>
                            </> : null}
                          </article>
                          {catalogReviewGroups.length > 1 ? <div className="catalog-calm-navigation"><button className="secondary" type="button" disabled={catalogReviewTaskIndex <= 0} onClick={() => setCatalogReviewTaskIndex((current) => Math.max(0, current - 1))}>← Предыдущая</button><button className="secondary" type="button" disabled={catalogReviewTaskIndex >= catalogReviewGroups.length - 1} onClick={() => setCatalogReviewTaskIndex((current) => Math.min(catalogReviewGroups.length - 1, current + 1))}>Следующая →</button></div> : null}
                        </> : null}
                      </div>
                    ) : catalogAdminMode === 'lifecycle' ? (
                      <div className="inventory-lifecycle-queue">
                        <div className="catalog-calm-review-head inventory-lifecycle-head">
                          <div>
                            <span className="catalog-review-eyebrow">Физическая вещь без догадок</span>
                            <h3>{inventoryLifecycle?.count ? `Ожидают движения: ${inventoryLifecycle.count}` : 'Ожидающие движения'}</h3>
                            <p>Здесь только вещи, которые уже участвуют в возврате или обмене, но их нельзя безопасно положить в остаток или списать без точной комбинации. Пока задача не подтверждена, физический остаток не меняется.</p>
                          </div>
                          <button className="secondary compact" type="button" disabled={inventoryLifecycleBusy} onClick={() => { setInventoryLifecycleTaskIndex(0); void loadInventoryLifecycle(true) }}>{inventoryLifecycleBusy ? 'Обновляю…' : 'Обновить'}</button>
                        </div>
    
                        {inventoryLifecycleBusy && !inventoryLifecycle ? <div className="empty-state">Загружаю физические позиции…</div> : null}
                        {!inventoryLifecycleBusy && inventoryLifecycle && inventoryLifecycleItems.length === 0 ? <div className="catalog-review-empty"><strong>Ожидающих движений нет</strong><p>Все возвраты и обмены либо уже имеют точную складскую комбинацию, либо были отменены.</p></div> : null}
    
                        {inventoryLifecycleActiveItem ? <>
                          <div className="catalog-calm-progress"><span>Одна физическая задача за раз</span><strong>{inventoryLifecycleTaskIndex + 1} из {inventoryLifecycleItems.length} загруженных</strong></div>
                          <article className="catalog-calm-task catalog-resolution-task inventory-lifecycle-task">
                            <div className="inventory-lifecycle-task-head">
                              <div>
                                <span className={`inventory-lifecycle-direction is-${inventoryLifecycleActiveItem.direction}`}>
                                  {inventoryLifecycleActiveItem.eventType === 'return_in' ? 'Возврат клиента' : inventoryLifecycleActiveItem.eventType === 'exchange_old_in' ? 'Обмен · старая вещь возвращается' : 'Обмен · новая вещь выдаётся'}
                                </span>
                                <h3>{inventoryLifecycleActiveItem.productName || 'Без названия'}</h3>
                                <p>{[productCategoryLabel(inventoryLifecycleActiveItem.category), inventoryLifecycleActiveItem.gender, inventoryLifecycleActiveItem.color, inventoryLifecycleActiveItem.material, inventoryLifecycleActiveItem.length, inventoryLifecycleActiveItem.size].filter(Boolean).join(' · ') || 'Характеристики не указаны'}</p>
                              </div>
                              <div className="inventory-lifecycle-destination">
                                <span>{inventoryLifecycleActiveItem.direction === 'in' ? 'Куда принять' : 'Откуда выдать'}</span>
                                <strong>{sourceLabel(inventoryLifecycleActiveItem.inventorySource)}</strong>
                                <small>{inventoryLifecycleActiveItem.quantity} шт.</small>
                              </div>
                            </div>
    
                            <div className="catalog-calm-orders inventory-lifecycle-order"><span>Заказ:</span><div><button type="button" onClick={() => void openOrderFromFinance({ orderId: inventoryLifecycleActiveItem.orderId, externalId: inventoryLifecycleActiveItem.externalId, orderDate: inventoryLifecycleActiveItem.orderDate })}>{inventoryLifecycleActiveItem.externalId || `#${inventoryLifecycleActiveItem.orderId}`} →</button>{inventoryLifecycleActiveItem.isWorkshop ? <span>Исходно цеховая позиция</span> : null}</div></div>
    
                            <div className="inventory-lifecycle-safety-note">
                              <strong>{inventoryLifecycleActiveItem.direction === 'in' ? 'Остаток ещё не увеличен.' : 'Физическое списание ещё не применено.'}</strong>
                              <span>{inventoryLifecycleActiveItem.isWorkshop && inventoryLifecycleActiveItem.direction === 'in' ? 'Цеховая вещь может войти в обычный остаток только после создания или выбора нормальной складской комбинации.' : 'Система специально не ищет похожую строку по старому snapshot и не создаёт остаток без variant_id.'}</span>
                            </div>
    
                            {inventoryLifecycleContextBusy ? <div className="catalog-resolution-loading">Проверяю каталог и характеристики…</div> : inventoryLifecycleContext?.error ? <div className="catalog-calm-warning"><strong>Не удалось подготовить задачу</strong><span>{inventoryLifecycleContext.error}</span></div> : inventoryLifecycleContext ? <>
                              <section className="catalog-resolution-form inventory-lifecycle-form">
                                <label className="catalog-resolution-product">
                                  <span>Какой это товар?</span>
                                  <select value={inventoryLifecycleCreateProduct ? '' : (inventoryLifecycleFacts.productId || '')} onChange={(event) => { setInventoryLifecycleFacts((current: any) => ({ ...current, productId: Number(event.target.value || 0) })); setInventoryLifecycleCreateProduct(false) }}>
                                    <option value="">Выберите из каталога</option>
                                    {catalogActiveProducts.map((product: any) => <option key={`lifecycle-product-${product.id}`} value={product.id}>{product.name}</option>)}
                                  </select>
                                </label>
                                <div className={`catalog-resolution-new-product${inventoryLifecycleCreateProduct ? ' is-open' : ''}`}>
                                  <span>Если это действительно новый базовый товар:</span>
                                  <button className={inventoryLifecycleCreateProduct ? 'primary compact' : 'secondary compact'} type="button" onClick={() => { setInventoryLifecycleCreateProduct((current) => !current); setInventoryLifecycleFacts((current: any) => ({ ...current, productId: 0 })); if (!inventoryLifecycleNewProductName.trim()) setInventoryLifecycleNewProductName(String(inventoryLifecycleActiveItem.productName || '').trim()) }}>{inventoryLifecycleCreateProduct ? '✓ Создать новый товар' : 'Создать новый товар'}</button>
                                  {inventoryLifecycleCreateProduct ? <label><span>Название в каталоге</span><input value={inventoryLifecycleNewProductName} onChange={(event) => setInventoryLifecycleNewProductName(event.target.value)} placeholder="Нормальное каноническое название" /><small>Исходный ввод: {inventoryLifecycleActiveItem.productName || 'Без названия'}</small></label> : null}
                                </div>
    
                                <div className="catalog-resolution-facts-grid inventory-lifecycle-facts">
                                  <label><span>Тип</span><select value={inventoryLifecycleFacts.category} onChange={(event) => { setInventoryLifecycleFacts((current: any) => ({ ...current, category: event.target.value === 'child' ? 'child' : 'adult', size: '' })); setInventoryLifecycleCreateFields((current) => ({ ...current, size: false })) }}><option value="adult">Взрослый</option><option value="child">Детский</option></select></label>
                                  {(['material', 'length'] as const).map((field) => {
                                    const label = field === 'material' ? 'Материал' : 'Длина'
                                    return <label key={`lifecycle-${field}`} className={lifecycleValueNeedsCreation(field, String(inventoryLifecycleFacts[field] || '')) ? 'needs-choice' : ''}><span>{label}</span><select value={inventoryLifecycleFacts[field] || 'СТАНДАРТ'} onChange={(event) => { setInventoryLifecycleFacts((current: any) => ({ ...current, [field]: event.target.value })); setInventoryLifecycleCreateFields((current) => ({ ...current, [field]: false })) }}>{lifecycleOptionsWithCurrent(field).map((value: string) => <option key={`lifecycle-${field}-${value}`} value={value}>{value}{lifecycleValueNeedsCreation(field, value) ? ' · введено сотрудником' : ''}</option>)}</select>{lifecycleValueNeedsCreation(field, String(inventoryLifecycleFacts[field] || '')) ? <button className={inventoryLifecycleCreateFields[field] ? 'primary compact' : 'secondary compact'} type="button" onClick={() => setInventoryLifecycleCreateFields((current) => ({ ...current, [field]: !current[field] }))}>{inventoryLifecycleCreateFields[field] ? `✓ Добавить «${inventoryLifecycleFacts[field]}»` : 'Это новое значение — добавить в справочник'}</button> : null}</label>
                                  })}
                                  <label className={inventoryLifecycleGenderNeedsChoice ? 'needs-choice' : ''}><span>Пол</span><select value={inventoryLifecycleFacts.gender || ''} onChange={(event) => setInventoryLifecycleFacts((current: any) => ({ ...current, gender: event.target.value }))}>{inventoryLifecycleFacts.gender && !['ЖЕН', 'МУЖ'].includes(normalizeSuggestion(inventoryLifecycleFacts.gender)) ? <option value={inventoryLifecycleFacts.gender}>{inventoryLifecycleFacts.gender} · введено сотрудником</option> : null}<option value="">Не указан</option><option value="ЖЕН">ЖЕН</option><option value="МУЖ">МУЖ</option></select></label>
                                  {(['color', 'size'] as const).map((field) => {
                                    const label = field === 'color' ? 'Цвет' : (inventoryLifecycleFacts.category === 'child' ? 'Возраст' : 'Размер')
                                    return <label key={`lifecycle-${field}`} className={lifecycleValueNeedsCreation(field, String(inventoryLifecycleFacts[field] || '')) ? 'needs-choice' : ''}><span>{label}</span><select value={inventoryLifecycleFacts[field] || ''} onChange={(event) => { setInventoryLifecycleFacts((current: any) => ({ ...current, [field]: event.target.value })); setInventoryLifecycleCreateFields((current) => ({ ...current, [field]: false })) }}><option value="">Не указан</option>{lifecycleOptionsWithCurrent(field).filter((value: string) => value).map((value: string) => <option key={`lifecycle-${field}-${value}`} value={value}>{value}{lifecycleValueNeedsCreation(field, value) ? ' · введено сотрудником' : ''}</option>)}</select>{lifecycleValueNeedsCreation(field, String(inventoryLifecycleFacts[field] || '')) ? <button className={inventoryLifecycleCreateFields[field] ? 'primary compact' : 'secondary compact'} type="button" onClick={() => setInventoryLifecycleCreateFields((current) => ({ ...current, [field]: !current[field] }))}>{inventoryLifecycleCreateFields[field] ? `✓ Добавить «${inventoryLifecycleFacts[field]}»` : 'Это новое значение — добавить в справочник'}</button> : null}</label>
                                  })}
                                </div>
                              </section>
    
                              {inventoryLifecycleBlockingFields.length ? <div className="catalog-review-controlled-note">Нужно решить: {inventoryLifecycleBlockingFields.map((field) => ({ material: 'материал', length: 'длина', color: 'цвет', size: inventoryLifecycleFacts.category === 'child' ? 'возраст' : 'размер', gender: 'пол' } as any)[field]).join(', ')}. Выберите известное значение или явно подтвердите новое.</div> : null}
                              {lifecycleFactsMatchExactVariant ? <div className="inventory-lifecycle-exact-note">Точная каноническая комбинация уже существует. Даже если старый справочник неполон, повторно создавать значения не нужно.</div> : null}
                              <div className="catalog-resolution-actions inventory-lifecycle-actions"><button className="primary" type="button" disabled={inventoryLifecycleBusy || inventoryLifecycleContextBusy || (!inventoryLifecycleFacts.productId && !inventoryLifecycleCreateProduct) || (inventoryLifecycleCreateProduct && !inventoryLifecycleNewProductName.trim()) || inventoryLifecycleBlockingFields.length > 0} onClick={() => void submitInventoryLifecycleFacts()}>{inventoryLifecycleBusy ? 'Применяю…' : inventoryLifecycleActiveItem.direction === 'in' ? 'Подтвердить и принять в остаток' : 'Подтвердить и списать'}</button><span>После подтверждения движение будет применено только к этой точной комбинации характеристик. Повторное подтверждение не удвоит движение.</span></div>
                            </> : null}
                          </article>
                          {inventoryLifecycleItems.length > 1 ? <div className="catalog-calm-navigation"><button className="secondary" type="button" disabled={inventoryLifecycleTaskIndex <= 0} onClick={() => setInventoryLifecycleTaskIndex((current) => Math.max(0, current - 1))}>← Предыдущая</button><button className="secondary" type="button" disabled={inventoryLifecycleTaskIndex >= inventoryLifecycleItems.length - 1} onClick={() => setInventoryLifecycleTaskIndex((current) => Math.min(inventoryLifecycleItems.length - 1, current + 1))}>Следующая →</button></div> : null}
                        </> : null}
                      </div>
                    ) : (
                      renderInventoryReferenceManager(
                        inventoryProductReferenceGroups,
                        'Характеристики одежды',
                        'Цвета, материалы, длины, взрослые размеры и детские возраста теперь живут рядом с каталогом товаров. Изменения сразу используются в заказах, приходе и вариантах.',
                      )
                    )}
                  </div>
  )
}
