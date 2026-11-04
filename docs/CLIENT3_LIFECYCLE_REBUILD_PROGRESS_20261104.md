# Client3 lifecycle rebuild — acceptance and remaining debt semantics
Date: 2026-11-04
Branch: `client3/lifecycle-main-rebuild-20261104`
Draft PR: https://github.com/dymovicd123/Orders-app/pull/787

## Status (isolated only; no deployment)
- Canonical exact per-SKU quantities for dispatches, standalone returns, pending physical intake and exchange-old intake.
- Main Exchange Set V2 with watch brand/variant identity, history, idempotent return/exchange reversal and a guard against reversing an actually sent replacement.
- Late stock arrival can activate a genuine pending exchange replacement reservation even on a legacy sent-status order, with Main's atomic stock claim. No physical quantity is created by retry.
- An unsent watch can be replaced with `physicalState='not_issued'`. It must not enter the client-return intake queue. An already issued watch cannot be passed off as unissued.
- The return form no longer proposes refunding all money paid when only one lower-priced item is returned. It suggests selected item's price and makes financial ledger limitations explicit.
- Main/Branch2 and live Client3 D1 have NOT been modified by this branch.

## Important unresolved commercial invariant
Main's standalone `createReturn()` registers independently:
1. Physical item return (`return_items`) without reducing `order_items.quantity` or its `line_total`.
2. Refund of money (`returns.amount`, split `financial_events`) without automatically changing `orders.total_amount`.
3. The recorded outstanding debt is calculated using the sale total and received payments, rather than the returned money.

Therefore a Client3 standalone physical return does **not yet** reduce commercial sales value or recorded debt. The UI must not claim otherwise. This is not resolved by a smaller suggested refund or a cosmetic net-sales display.

## Required implementation of commercial return settlement (next separate atomic package)
1. Explicit policy: distinguish a commercial cancellation of selected sold units from a money-only goodwill refund, a warranty/temporary intake and exchange-related returns. Never assume every physical receipt cancels a sale.
2. Persist a per-operation settlement row with unique `return_id`, `order_item_id`, settled units, unit sale price at the time, original order item quantity/total, and one immutable reversal lineage. Protect against duplicate settlement and subsequent line/exchange changes.
3. In an atomic transaction, reconcile active item composition and order commercial total with the settled units while retaining the returned items' historical SKU links and original dispatch references. Keep `total_amount == SUM(active line_total)` where Main Exchange Set V2 requires it.
4. Update financial ledger debt using a documented net-receipt policy; avoid subtracting refunded money both from current payment and debt, or inventing a cash receipt. Separate `sale value`, `received`, `refunded`, `net paid`, `remaining debt` in the read model.
5. Enhance `cancelReturn()` for Client3 to undo commercial settlement exactly once, including dependencies and current-price conflicts, without resurrecting already exchanged or physically shipped stock.
6. Reconcile reports, plans, cash, finance-day drilldowns and downstream exchanges against commercial settlement, not presentation-only columns.
7. Protect asynchronous/retried requests with critical-operation idempotency, a stale-snapshot check, and transactionally verified remaining quantities; never overstate physical stock.

## Acceptance cases
- ARYSTAN originally sent, return 1 pending physical receipt, ALTYN ZAMAN unshipped: ALTYN ZAMAN remains editable/exchangeable/dispatchable while ARYSTAN remains a historical item with precise intake state.
- Client pays partially; returns an issued item: commercial sale value/debt decrease only on explicit commercial settlement, refund cash reflects the actual amount/method separately, and obligations cannot become negative by accident.
- Item-only return of one among several units, repeated request and cancellation, and later exchange of the remaining line.
- Money-only return changes financial events but not physical inventory or sale composition.
- Two-brand isolation, unissued watch exchange, partial dispatch, short-stock replacement, arrival/recovery, downstream returns, and strict prevention of cancelling a replacement that has already shipped.
- UI parity with actual Main components (not just approximate CSS) remains outstanding for the full Orders/Returns/Exchange surface; browser E2E on isolated Client3 must precede any release.

## Release control
PR remains draft. No merge, no production D1 migration and no Client3 deployment until commercial model and key browser flows are accepted.
