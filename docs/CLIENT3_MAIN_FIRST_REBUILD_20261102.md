
# Client3: Main-first reconstruction and acceptance

Date: 2026-11-02. Scope: isolated third watch system only. Main and Branch2 are never deployment targets.

## Root cause
The user requested the working Main product with only watch-specific changes. Previous implementations copied shell CSS and selected component names, while still independently implementing the screens and workflows. The visual similarity concealed missing Main features, workflow separation and poor UX. Main contains an approximately 9k-line App.tsx controller plus dedicated Section modules, so pasting App.tsx alone would bind third-tenant screens to clothing APIs. The valid approach is to retain actual Main Section markup, interactions, styles and controls and supply safe Client3-specific data adapters.

## Authoritative code
- Main UI: src/App.tsx, src/app/constants.ts, src/features/sections, src/features/inventory/views, src/components and Main styles.
- Brand and SKU domain: shared/client3/watch-domain.ts, worker/domains/client3-watches.ts, worker/domains/client3-watch-*.ts.
- Client3 DB: orders_db_client3_old_client (UUID 0717f239-6d81-4837-8586-777d94e22c53). Never access Main/Branch2 D1 or unscoped clothing mutation endpoints.

## Screen mapping and remaining gaps
1. App shell: original Main sidebar/topbar, styles and mobile navigation already reused; side-by-side browser visual QA not yet conducted.
2. Warehouse brand context: TAUWACH and WACHIZEN must be prominent separate operational workspaces. Implemented large warehouse brand switch instead of an inconspicuous select.
3. Warehouse stock: Main stock-v13 master/detail; office/showcase, physical/reserved/free by watch SKU. Detail and inventory history not yet full Main parity.
4. Warehouse catalog: Main w6 catalog master/detail; watch model/SKU/price. Complete product edit/retirement and bulk SKU support not yet at Main parity.
5. Warehouse operations: Main StocktakeSharedInputs and staged confirm on brand-scoped endpoints. Single-SKU transactions; Main multi-product batch is absent.
6. Warehouse selective/full check, history, statistics: full sections missing. Do not insert fake working tabs.
7. Orders creation: Main four sections and brand -> source -> available watch SKU; recipient/Kazpost/address/deadline, engraving, price and money. Multiple line items and multiple payments NOT YET supported like Main.
8. Orders list: sale register, finance/debts, exchange/returns; shipping action moved out to Logistics. Actual Main OrdersTableSection full parity still missing.
9. Logistics: adapt original Main WorkshopSection task tabs and order-like table, not workshop salary. Contains brand queues, urgency, exact send cutoff, recipient/address, engraving text, two *independent* mutations: engraving ready vs actual physical dispatch. The server still limits actual dispatch to managers/admin; logist employee can mark engraving done. Do not weaken authority unintentionally.
10. References: separate actual navigation route from Main, category grid/value lists for watch brands/sources/gender/mechanism/bracelet/dial/leather strap colors/payment/delivery; NOT a redirect to Warehouse. Currently fixed server enum choices are read-only and clearly labeled. Full editable reference CRUD requires deliberate server/domain changes, not a fake Save control.
11. Finance/team: brand-specific watch UI, not full Main parity. Clients/leads/plans/reports deferred by the user to finish core modules first.

## Operator workflow
- Register TAUWACH and WACHIZEN models separately in Warehouse > Products, and make physical arrivals into Office/Showcase separately.
- Create an order: choose brand first; then source, then physically available SKU. Keep received money, debt and recipient data.
- Sales orders table remains the record for payments, debt, returns/exchange. It links to Logistics for preparation/shipping.
- Logistics owns work queue. Engraving completion NEVER ships goods or changes money. Physical send requires explicit separate confirmation and calls the existing idempotent brand-scoped dispatch endpoint. Do not expose shipment to unauthorized role.
- Both brands must be independently scoped by backend DB membership, not merely client-side filters.

## Release acceptance, NOT merely class-name matching
- Match Main's rendered page geometry side-by-side at desktop and mobile widths for Stock, Catalog, Operations, Create Order, Orders, Logistics and References.
- Test at least one admin and one manager role under each brand. Make no cross-brand leaks.
- Test 2-brand stock, reservation, dispatch, returns, exchange and idempotent retry on disposable D1. Confirm existing historical orders and monitoring admin survive rollout.
- No claims that full Main parity is finished without real logged-in browser QA. This branch has structural/unit/SSR/stock/order tests, but browser-authenticated parity remains pending.
