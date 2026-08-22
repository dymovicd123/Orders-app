import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react'

function namedLazy(loader: () => Promise<unknown>, exportName: string) {
  return lazy(async () => {
    const module = await loader() as Record<string, ComponentType<any>>
    return { default: module[exportName] }
  })
}

export const DashboardSection = namedLazy(() => import('../features/sections/DashboardSection'), 'DashboardSection')
export const ClientsSection = namedLazy(() => import('../features/sections/ClientsSection'), 'ClientsSection')
export const ReferencesSection = namedLazy(() => import('../features/sections/ReferencesSection'), 'ReferencesSection')
export const InventorySection = namedLazy(() => import('../features/sections/InventorySection'), 'InventorySection')
export const WorkshopSection = namedLazy(() => import('../features/sections/WorkshopSection'), 'WorkshopSection')
export const OrdersHeaderSection = namedLazy(() => import('../features/sections/OrdersHeaderSection'), 'OrdersHeaderSection')
export const OrderFiltersSection = namedLazy(() => import('../features/sections/OrderFiltersSection'), 'OrderFiltersSection')
export const CreateOrderSection = namedLazy(() => import('../features/sections/CreateOrderSection'), 'CreateOrderSection')
export const OrderEditorSection = namedLazy(() => import('../features/sections/OrderEditorSection'), 'OrderEditorSection')
export const OrdersTableSection = namedLazy(() => import('../features/sections/OrdersTableSection'), 'OrdersTableSection')
export const OrderDetailsSection = namedLazy(() => import('../features/sections/OrderDetailsSection'), 'OrderDetailsSection')
export const OrderDebtSection = namedLazy(() => import('../features/sections/OrderDebtSection'), 'OrderDebtSection')
export const OrderReturnsSection = namedLazy(() => import('../features/sections/OrderReturnsSection'), 'OrderReturnsSection')
export const OrderExchangeSection = namedLazy(() => import('../features/sections/OrderExchangeSection'), 'OrderExchangeSection')
export const TeamSection = namedLazy(() => import('../features/sections/TeamSection'), 'TeamSection')
export const LeadsSection = namedLazy(() => import('../features/sections/LeadsSection'), 'LeadsSection')
export const PlanSection = namedLazy(() => import('../features/sections/PlanSection'), 'PlanSection')
export const FinanceSection = namedLazy(() => import('../features/sections/FinanceSection'), 'FinanceSection')
export const ReportsSection = namedLazy(() => import('../features/sections/ReportsSection'), 'ReportsSection')
export const OrderActivitySection = namedLazy(() => import('../features/sections/OrderActivitySection'), 'OrderActivitySection')

type DeferredSectionProps = {
  active: boolean
  label: string
  children: ReactNode
}

/**
 * A feature chunk is not rendered (and therefore not requested) until its workflow is opened once.
 * After the first activation it stays mounted, preserving the same local React state users had before 190.6D.
 */
export function DeferredSection({ active, label, children }: DeferredSectionProps) {
  const [activated, setActivated] = useState(active)

  useEffect(() => {
    if (active && !activated) setActivated(true)
  }, [active, activated])

  if (!active && !activated) return null

  return (
    <Suspense
      fallback={active ? (
        <section className="card wide lazy-section-fallback" aria-live="polite" aria-busy="true">
          <div className="card-label">{label}</div>
          <div className="card-meta">Открываю раздел…</div>
        </section>
      ) : null}
    >
      {children}
    </Suspense>
  )
}
