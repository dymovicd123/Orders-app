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

  const stockConcerns = Number(warehouseAttention?.counts?.shortage || 0)

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
        <div className="orders-stock-attention" role="status">
          <div>
            <strong>Проверить остатки: {stockConcerns} вариантов</strong>
            <span>Есть активные резервы сверх учтённого остатка. Это не ошибка каталога и не повод запускать Resolver.</span>
          </div>
          <button className="secondary compact" type="button" onClick={openInventoryStockAttention}>Посмотреть заказы и действия</button>
        </div>
      ) : null}
    </article>
  )
}
