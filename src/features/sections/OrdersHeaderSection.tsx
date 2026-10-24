// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import '../../styles/order-stock-attention-banner.css'
type SectionContext = Record<string, any>

export function OrdersHeaderSection({ ctx }: { ctx: SectionContext }) {
  const {
    kaspiMode = false,
    orderPanel,
    orderPanelOptions,
    returnHistorySummary,
    exchangeHistorySummary,
    warehouseAttention,
    openInventoryStockAttention,
    sectorStyle,
    setEditorOpen,
    setOrderPanel,
    workspaceSector = 'orders',
  } = ctx

  const shortageCount = Math.max(0, Number(warehouseAttention?.counts?.shortage || 0))
  const shippedCount = Math.max(0, Number(warehouseAttention?.counts?.shippedUntracked || 0))
  const stockConcerns = shortageCount + shippedCount

  return (
    <article className={`card wide sector-${workspaceSector} orders-workspace-header`} id={kaspiMode ? 'kaspi-orders-tabs' : 'orders-tabs'} style={sectorStyle(workspaceSector)}>
      {kaspiMode ? (
        <div className="order-panel-tabs" role="tablist" aria-label="Раздел Kaspi">
          <span className="soft-badge">Заказы Kaspi магазина · создаются через общий раздел «Заказы»</span>
        </div>
      ) : (
        <div className="order-panel-tabs" role="tablist" aria-label="Разделы заказов">
          {orderPanelOptions.map((panel) => (
            <button
              key={panel.kind}
              className={`secondary compact ${orderPanel === panel.kind ? 'is-active' : ''}`}
              type="button"
              onClick={() => {
                setOrderPanel(panel.kind)
                if (panel.kind !== 'list') setEditorOpen(false)
              }}
              title={panel.help}
            >
              {panel.label}
              {panel.kind === 'returns' && Number(returnHistorySummary?.pendingPhysicalQuantity || 0) > 0 ? <b className="order-tab-attention">{returnHistorySummary.pendingPhysicalQuantity}</b> : null}
              {panel.kind === 'exchange' && Number(exchangeHistorySummary?.pendingPhysicalQuantity || 0) > 0 ? <b className="order-tab-attention">{exchangeHistorySummary.pendingPhysicalQuantity}</b> : null}
            </button>
          ))}
        </div>
      )}
      {!kaspiMode && stockConcerns > 0 ? (
        <div className="orders-stock-attention" role="status" aria-label="Складские случаи для проверки">
          <div className="orders-stock-attention-content">
            <strong>Проверить складской учёт</strong>
            <div className="orders-stock-attention-counts">
              {shortageCount > 0 ? <span><b>{shortageCount}</b> {shortageCount === 1 ? 'случай' : 'случаев'} нехватки по активным заказам</span> : null}
              {shippedCount > 0 ? <span><b>{shippedCount}</b> {shippedCount === 1 ? 'случай' : 'случаев'} при уже выполненной отправке</span> : null}
            </div>
          </div>
          <button className="secondary compact" type="button" onClick={openInventoryStockAttention}>Открыть случаи и действия →</button>
        </div>
      ) : null}
    </article>
  )
}
