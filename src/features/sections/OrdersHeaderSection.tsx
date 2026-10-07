// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrdersHeaderSection({ ctx }: { ctx: SectionContext }) {
  const {
    kaspiMode = false,
    openKaspiCreate,
    orderPanel,
    orderPanelOptions,
    returnHistorySummary,
    exchangeHistorySummary,
    sectorStyle,
    setEditorOpen,
    setOrderPanel,
    workspaceSector = 'orders',
  } = ctx

  return (
    <article className={`card wide sector-${workspaceSector} orders-workspace-header`} id={kaspiMode ? 'kaspi-orders-tabs' : 'orders-tabs'} style={sectorStyle(workspaceSector)}>
      {kaspiMode ? (
        <div className="order-panel-tabs" role="tablist" aria-label="Разделы Kaspi">
          <button
            className={`secondary compact ${orderPanel === 'zammler' ? 'is-active' : ''}`}
            type="button"
            onClick={openKaspiCreate}
          >
            Создать заказ
          </button>
          <button
            className={`secondary compact ${orderPanel === 'list' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setOrderPanel('list')}
          >
            Kaspi-заказы
          </button>
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
    </article>
  )
}
