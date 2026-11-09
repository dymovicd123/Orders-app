// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrdersHeaderSection({ ctx }: { ctx: SectionContext }) {
  const {
    orderPanel,
    orderPanelOptions,
    returnHistorySummary,
    exchangeHistorySummary,
    sectorStyle,
    setEditorOpen,
    setOrderPanel,
  } = ctx

  return (
    <article className="card wide sector-orders orders-workspace-header" id="orders-tabs" style={sectorStyle('orders')}>
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
    </article>
  )
}
