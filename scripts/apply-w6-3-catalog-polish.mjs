import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const replaceOnce = (text, before, after, label) => {
  if (!text.includes(before)) throw new Error(`W6.3 anchor missing: ${label}`)
  return text.replace(before, after)
}

const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function rendererHash(path, name) {
  const text = fs.readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let fn = null
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!fn?.body) throw new Error(`${name} not found in ${path}`)
  const returned = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
  if (!returned?.expression) throw new Error(`return not found in ${path}`)
  let expression = returned.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return sha(normalize(expression.getText(source)))
}

const rendererPath = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
const beforeHash = rendererHash(rendererPath, 'renderInventoryCatalogPanel')
let source = fs.readFileSync(rendererPath, 'utf8')

const variantsAnchor = `  const activeVariantsFor = (productId: number) => [...(catalogVariantsByProductId?.get?.(Number(productId)) || [])]\n    .filter((variant: any) => variant?.isActive !== false)\n\n  const browseProducts = activeProducts.filter((product: any) => {`
const variantsHelpers = `  const activeVariantsFor = (productId: number) => [...(catalogVariantsByProductId?.get?.(Number(productId)) || [])]\n    .filter((variant: any) => variant?.isActive !== false)\n\n  const pluralRu = (value: number, one: string, few: string, many: string) => {\n    const absolute = Math.abs(value)\n    const lastTwo = absolute % 100\n    const last = absolute % 10\n    if (lastTwo >= 11 && lastTwo <= 19) return many\n    if (last === 1) return one\n    if (last >= 2 && last <= 4) return few\n    return many\n  }\n\n  const variantMatchesCategory = (variant: any) => catalogCategoryFilter === 'all' || getCatalogVariantCategory(variant) === catalogCategoryFilter\n\n  const variantMatchesQuery = (variant: any) => {\n    if (!query) return true\n    return [\n      productCategoryLabel(getCatalogVariantCategory(variant)),\n      variant.gender,\n      variant.color,\n      variant.material,\n      variant.length,\n      variant.sizeLabel,\n    ].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query)\n  }\n\n  const colorGroupsFor = (variants: any[]) => {\n    const groups = new Map<string, any>()\n    for (const variant of variants) {\n      const colorLabel = normalizedText(variant.color) || 'Цвет не указан'\n      const colorKey = normalizedKey(colorLabel)\n      if (!groups.has(colorKey)) groups.set(colorKey, { key: colorKey, label: colorLabel, variants: [], subgroupMap: new Map<string, any>() })\n      const colorGroup = groups.get(colorKey)!\n      colorGroup.variants.push(variant)\n      const category = getCatalogVariantCategory(variant)\n      const gender = normalizedText(variant.gender) || 'Пол не указан'\n      const subgroupKey = \`${'${category}'}¦${'${normalizedKey(gender)}'}\`\n      if (!colorGroup.subgroupMap.has(subgroupKey)) colorGroup.subgroupMap.set(subgroupKey, { key: subgroupKey, category, gender, variants: [] })\n      colorGroup.subgroupMap.get(subgroupKey)!.variants.push(variant)\n    }\n\n    return Array.from(groups.values()).map((group: any) => ({\n      ...group,\n      subgroups: Array.from(group.subgroupMap.values()).map((subgroup: any) => ({\n        ...subgroup,\n        variants: [...subgroup.variants].sort((a: any, b: any) => normalizedText(a.sizeLabel).localeCompare(normalizedText(b.sizeLabel), 'ru', { numeric: true })),\n      })).sort((a: any, b: any) => a.category.localeCompare(b.category) || a.gender.localeCompare(b.gender, 'ru')),\n    })).sort((a: any, b: any) => a.label.localeCompare(b.label, 'ru', { numeric: true }))\n  }\n\n  const executionHumanSummary = (variants: any[]) => {\n    const colors = new Set(variants.map((variant: any) => normalizedText(variant.color) || 'Цвет не указан'))\n    const sizes = Array.from(new Set(variants.map((variant: any) => normalizedText(variant.sizeLabel)).filter(Boolean)))\n      .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))\n    const colorText = \`${'${colors.size}'} ${'${pluralRu(colors.size, \'цвет\', \'цвета\', \'цветов\')}'}\`\n    if (!sizes.length) return colorText\n    const categories = new Set(variants.map((variant: any) => getCatalogVariantCategory(variant)))\n    if (categories.size === 1 && categories.has('child')) {\n      return sizes.length === 1 ? \`${'${colorText}'} · возраст ${'${sizes[0]}'}\` : \`${'${colorText}'} · возраст ${'${sizes[0]}'}–${'${sizes[sizes.length - 1]}'}\`\n    }\n    if (categories.size === 1) {\n      return sizes.length === 1 ? \`${'${colorText}'} · размер ${'${sizes[0]}'}\` : \`${'${colorText}'} · размеры ${'${sizes[0]}'}–${'${sizes[sizes.length - 1]}'}\`\n    }\n    return \`${'${colorText}'} · ${'${sizes.length}'} ${'${pluralRu(sizes.length, \'значение размера/возраста\', \'значения размера/возраста\', \'значений размера/возраста\')}'}\`\n  }\n\n  const browseProducts = activeProducts.filter((product: any) => {`
source = replaceOnce(source, variantsAnchor, variantsHelpers, 'variant grouping helpers')

