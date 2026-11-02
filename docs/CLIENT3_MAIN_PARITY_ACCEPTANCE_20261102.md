# Client3 exact Main functional parity — acceptance criteria (2026-11-02)

Client3 is the watches-only tenant. **Do not describe it as a completed clone of Main.** Its visible layouts borrowed class names from Main, but functionality is materially narrower. Main and Branch2 must not be changed to implement these items. This is a checkable backlog, not a claim that the gaps have been fixed.

## Verified shipped in Client3
- Main's core order, reservation and money writer is reused for one watch line.
- Multiple payment rows can be entered on one new order and reach the Main financial ledger as distinct records (split payments).
- General client-wide references for leather strap colors, payment and delivery with admin creation; TAUWACH/WACHIZEN have separate physical stock and sales.
- Engraving-ready confirmation belongs to the logist, actual shipping to an authorized manager/admin in Logistics.

## Stage P1: Real Main Orders list and editor (NOT DONE)
Source of truth: `src/features/sections/OrdersTableSection.tsx`, `src/features/sections/CreateOrderSection.tsx`, `worker/domains/orders-write.ts`. Current watches façade: `src/features/client3/WatchOrdersPanel.tsx`, `src/features/client3/WatchOrderForm.tsx`.
- Preserve Main table columns, controls, dense layout, search/filter and per-order actions. Reuse Main view-model helpers rather than copying isolated class names.
- Full order edit (delivery/client/phone/manager/price/order lines where permitted), debt closure, corrections, legal deletion with consequences and auditable changes.
- Multiple watch models/variants in one order, with item-specific engraving and brand identity. Current Main critical write explicitly refuses `normalizedItems.length !== 1` when a `watchCommit` exists. Replace the one-item attachment with per-item mapping and idempotent writes *before* showing a multi-line form.
- Ensure details show all items and all actual payment rows. The expanded ledger work began on `client3/order-ledger-main-parity-20261102`; read-only additions must be verified and released separately.
- No silent divergence between table status and Logistics dispatch.

## Stage P2: Logistics, selective shipment (NOT DONE)
Sources: `OrdersTableSection.tsx` shipment view and `src/features/orders/shippingSelection.ts`, dispatch engine in `worker/domains`. Client3 shipping currently full-order-oriented.
- Logistics owns preparation, engraving and shipment. Each item is selectable with quantity, accurate “Отправлен/Не отправлен”, and partial shipment at order level. Cannot accidentally reship.
- Support clarification/correction of issuance with stock movements and reservations preserving identity and audit; avoid cargo-cult replication of Main's button labels.
- The logist can confirm engraving readiness only; manager/admin confirms actual shipment.

## Stage P3: Resolver, returns and exchanges (NOT DONE)
- Deterministic exact watch variant lookup: model + brand + gender + movement + bracelet + dial color + strap color, no ignored characteristics. Advisor only when identity ambiguous.
- Return/exchange actions work on chosen lines, not just `lineCount===1`; partial returns leave unrelated lines actionable. Physical receipt must never be inferred from a monetary refund.
- Reuse relevant Main lifecycle/stock handlers instead of new pseudo-ledgers. Preserve older sales, and tenant-only authorization.

## Stage P4: Warehouse & catalog references (PARTIAL)
- Keep brand selection visible before physical movements, and check each source's actual free stock.
- Restore detailed Main-like inventory history, selective counting, correction, SKU identity, and readable stock operations.
- Shared references are not equivalent to arbitrary enum extension. Currently gender/movement/bracelet/dial-color schema checks require a safe migration and matching resolver before adding new values. Never show an editable field that cannot be persisted.
- Required watch fields: model name; male/female; no clothing sizes or lengths; color; bracelet steel/leather/rubber; separate price by catalog and sale.

## Nonnegotiable release gates
- All test writes are initially against disposable SQLite or dedicated third environment. No migrations against Main/Branch2.
- For deployed third D1, preserve existing orders, payments, users, watch variants, stock and reservations. Check owner admin stays enabled.
- Real authenticated browser QA: desktop/mobile screenshots, creation, split payment display, two brands, return, exchange, engraving, physical shipment, partial shipment and history. SSR and grep tests alone are not enough to assert UX parity.
- Change to stage status only after the actual workflow is released and tested; record exact successful GitHub Actions run and verified third-only release.
