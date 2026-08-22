import type { InventoryRenderContext } from './types'

type PanelContext = Pick<InventoryRenderContext,
  | 'filteredInventoryRows'
  | 'formatMoney'
  | 'groupedInventoryRows'
  | 'inventoryPanelStyle'
  | 'inventoryStats'
  | 'loadInventoryData'
  | 'renderInventoryStockGroups'
>


export function renderInventoryWarehousePanel(ctx: PanelContext) {
  const {
    filteredInventoryRows,
    formatMoney,
    groupedInventoryRows,
    inventoryPanelStyle,
    inventoryStats,
    loadInventoryData,
    renderInventoryStockGroups
  } = ctx

  return (
    <div className="inventory-source-panel" style={inventoryPanelStyle('warehouse')}>
                    <div className="inventory-panel-headline">
                      <div>
                        <h3>Остатки склада</h3>
                        <p>Технический расширенный просмотр. Для ежедневной работы используйте «Остатки»: там отдельно показаны товары на месте, в заказах и свободный остаток.</p>
                      </div>
                      <button className="secondary compact" type="button" onClick={() => void loadInventoryData('warehouse', true, '')}>Обновить склад</button>
                    </div>
                    <div className="summary-grid inventory-summary-grid">
                      <div className="summary-card"><span>Единиц</span><strong>{formatMoney(inventoryStats.warehouse.totalUnits)}</strong></div>
                      <div className="summary-card"><span>Товаров</span><strong>{inventoryStats.warehouse.products}</strong></div>
                      <div className="summary-card"><span>Вариантов</span><strong>{inventoryStats.warehouse.variants}</strong></div>
                      <div className="summary-card danger-card"><span>Минус</span><strong>{inventoryStats.warehouse.negativeCount}</strong></div>
                      <div className="summary-card warning-card"><span>Ноль</span><strong>{inventoryStats.warehouse.zeroCount}</strong></div>
                    </div>
                    <div className="inventory-filter-line">
                      <span>Найдено товаров: <b>{groupedInventoryRows.warehouse.length}</b></span>
                      <span>Вариантов в выборке: <b>{filteredInventoryRows.warehouse.length}</b></span>
                      <span>Выберите товар и характеристики из списков. Ручной ввод тоже понимает похожие казахские и русские буквы.</span>
                    </div>
                    <div className="inventory-product-groups">
                      {renderInventoryStockGroups('warehouse', groupedInventoryRows.warehouse)}
                    </div>
                  </div>
  )
}
