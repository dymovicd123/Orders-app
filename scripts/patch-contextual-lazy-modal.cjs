const fs = require('fs')

const replaceOnce = (text, before, after, label) => {
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected one anchor, got ${count}`)
  return text.replace(before, after)
}

let app = fs.readFileSync('src/App.tsx', 'utf8')
app = replaceOnce(
  app,
  "import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'",
  "import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'",
  'React Suspense import',
)
app = replaceOnce(
  app,
  "import { DashboardSection, ClientsSection, ReferencesSection, InventorySection, WorkshopSection, OrdersHeaderSection, OrderFiltersSection, CreateOrderSection, OrderEditorSection, OrdersTableSection, OrderDetailsSection, OrderDebtSection, OrderReturnsSection, OrderExchangeSection, TeamSection, LeadsSection, PlanSection, FinanceSection, ReportsSection, OrderActivitySection, DeferredSection } from './app/lazySections'",
  "import { DashboardSection, ClientsSection, ReferencesSection, InventorySection, WorkshopSection, OrdersHeaderSection, OrderFiltersSection, CreateOrderSection, OrderEditorSection, OrdersTableSection, OrderDetailsSection, OrderDebtSection, OrderReturnsSection, OrderExchangeSection, TeamSection, LeadsSection, PlanSection, FinanceSection, ReportsSection, OrderActivitySection, OrderCatalogResolutionModal, DeferredSection } from './app/lazySections'",
  'lazy section modal import',
)
app = replaceOnce(app, "import { OrderCatalogResolutionModal } from './features/orders/OrderCatalogResolutionModal'\n", '', 'remove static modal import')
const modal = `      <OrderCatalogResolutionModal
        order={orderCatalogResolutionOrder}
        apiFetch={apiFetch}
        isAdmin={isAdmin}
        onClose={() => setOrderCatalogResolutionOrder(null)}
        onCompleted={async (resolvedOrder: OrderRecord) => {
          setOrderCatalogResolutionOrder(null)
          setMessage(\`Все товары заказа \${resolvedOrder.external_id || \`#\${resolvedOrder.id}\`} уточнены. Нажмите «Отправить клиенту» ещё раз — система повторно проверит склад.\`)
          await loadDashboard(false)
        }}
        onOpenFullReview={async (blockedOrder: OrderRecord) => {
          setOrderCatalogResolutionOrder(null)
          await loadCatalogReview(true, blockedOrder.id)
          setActiveSector('inventory')
          openInventoryPanel('catalog')
          setMessage('Открыт полный разбор только этого заказа. Используйте его, если нужной комбинации ещё нет в каталоге.')
        }}
      />`
const oldModal = modal
  .replace('(resolvedOrder: OrderRecord)', '(resolvedOrder)')
  .replace('(blockedOrder: OrderRecord)', '(blockedOrder)')
app = replaceOnce(app, oldModal, `      <Suspense fallback={null}>\n${modal}\n      </Suspense>`, 'modal Suspense boundary')
fs.writeFileSync('src/App.tsx', app)

let lazy = fs.readFileSync('src/app/lazySections.tsx', 'utf8')
lazy = replaceOnce(
  lazy,
  "export const OrderActivitySection = namedLazy(() => import('../features/sections/OrderActivitySection'), 'OrderActivitySection')\n",
  "export const OrderActivitySection = namedLazy(() => import('../features/sections/OrderActivitySection'), 'OrderActivitySection')\nexport const OrderCatalogResolutionModal = namedLazy(() => import('../features/orders/OrderCatalogResolutionModal'), 'OrderCatalogResolutionModal')\n",
  'lazy modal export',
)
fs.writeFileSync('src/app/lazySections.tsx', lazy)

let focused = fs.readFileSync('scripts/test-contextual-catalog-resolution-r1.mjs', 'utf8')
focused = replaceOnce(
  focused,
  "  const modal = read('src/features/orders/OrderCatalogResolutionModal.tsx')\n",
  "  const modal = read('src/features/orders/OrderCatalogResolutionModal.tsx')\n  const lazySections = read('src/app/lazySections.tsx')\n",
  'focused lazy sections read',
)
focused = replaceOnce(
  focused,
  "  check(app.includes('OrderCatalogResolutionModal'), 'Orders UI must render the contextual resolver')\n",
  "  check(app.includes('OrderCatalogResolutionModal'), 'Orders UI must render the contextual resolver')\n  check(!app.includes(\"from './features/orders/OrderCatalogResolutionModal'\"), 'Contextual resolver must not regrow the initial static source graph')\n  check(lazySections.includes(\"import('../features/orders/OrderCatalogResolutionModal')\"), 'Contextual resolver must load through the established lazy feature boundary')\n",
  'focused lazy boundary guards',
)
fs.writeFileSync('scripts/test-contextual-catalog-resolution-r1.mjs', focused)

console.log('Contextual resolver moved behind lazy boundary')