source = replaceOnce(
  source,
  `    return variants.some((variant: any) => [\n      productCategoryLabel(getCatalogVariantCategory(variant)),\n      variant.gender,\n      variant.color,\n      variant.material,\n      variant.length,\n      variant.sizeLabel,\n    ].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query))`,
  `    return variants.some(variantMatchesQuery)`,
  'browse search reuse',
)

const selectionBefore = `  const selectedNumericKey = Object.keys(expandedCatalogProducts || {}).find((key) => /^\\d+$/.test(key) && expandedCatalogProducts[key]) || ''\n  const selectedNumericId = Number(selectedNumericKey || 0)\n  const explicitSelectedProduct = browseProducts.find((product: any) => Number(product.id) === selectedNumericId) || null\n  const selectedProduct = explicitSelectedProduct || browseProducts[0] || null\n  const showNewProduct = Boolean(expandedCatalogProducts?.[W6_NEW_PRODUCT])\n  const showEditProduct = Boolean(expandedCatalogProducts?.[W6_EDIT_PRODUCT])\n  const showVariantEditor = Boolean(expandedCatalogProducts?.[W6_VARIANT_EDITOR])`
const selectionAfter = `  const selectedNumericKey = Object.keys(expandedCatalogProducts || {}).find((key) => /^\\d+$/.test(key) && expandedCatalogProducts[key]) || ''\n  const selectedNumericId = Number(selectedNumericKey || 0)\n  const showNewProduct = Boolean(expandedCatalogProducts?.[W6_NEW_PRODUCT])\n  const showEditProduct = Boolean(expandedCatalogProducts?.[W6_EDIT_PRODUCT])\n  const showVariantEditor = Boolean(expandedCatalogProducts?.[W6_VARIANT_EDITOR])\n  const editingSelectedProduct = Boolean(showEditProduct || showVariantEditor)\n  const explicitSelectedProduct = browseProducts.find((product: any) => Number(product.id) === selectedNumericId) || null\n  const explicitSelectedProductAny = activeProducts.find((product: any) => Number(product.id) === selectedNumericId) || null\n  const selectedProduct = editingSelectedProduct && explicitSelectedProductAny ? explicitSelectedProductAny : explicitSelectedProduct || browseProducts[0] || null\n  const selectedProductHiddenByFilter = Boolean(selectedProduct && !browseProducts.some((product: any) => Number(product.id) === Number(selectedProduct.id)))\n  const hasExplicitDetail = Boolean(explicitSelectedProduct || (editingSelectedProduct && explicitSelectedProductAny))`
source = replaceOnce(source, selectionBefore, selectionAfter, 'safe selected-product editor context')

