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


export function renderInventoryBoutiquePanel(ctx: PanelContext) {
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
    <div className="inventory-source-panel" style={inventoryPanelStyle('boutique')}>
                    <div className="inventory-panel-headline">
                      <div>
                        <h3>Остатки бутика</h3>
                        <p>Бутик — отдельная точка остатков внутри общего склада. Заказы из бутика списывают только отсюда.</p>
                      </div>
                      <button className="secondary compact" type="button" onClick={() => void loadInventoryData('boutique', true, '')}>Обновить бутик</button>
                    </div>
                    <div className="summary-grid inventory-summary-grid">
                      <div className="summary-card"><span>Единиц</span><strong>{formatMoney(inventoryStats.boutique.totalUnits)}</strong></div>
                      <div className="summary-card"><span>Товаров</span><strong>{inventoryStats.boutique.products}</strong></div>
                      <div className="summary-card"><span>Вариантов</span><strong>{inventoryStats.boutique.variants}</strong></div>
                      <div className="summary-card danger-card"><span>Минус</span><strong>{inventoryStats.boutique.negativeCount}</strong></div>
                      <div className="summary-card warning-card"><span>Ноль</span><strong>{inventoryStats.boutique.zeroCount}</strong></div>
                    </div>
                    <div className="inventory-filter-line">
                      <span>Найдено товаров: <b>{groupedInventoryRows.boutique.length}</b></span>
                      <span>Вариантов в выборке: <b>{filteredInventoryRows.boutique.length}</b></span>
                      <span>Бутик использует тот же каталог, но отдельные остатки.</span>
                    </div>
                    <div className="inventory-product-groups">
                      {renderInventoryStockGroups('boutique', groupedInventoryRows.boutique)}
                    </div>
                  </div>
  )
}
