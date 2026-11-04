# Client3 — Main-order lifecycle rebuild (2026-11-04)
Source: `client3/lifecycle-main-rebuild-20261104`
Review: https://github.com/dymovicd123/Orders-app/pull/787

## Implemented and automatically verified
1. Shared canonical item identity and exact dispatch, historical return, exchange and pending physical-intake quantities in orders and logistics.
2. Main-like orders table/detail/actions. Manager and admin editors, original payment ledger, historical SKU characteristics, visible action access. Return/exchange history and cancellation use Main's business engines with Client3 brand checks.
3. Standalone returns: select specific physically issued watches, record physical intake separately, money refunded independently, confirm destination; replay-safe actions. A return may be processed while other items remain operable.
4. Exchange Set V2: several old and new SKU lines, issued vs unsent physical state, linked intake and replacements, payment/refund splits, cancellation and safeguards against undoing actually sent replacements.
5. Logistics: partial dispatch, readiness and engraving, return/replacement statuses per watch, pending intake counts, brand-preserving navigation to actual receiving queue, post-arrival reservation retry. A legacy order-wide sent flag never supersedes unshipped replacement quantities.
6. Client3 commercial accounting: each standalone returned watch records its frozen sales-value snapshot in `return_items.amount`; the Main original `orders.total_amount` and dispatch/payment history stay immutable. Client3 derives:
   - **gross sale** = Main original itemized total;
   - **returned goods credit** = active standalone return item sales value, excluding exchange-generated returns;
   - **net commercial sale** = gross sale minus goods credit;
   - **net paid** = received payments minus actual money refunds;
   - **effective debt** = max(0, net sale minus net paid).
   The Client3 payment preflight and Main atomic payment claim use this effective debt; Main Exchange Set V2 uses a noncash returned-goods credit when deriving its next settlement. No fictitious cash movement occurs.
7. Orders/clients/report drilldowns/dashboard/demand statistics read net commercial sales/debts; cash and finance read actual financial events. All source-based variants and both brands remain separated.
8. Real SQLite regression: full order, return of ARYSTAN-like watch and independent exchange of another watch; noncash-credit settlement and two-method money refund; unissued watch exchange; after-arrival stock reservation recovery; one-of-two replacements dispatched while previous return receipt remains pending; cancellation restrictions, role/brand isolation, idempotency.
9. Build/TypeScript and Main-like warehouse, cash, team, catalog and interface checks in GitHub Actions.

## Accounting caveat (intentional)
Main's raw `orders.debt_amount` remains its original historical field. **Do not display or charge against that raw value on Client3.** Client3 uses the derived effective debt from the central `client3-watch-commercial.ts` module. Do not mutate the original sale amount or book a goods credit as money: it would break exchange set lineage and duplicate refunds. Full historical reporting may show original gross alongside effective net.

## Final release gate
- Verify commit-pinned CI success, production Worker/D1 target exact identities, complete migrations (do not apply migrations silently), expected `return_items.amount`, `exchanges.refund_return_id` and watch tables, and clean remote foreign keys.
- Record Cloudflare D1 Time Travel bookmark before touching Worker.
- Deploy **only** the existing production `orders-app-client3-old-client` Worker using `wrangler.jsonc` bound to `orders_db_client3_old_client`. Never deploy to a preview/test Client3, Main or Branch2.
- Live public SPA and anonymous-access-denied API smoke checks; repeat D1 integrity and report business counts. Never auto-restore or delete user data on failure.
- The final authenticated desktop/mobile hands-on walkthrough (especially the exact customer's ARYSTAN/ALTYN ZAMAN order) still requires a user session; automated CI and unauthenticated smoke cannot replace it.

## Source state
This commit remains an isolated release candidate. Once the production Worker rollout is successful, merge/align the implementation back into the stable Client3 source branch to prevent a subsequent stale deployment overwriting these changes.