const selectedStart = source.indexOf('  const selectedVariants = selectedProduct')
const selectedEnd = source.indexOf('  const productListSummary = (product: any) => {', selectedStart)
if (selectedStart < 0 || selectedEnd < 0) throw new Error('W6.3 selected variant block not found')
const selectedBlock = `  const selectedVariants = selectedProduct\n    ? activeVariantsFor(Number(selectedProduct.id)).sort((a: any, b: any) => {\n      const executionDiff = executionLabel(a.material, a.length).localeCompare(executionLabel(b.material, b.length), 'ru', { numeric: true })\n      const categoryDiff = getCatalogVariantCategory(a).localeCompare(getCatalogVariantCategory(b))\n      const detailDiff = [a.color, a.gender, a.sizeLabel].join(' ').localeCompare([b.color, b.gender, b.sizeLabel].join(' '), 'ru', { numeric: true })\n      return executionDiff || categoryDiff || detailDiff\n    })\n    : []\n\n  const selectedProductNameMatchesQuery = Boolean(query && selectedProduct && normalizedText(selectedProduct.name).toLocaleLowerCase('ru').includes(query))\n  const visibleSelectedVariants = selectedVariants.filter((variant: any) => {\n    if (!variantMatchesCategory(variant)) return false\n    if (!query || selectedProductNameMatchesQuery) return true\n    return variantMatchesQuery(variant)\n  })\n\n  const executionGroups = (() => {\n    const groups = new Map<string, { key: string; label: string; material: string; length: string; variants: any[] }>()\n    for (const variant of visibleSelectedVariants) {\n      const key = executionKey(variant.material, variant.length)\n      if (!groups.has(key)) {\n        groups.set(key, {\n          key,\n          label: executionLabel(variant.material, variant.length),\n          material: normalizedText(variant.material) || 'СТАНДАРТ',\n          length: normalizedText(variant.length) || 'СТАНДАРТ',\n          variants: [],\n        })\n      }\n      groups.get(key)!.variants.push(variant)\n    }\n    return Array.from(groups.values()).sort((a, b) => {\n      const aDefault = a.label === 'Основное исполнение' ? 0 : 1\n      const bDefault = b.label === 'Основное исполнение' ? 0 : 1\n      return aDefault - bDefault || a.label.localeCompare(b.label, 'ru', { numeric: true })\n    })\n  })()\n\n  const selectedExecutionCount = new Set(selectedVariants.map((variant: any) => executionKey(variant.material, variant.length))).size\n  const selectedAdultCount = selectedVariants.filter((variant: any) => getCatalogVariantCategory(variant) === 'adult').length\n  const selectedChildCount = selectedVariants.filter((variant: any) => getCatalogVariantCategory(variant) === 'child').length\n  const activeProductCount = (catalogData?.products || []).filter((product: any) => product.isActive).length\n  const activeVariantCount = (catalogData?.variants || []).filter((variant: any) => variant.isActive).length\n\n`
source = source.slice(0, selectedStart) + selectedBlock + source.slice(selectedEnd)

source = source.replace(
  `    if (child) return \`${'${child}'} детских ${'${child === 1 ? \'вариант\' : \'вариантов\'}'}\`\n    return \`${'${variants.length}'} ${'${variants.length === 1 ? \'вариант\' : \'вариантов\'}'}\``,
  `    if (child) return \`${'${child}'} детских ${'${pluralRu(child, \'вариант\', \'варианта\', \'вариантов\')}'}\`\n    return \`${'${variants.length}'} ${'${pluralRu(variants.length, \'вариант\', \'варианта\', \'вариантов\')}'}\``,
)

source = replaceOnce(
  source,
  `        <div className="w6-catalog-head-actions">\n          <button className="secondary compact" type="button" onClick={() => void loadCatalogData(true)}>Обновить</button>\n          <button className="primary compact" type="button" onClick={openNewProduct}>+ Новый товар</button>\n        </div>`,
  `        <div className="w6-catalog-head-actions">\n          <button className="secondary compact" type="button" onClick={() => void loadCatalogData(true)}>Обновить</button>\n        </div>`,
  'headline action hierarchy',
)

const toolbarCategoryEnd = `        </div>\n        <div className="w6-catalog-stats" aria-label="Сводка каталога">\n          <span><b>{(catalogData?.products || []).filter((product: any) => product.isActive).length}</b> товаров</span>\n          <span><b>{(catalogData?.variants || []).filter((variant: any) => variant.isActive).length}</b> вариантов</span>`
const toolbarCategoryAfter = `        </div>\n        <div className="w6-catalog-toolbar-actions">\n          <button className="primary w6-toolbar-new-product" type="button" onClick={openNewProduct}>+ Новый товар</button>\n        </div>\n        <div className="w6-catalog-stats" aria-label="Сводка каталога">\n          <span>Всего: <b>{activeProductCount}</b> {pluralRu(activeProductCount, 'товар', 'товара', 'товаров')}</span>\n          <span><b>{activeVariantCount}</b> {pluralRu(activeVariantCount, 'вариант', 'варианта', 'вариантов')}</span>`
source = replaceOnce(source, toolbarCategoryEnd, toolbarCategoryAfter, 'toolbar new product and total stats')
source = source.replace('<button type="button" className={catalogOnlyWithoutVariants ? \'is-active\' : \'\'} onClick={() => { setCatalogCategoryFilter(\'all\'); setCatalogOnlyWithoutVariants(true); setInventoryQuery(\'\') }}>', '<button type="button" className={`w6-catalog-issue-filter ${catalogOnlyWithoutVariants ? \'is-active\' : \'\'}`} onClick={() => { setCatalogCategoryFilter(\'all\'); setCatalogOnlyWithoutVariants(true); setInventoryQuery(\'\') }}>')

