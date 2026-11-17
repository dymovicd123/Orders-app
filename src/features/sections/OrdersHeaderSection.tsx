// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrdersHeaderSection({ ctx }: { ctx: SectionContext }) {
  const {
    kaspiMode = false,
    orderPanel,
    orderPanelOptions,
    sectorStyle,
    setEditorOpen,
    setOrderPanel,
    workspaceSector = 'orders',
  } = ctx

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
            </button>
          ))}
        </div>
      )}
    </article>
  )
}
