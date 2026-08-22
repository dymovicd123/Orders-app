import type { InventoryRenderContext } from './types'

type PanelContext = Pick<InventoryRenderContext,
  | 'SmartPickerInput'
  | 'inventoryCategoryFilter'
  | 'inventoryPanel'
  | 'inventoryPickerOptions'
  | 'inventoryQuery'
  | 'inventoryQuickFilters'
  | 'inventorySortMode'
  | 'inventoryStatusFilter'
  | 'openInventoryPanel'
  | 'refreshInventoryModule'
  | 'setInventoryCategoryFilter'
  | 'setInventoryQuery'
  | 'setInventoryQuickFilters'
  | 'setInventorySortMode'
  | 'setInventoryStatusFilter'
>

import type { InventoryCategoryFilter, InventoryStatusFilter, InventorySortMode } from '../../../app/types'

export function renderInventorySourceToolbar(ctx: PanelContext) {
  const {
    SmartPickerInput,
    inventoryCategoryFilter,
    inventoryPanel,
    inventoryPickerOptions,
    inventoryQuery,
    inventoryQuickFilters,
    inventorySortMode,
    inventoryStatusFilter,
    openInventoryPanel,
    refreshInventoryModule,
    setInventoryCategoryFilter,
    setInventoryQuery,
    setInventoryQuickFilters,
    setInventorySortMode,
    setInventoryStatusFilter
  } = ctx

  return (
    (inventoryPanel === 'warehouse' || inventoryPanel === 'boutique') ? (
                  <div className="inventory-toolbar unified-inventory-toolbar structured-inventory-toolbar inventory-picker-toolbar">
                    <div className="inventory-advanced-source-switch">
                      <span>Точка</span>
                      <div>
                        <button className={`secondary compact ${inventoryPanel === 'warehouse' ? 'is-active' : ''}`} type="button" onClick={() => openInventoryPanel('warehouse')}>Склад</button>
                        <button className={`secondary compact ${inventoryPanel === 'boutique' ? 'is-active' : ''}`} type="button" onClick={() => openInventoryPanel('boutique')}>Бутик</button>
                      </div>
                    </div>
                    <div className="inventory-picker-field inventory-search wide-field">
                      <span>Товар</span>
                      <SmartPickerInput
                        value={inventoryQuery}
                        options={inventoryPickerOptions.products}
                        placeholder="Выберите товар или начните вводить"
                        onChange={(value) => {
                          setInventoryQuery(value)
                          setInventoryQuickFilters({ gender: '', color: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', size: '' })
                        }}
                        ariaLabel="Товар для поиска по остаткам"
                      />
                    </div>
                    {([
                      ['gender', 'Пол', inventoryPickerOptions.genders],
                      ['material', 'Материал', inventoryPickerOptions.materials],
                      ['length', 'Длина', inventoryPickerOptions.lengths],
                      ['color', 'Цвет', inventoryPickerOptions.colors],
                      ['size', 'Размер / возраст', inventoryPickerOptions.sizes],
                    ] as Array<[keyof typeof inventoryQuickFilters, string, string[]]>).map(([field, label, options]) => (
                      <div className="inventory-picker-field" key={`inventory-quick-${String(field)}`}>
                        <span>{label}</span>
                        <SmartPickerInput
                          value={inventoryQuickFilters[field]}
                          options={options}
                          placeholder="Все"
                          onChange={(value) => setInventoryQuickFilters((current) => ({ ...current, [field]: value }))}
                          ariaLabel={`${label} для фильтра остатков`}
                        />
                      </div>
                    ))}
                    <label className="inventory-picker-field native-picker-field">
                      <span>Тип</span>
                      <select value={inventoryCategoryFilter} onChange={(event) => setInventoryCategoryFilter(event.target.value as InventoryCategoryFilter)}>
                        <option value="all">Все товары</option>
                        <option value="adult">Взрослые</option>
                        <option value="child">Детские</option>
                      </select>
                    </label>
                    <label className="inventory-picker-field native-picker-field">
                      <span>Остаток</span>
                      <select value={inventoryStatusFilter} onChange={(event) => setInventoryStatusFilter(event.target.value as InventoryStatusFilter)}>
                        <option value="all">Все</option>
                        <option value="positive">В наличии</option>
                        <option value="zero">Нулевые</option>
                        <option value="negative">Минусовые</option>
                      </select>
                    </label>
                    <label className="inventory-picker-field native-picker-field">
                      <span>Сортировка</span>
                      <select value={inventorySortMode} onChange={(event) => setInventorySortMode(event.target.value as InventorySortMode)}>
                        <option value="name">По названию</option>
                        <option value="quantityDesc">Больше остаток</option>
                        <option value="quantityAsc">Меньше остаток</option>
                        <option value="updated">Недавно менялись</option>
                      </select>
                    </label>
                    <div className="inventory-toolbar-actions">
                      <button className="secondary compact" type="button" onClick={() => {
                        setInventoryQuery('')
                        setInventoryQuickFilters({ gender: '', color: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', size: '' })
                        setInventoryCategoryFilter('all')
                        setInventoryStatusFilter('all')
                      }}>Сбросить</button>
                      <button className="primary compact" type="button" onClick={() => void refreshInventoryModule(true)}>Обновить всё</button>
                    </div>
                  </div>
        
                  ) : null
  )
}