source = replaceOnce(
  source,
  `<div className={\`catalog-master-detail ${'${explicitSelectedProduct ? \'has-explicit-selection\' : \'\'}'} ${'${showNewProduct ? \'is-new-product\' : \'\'}'}\`}>`,
  `<div className={\`catalog-master-detail ${'${hasExplicitDetail ? \'has-explicit-selection\' : \'\'}'} ${'${showNewProduct ? \'is-new-product\' : \'\'}'}\`}>`,
  'master/detail explicit state',
)

source = replaceOnce(
  source,
  `            <strong>{browseProducts.length} товаров</strong>\n            {query ? <span>по текущему поиску</span> : <span>в текущем фильтре</span>}`,
  `            <strong>{query ? 'Найдено ' : ''}{browseProducts.length} {pluralRu(browseProducts.length, 'товар', 'товара', 'товаров')}</strong>\n            {query ? <span>по текущему поиску</span> : <span>в текущем фильтре</span>}`,
  'human result count',
)

source = replaceOnce(
  source,
  `<div className="catalog-detail-meta">\n                    <span><b>{selectedVariants.length}</b> {selectedVariants.length === 1 ? 'вариант' : 'вариантов'}</span>\n                    <span><b>{executionGroups.length}</b> {executionGroups.length === 1 ? 'исполнение' : 'исполнений'}</span>\n                    {selectedAdultCount && selectedChildCount ? <span>{selectedAdultCount} взрослых · {selectedChildCount} детских</span> : selectedChildCount ? <span>Детский товар</span> : <span>Взрослый товар</span>}\n                  </div>`,
  `<div className="catalog-detail-meta catalog-product-commercial-anchor">\n                    <span><b>{selectedVariants.length}</b> {pluralRu(selectedVariants.length, 'вариант', 'варианта', 'вариантов')}</span>\n                    <span><b>{selectedExecutionCount}</b> {pluralRu(selectedExecutionCount, 'исполнение', 'исполнения', 'исполнений')}</span>\n                    {visibleSelectedVariants.length !== selectedVariants.length ? <span className="is-filtered"><b>{visibleSelectedVariants.length}</b> показано</span> : null}\n                    {selectedAdultCount && selectedChildCount ? <span>{selectedAdultCount} взрослых · {selectedChildCount} детских</span> : selectedChildCount ? <span>Детский товар</span> : <span>Взрослый товар</span>}\n                  </div>\n                  {selectedProductHiddenByFilter ? <span className="catalog-filter-context-note">Редактируемый товар скрыт текущим поиском или фильтром. Контекст сохранён до закрытия редактора.</span> : null}`,
  'product detail meta and editor context',
)

