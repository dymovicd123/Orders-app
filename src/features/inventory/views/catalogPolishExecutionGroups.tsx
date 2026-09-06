const normalizedText = (value: unknown) => String(value || '').trim()
const normalizedKey = (value: unknown) => normalizedText(value).toUpperCase() || 'СТАНДАРТ'

export const pluralRu = (value: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(value)
  const lastTwo = absolute % 100
  const last = absolute % 10
  if (lastTwo >= 11 && lastTwo <= 19) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

function colorGroupsFor(variants: any[], getCatalogVariantCategory: (variant: any) => string) {
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

function executionHumanSummary(
  variants: any[],
  getCatalogVariantCategory: (variant: any) => string,
) {
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

export function CatalogPolishExecutionGroups({
  executionGroups,
  selectedVariants,
  selectedProduct,
  getStockQuantityForVariant,
  getCatalogVariantCategory,
  productCategoryLabel,
  catalogVariantDraft,
  showVariantEditor,
  openVariantEditor,
  stocktakeReferenceReady,
  openNewVariant,
}: any) {
  return (
    <div className="catalog-execution-list">
      {executionGroups.length ? executionGroups.map((group: any) => {
        const groupPhysical = group.variants.reduce((sum: number, variant: any) => sum + (getStockQuantityForVariant('warehouse', variant.id) || 0) + (getStockQuantityForVariant('boutique', variant.id) || 0), 0)
        const colorGroups = colorGroupsFor(group.variants, getCatalogVariantCategory)
        return (
          <section key={`execution-${group.key}`} className="catalog-execution-card">
            <div className="catalog-execution-head">
              <div>
                <span className="catalog-detail-eyebrow">Исполнение</span>
                <h3>{group.label}</h3>
                <p>{group.label === 'Основное исполнение' ? `Базовое исполнение · ${executionHumanSummary(group.variants, getCatalogVariantCategory)}` : executionHumanSummary(group.variants, getCatalogVariantCategory)}</p>
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
  )
}