const executionStart = source.indexOf('              <div className="catalog-execution-list">')
const executionEnd = source.indexOf('              {showVariantEditor ? (', executionStart)
if (executionStart < 0 || executionEnd < 0) throw new Error('W6.3 execution render block not found')
const executionBlock = `              <div className="catalog-execution-list">\n                {executionGroups.length ? executionGroups.map((group) => {\n                  const groupPhysical = group.variants.reduce((sum, variant) => sum + (getStockQuantityForVariant('warehouse', variant.id) || 0) + (getStockQuantityForVariant('boutique', variant.id) || 0), 0)\n                  const colorGroups = colorGroupsFor(group.variants)\n                  return (\n                    <section key={\`execution-${'${group.key}'}\`} className="catalog-execution-card">\n                      <div className="catalog-execution-head">\n                        <div>\n                          <span className="catalog-detail-eyebrow">Исполнение</span>\n                          <h3>{group.label}</h3>\n                          <p>{group.label === 'Основное исполнение' ? \`Базовое исполнение · ${'${executionHumanSummary(group.variants)}'}\` : executionHumanSummary(group.variants)}</p>\n                        </div>\n                        <div className="catalog-execution-summary catalog-execution-commercial-anchor" data-execution-key={group.key}>\n                          <strong>{groupPhysical}</strong>\n                          <span>физически в точках</span>\n                        </div>\n                      </div>\n\n                      <div className="catalog-color-list">\n                        {colorGroups.map((colorGroup: any) => {\n                          const colorPhysical = colorGroup.variants.reduce((sum: number, variant: any) => sum + (getStockQuantityForVariant('warehouse', variant.id) || 0) + (getStockQuantityForVariant('boutique', variant.id) || 0), 0)\n                          const colorSizeCount = new Set(colorGroup.variants.map((variant: any) => normalizedText(variant.sizeLabel)).filter(Boolean)).size\n                          return (\n                            <section key={\`color-${'${group.key}'}-${'${colorGroup.key}'}\`} className="catalog-color-group">\n                              <div className="catalog-color-head">\n                                <div className="catalog-color-title">\n                                  <strong>{colorGroup.label}</strong>\n                                  <span>{colorSizeCount ? \`${'${colorSizeCount}'} ${'${pluralRu(colorSizeCount, \'размер/возраст\', \'размера/возраста\', \'размеров/возрастов\')}'}\` : 'Без указанного размера/возраста'}</span>\n                                </div>\n                                <div className="catalog-color-total">\n                                  <strong>{colorPhysical}</strong>\n                                  <span>на месте</span>\n                                </div>\n                              </div>\n\n                              <div className="catalog-color-subgroups">\n                                {colorGroup.subgroups.map((subgroup: any) => (\n                                  <div key={\`subgroup-${'${group.key}'}-${'${colorGroup.key}'}-${'${subgroup.key}'}\`} className="catalog-color-subgroup">\n                                    <div className="catalog-color-subgroup-label">\n                                      <strong>{subgroup.gender}</strong>\n                                      <span>{productCategoryLabel(subgroup.category)} · {subgroup.category === 'child' ? 'возраст' : 'размер'}</span>\n                                    </div>\n                                    <div className="catalog-size-grid">\n                                      {subgroup.variants.map((variant: any) => {\n                                        const warehouseQty = getStockQuantityForVariant('warehouse', variant.id) || 0\n                                        const boutiqueQty = getStockQuantityForVariant('boutique', variant.id) || 0\n                                        const totalQty = warehouseQty + boutiqueQty\n                                        const sizeLabel = normalizedText(variant.sizeLabel) || (subgroup.category === 'child' ? '— возраст' : '— размер')\n                                        const selected = catalogVariantDraft.id === variant.id && showVariantEditor\n                                        return (\n                                          <button\n                                            key={\`w6-variant-${'${variant.id}'}\`}\n                                            type="button"\n                                            className={\`catalog-size-tile catalog-variant-commercial-anchor ${'${totalQty > 0 ? \'has-stock\' : \'is-zero\'}'} ${'${selected ? \'is-selected\' : \'\'}'}\`}\n                                            data-variant-id={variant.id}\n                                            title="Нажмите, чтобы изменить этот точный вариант"\n                                            aria-label={\`Редактировать ${'${colorGroup.label}'}, ${'${subgroup.category === \'child\' ? \'возраст\' : \'размер\'}'} ${'${sizeLabel}'}, на месте ${'${totalQty}'}\`}\n                                            onClick={() => openVariantEditor(selectedProduct, variant)}\n                                          >\n                                            <span className="catalog-size-value">{sizeLabel}</span>\n                                            <span className="catalog-size-stock">{totalQty} шт</span>\n                                            <small>Склад {warehouseQty} · Бутик {boutiqueQty}</small>\n                                          </button>\n                                        )\n                                      })}\n                                    </div>\n                                  </div>\n                                ))}\n                              </div>\n                            </section>\n                          )\n                        })}\n                      </div>\n                    </section>\n                  )\n                }) : (\n                  <div className="catalog-detail-empty">\n                    <strong>{selectedVariants.length ? 'Нет вариантов по текущему фильтру' : 'У товара пока нет вариантов'}</strong>\n                    <p>{selectedVariants.length ? 'Измените поиск или фильтр, чтобы снова показать варианты этого товара.' : 'Создайте первый вариант только если это реальная комбинация характеристик, которая должна участвовать в заказах и остатках.'}</p>\n                    {!selectedVariants.length ? <button className="primary compact" type="button" disabled={!stocktakeReferenceReady} onClick={() => openNewVariant(selectedProduct)}>+ Добавить первый вариант</button> : null}\n                  </div>\n                )}\n              </div>\n\n`
source = source.slice(0, executionStart) + executionBlock + source.slice(executionEnd)

fs.writeFileSync(rendererPath, source)
const afterHash = rendererHash(rendererPath, 'renderInventoryCatalogPanel')

// W6.2 remains an inherited gate; accept the W6.3 representation while preserving its intent.
const w62Path = 'scripts/test-w6-2-catalog-master-detail.mjs'
let w62 = fs.readFileSync(w62Path, 'utf8')
w62 = w62.replace(
  "check(catalog.includes('executionGroups') && catalog.includes('catalog-execution-card') && catalog.includes('catalog-variation-row'), 'Product -> Execution -> Variations hierarchy missing')",
  "check(catalog.includes('executionGroups') && catalog.includes('catalog-execution-card') && (catalog.includes('catalog-variation-row') || catalog.includes('catalog-color-group')), 'Product -> Execution -> Variations hierarchy missing')",
)
w62 = w62.replace(
  "check(catalog.includes('Редактировать товар') && catalog.includes('+ Вариант') && catalog.includes('Править'), 'editing must be explicit from the selected product sheet')",
  "check(catalog.includes('Редактировать товар') && catalog.includes('+ Вариант') && catalog.includes('openVariantEditor'), 'editing must remain explicit from the selected product sheet')",
)
w62 = w62.replace(
  "check(catalog.includes(\"explicitSelectedProduct ? 'has-explicit-selection'\"), 'mobile detail mode must only activate when the selected product still belongs to the current filter')",
  "check(catalog.includes(\"hasExplicitDetail ? 'has-explicit-selection'\"), 'mobile detail mode must preserve an explicit selected/editor product context')",
)
fs.writeFileSync(w62Path, w62)

const focusedPath = 'scripts/test-w6-3-catalog-polish.mjs'
fs.writeFileSync(focusedPath, `import fs from 'node:fs'\n\nconst read = (path) => fs.readFileSync(path, 'utf8')\nconst check = (condition, message) => { if (!condition) throw new Error(message) }\n\nconst catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')\nconst css = read('src/styles/w6-3-catalog-polish.css')\nconst loader = read('src/styles/192b2a-warehouse-attention-actions.css')\nconst inventory = read('src/features/sections/InventorySection.tsx')\n\ncheck(loader.includes("@import './w6-3-catalog-polish.css';"), 'W6.3 polish CSS is not loaded')\ncheck(catalog.includes('colorGroupsFor') && catalog.includes('catalog-color-group') && catalog.includes('catalog-size-grid'), 'Execution -> Color -> Size hierarchy missing')\ncheck(catalog.includes('catalog-size-tile') && catalog.includes('catalog-size-value') && catalog.includes('catalog-size-stock'), 'large size-first variant tile missing')\ncheck(catalog.includes('data-variant-id={variant.id}') && catalog.includes('openVariantEditor(selectedProduct, variant)'), 'exact variant identity/edit path was lost during grouping')\ncheck(!catalog.includes('>Править</button>'), 'repeated per-SKU Править buttons returned')\ncheck(catalog.includes('visibleSelectedVariants') && catalog.includes('selectedProductNameMatchesQuery') && catalog.includes('variantMatchesCategory'), 'detail-side search/category filtering is not honest')\ncheck(catalog.includes('explicitSelectedProductAny') && catalog.includes('selectedProductHiddenByFilter'), 'editor context is not preserved when search/filter hides the selected product')\ncheck(catalog.includes('Найдено ') && catalog.includes("pluralRu(browseProducts.length, 'товар', 'товара', 'товаров')"), 'human Russian result count missing')\ncheck(catalog.includes('Всего:') && catalog.includes('w6-catalog-issue-filter'), 'global totals and clickable issue filter are not visually distinguished')\ncheck(catalog.includes('w6-catalog-toolbar-actions') && catalog.includes('w6-toolbar-new-product'), 'New product action is not discoverable in the working toolbar')\ncheck(catalog.includes('catalog-product-commercial-anchor') && catalog.includes('catalog-execution-commercial-anchor') && catalog.includes('catalog-variant-commercial-anchor'), 'future pricing anchors are missing at product/execution/variant levels')\ncheck(css.includes('font-size: 1.03rem') && css.includes('min-height: 68px'), 'size tiles are still too small to scan')\ncheck(css.includes('.catalog-size-tile.has-stock') && css.includes('.catalog-size-tile.is-zero'), 'stock/no-stock visual hierarchy missing')\ncheck(css.includes('@media (max-width: 460px)') && css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'), 'mobile size grid contract missing')\ncheck(catalog.includes("material: 'СТАНДАРТ'") && catalog.includes("length: 'СТАНДАРТ'"), 'valid STANDARD semantics changed')\ncheck(catalog.includes('void saveCatalogProduct()') && catalog.includes('void saveCatalogVariant()'), 'Catalog write paths changed')\ncheck(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')\n\nconsole.log('W6.3 CATALOG POLISH PASSED — execution/color/size scanning, honest filtering, editor safety, action hierarchy and future pricing anchors are protected')\n`)

// Load W6.3 after the W6.2 layer.
const loaderPath = 'src/styles/192b2a-warehouse-attention-actions.css'
let loader = fs.readFileSync(loaderPath, 'utf8')
if (!loader.includes("@import './w6-3-catalog-polish.css';")) {
  loader = replaceOnce(loader, "@import './w6-2-catalog-master-detail.css';\n", "@import './w6-2-catalog-master-detail.css';\n@import './w6-3-catalog-polish.css';\n", 'W6.3 CSS import')
  fs.writeFileSync(loaderPath, loader)
}

// Add the focused gate to the cumulative release check.
const packagePath = 'package.json'
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
if (!pkg.scripts['release:check'].includes('test-w6-3-catalog-polish.mjs')) {
  pkg.scripts['release:check'] += ' && node scripts/test-w6-3-catalog-polish.mjs'
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
}

// Register the exact renderer delta with 190.6B preservation.
const preservationPath = 'scripts/test-step1906b-frontend-modularization.mjs'
let preservation = fs.readFileSync(preservationPath, 'utf8')
if (!preservation.includes('w6CatalogPolishPath')) {
  preservation = replaceOnce(
    preservation,
    "const w6CatalogMasterDetailPath = path.join(root, 'scripts/w6-2-catalog-master-detail-frontend-manifest.json')",
    "const w6CatalogMasterDetailPath = path.join(root, 'scripts/w6-2-catalog-master-detail-frontend-manifest.json')\nconst w6CatalogPolishPath = path.join(root, 'scripts/w6-3-catalog-polish-frontend-manifest.json')",
    '1906B W6.3 manifest path',
  )
  preservation = replaceOnce(
    preservation,
    "  const w6CatalogMasterDetail = fs.existsSync(w6CatalogMasterDetailPath) ? JSON.parse(fs.readFileSync(w6CatalogMasterDetailPath, 'utf8')) : null",
    "  const w6CatalogMasterDetail = fs.existsSync(w6CatalogMasterDetailPath) ? JSON.parse(fs.readFileSync(w6CatalogMasterDetailPath, 'utf8')) : null\n  const w6CatalogPolish = fs.existsSync(w6CatalogPolishPath) ? JSON.parse(fs.readFileSync(w6CatalogPolishPath, 'utf8')) : null",
    '1906B W6.3 manifest read',
  )
  preservation = replaceOnce(
    preservation,
    "  if (w6CatalogMasterDetail) check(w6CatalogMasterDetail.version === 1 && w6CatalogMasterDetail.revision === 'w6-2-catalog-master-detail', 'W6.2 Catalog master-detail frontend manifest invalid')",
    "  if (w6CatalogMasterDetail) check(w6CatalogMasterDetail.version === 1 && w6CatalogMasterDetail.revision === 'w6-2-catalog-master-detail', 'W6.2 Catalog master-detail frontend manifest invalid')\n  if (w6CatalogPolish) check(w6CatalogPolish.version === 1 && w6CatalogPolish.revision === 'w6-3-catalog-polish', 'W6.3 Catalog polish frontend manifest invalid')",
    '1906B W6.3 manifest validation',
  )
  const oldChain = `    const w6CatalogMasterDetailChange = w6CatalogMasterDetail?.frontend?.panelReturnChanges?.[panel.func]\n    if (w6CatalogMasterDetailChange) {\n      check(w6CatalogMasterDetailChange.before === expectedPanelHash, \`${'${panel.func}'}: W6.2 Catalog master-detail panel baseline hash mismatch\`)\n      expectedPanelHash = w6CatalogMasterDetailChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, \`${'${panel.func}'}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access/W5.4/W5.5/W5.6/W6.2 delta\`)`
  const newChain = `    const w6CatalogMasterDetailChange = w6CatalogMasterDetail?.frontend?.panelReturnChanges?.[panel.func]\n    if (w6CatalogMasterDetailChange) {\n      check(w6CatalogMasterDetailChange.before === expectedPanelHash, \`${'${panel.func}'}: W6.2 Catalog master-detail panel baseline hash mismatch\`)\n      expectedPanelHash = w6CatalogMasterDetailChange.after\n    }\n    const w6CatalogPolishChange = w6CatalogPolish?.frontend?.panelReturnChanges?.[panel.func]\n    if (w6CatalogPolishChange) {\n      check(w6CatalogPolishChange.before === expectedPanelHash, \`${'${panel.func}'}: W6.3 Catalog polish panel baseline hash mismatch\`)\n      expectedPanelHash = w6CatalogPolishChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, \`${'${panel.func}'}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access/W5.4/W5.5/W5.6/W6.2/W6.3 delta\`)`
  preservation = replaceOnce(preservation, oldChain, newChain, '1906B W6.3 panel delta chain')
  fs.writeFileSync(preservationPath, preservation)
}

const manifest = {
  version: 1,
  revision: 'w6-3-catalog-polish',
  frontend: {
    panelReturnChanges: {
      renderInventoryCatalogPanel: {
        before: beforeHash,
        after: afterHash,
      },
    },
  },
}
fs.writeFileSync('scripts/w6-3-catalog-polish-frontend-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

const docs = `# W6.3 — Catalog polish / acceptance\n\nDate: 2026-09-06\nBase Production/main: \`9c6bdb3ecd650d70030f714844712f417a080dd4\` (W6.2)\n\n## Goal\n\nKeep the accepted W6.2 master/detail model, but remove the remaining database-shaped presentation from high-variant products.\n\nHuman browse hierarchy becomes:\n\n\`Товар → Исполнение → Цвет → Размер/возраст\`\n\nExact \`variant_id\` remains authoritative and every size tile still edits exactly one variant.\n\n## UX changes\n\n- Equal colors are grouped instead of repeated once per SKU.\n- Gender and adult/child are subgroups only when they carry real meaning.\n- Size/age is the primary scannable element; physical quantity is secondary but clearly visible.\n- Positive stock is easier to find; zero-stock variants remain visible but quieter.\n- Repeated per-SKU «Править» buttons are removed: the exact size tile is the edit action.\n- Execution summaries become human (colors + size/age range) instead of only «57 вариантов».\n- Detail results now respect Adult/Child and characteristic search. If the product name itself matches the query, its full filtered assortment remains visible.\n- The editor keeps the originally selected product even if the user changes search/filter and temporarily hides it.\n- Result counts use correct Russian pluralization. Global totals are explicitly labelled «Всего», while «без вариантов» remains visibly actionable.\n- «+ Новый товар» moves into the working search/filter toolbar and becomes easier to discover.\n\n## Future pricing readiness\n\nNo price schema is introduced in W6.3. The UI is deliberately prepared for a later commercial layer without another catalogue redesign:\n\n- product header has \`catalog-product-commercial-anchor\`;\n- execution header has \`catalog-execution-commercial-anchor\` and a stable execution key (material + length);\n- every exact size tile has \`catalog-variant-commercial-anchor\` and its exact \`data-variant-id\`.\n\nThis permits future prices at product, execution, or exact-variant level. A base product price can live in the product header; execution-specific prices can sit beside execution stock; a rare exact-variant override can live inside the size tile. The physical catalogue hierarchy and SKU identity do not need to change.\n\nImportant: W6.3 does not assume which level will become authoritative for price. That business rule must be designed separately when pricing is implemented.\n\n## Safety\n\n- no migration;\n- no Production D1 read/write;\n- no price data or pricing semantics introduced;\n- no product/variant identity rewrite;\n- no stock/reserve math change;\n- existing Catalog save paths reused;\n- STANDARD remains valid stored data;\n- Arrival remains frozen;\n- Branch2 untouched.\n\n## Acceptance targets\n\nValidate especially on:\n- a 50+ variant product;\n- one-variant product;\n- no-variant product;\n- mixed adult/child;\n- multiple material/length executions;\n- search by color/material/size;\n- desktop ~1690×900 and 1366×768;\n- mobile 390–430 px.\n`
fs.writeFileSync('docs/continuation/W6_3_CATALOG_POLISH_20260906.md', docs)

console.log(`W6.3 Catalog polish applied; preservation ${beforeHash} -> ${afterHash}`)
