# Operational autonomy audit — 2026-09-10

## Goal

Normal, legitimate business corrections must be executable by staff through the application without developer intervention. Safety should come from explicit correction/reversal workflows, fresh-state validation, audit history, idempotency and role checks — not from leaving a valid business situation with no supported action.

This does **not** mean making physical or financial history mutable without trace. When a fact has already affected stock, cash, returns, exchanges or shipment, the application should provide a safe corrective operation that preserves history instead of silently rewriting it.

## Baseline completed immediately before this audit

PR #31 `Fix safe correction of posted order payments` was squash-merged to `main` as commit `6653e0ab4f438dca6832eb233624faed5a01602a`.

The cumulative GitHub Quality check run `34486738784` completed successfully, including the full release regression gate and application build. The exact main commit was then successfully published by Cloudflare; deploy monitor run `34486914530` completed with `Cloudflare deploy / main = success`.

Posted ordinary payments can now be corrected in place without changing `payment_id`: date, amount, method, semantic kind (`primary` / `debt_close`) and comment. Stale-editor protection, append-only finance reversal/replacement, cash delta correction and request idempotency are retained. Exchange-linked extras remain owned by the exchange operation.

The release also refreshed the cumulative 189C/F5 tests and explicitly registered the accepted Worker/frontend source deltas in the 1906A/1906B structural gates. No schema migration was required.

## Remaining business-autonomy gaps found in current main

> R3 update: A1+A2 are implemented on the current R3 branch with per-order-item remaining quantity. Active standalone returns consume capacity; cancelled returns release it; exchange-linked financial return rows are not double-counted; exchanges consume the same remaining capacity without rewriting prior return history. The structural 1906A delta is explicitly limited to `createReturn`, `createExchange`, and `cancelReturn`; all other Worker declarations remain under the existing cumulative freeze.

### A1 — Multiple legitimate returns on one order are not supported

`createReturn` rejects creation when any non-cancelled return already exists for the order. The current instruction is to cancel the earlier return first.

That is too restrictive for a real order where one item is returned now and another item is returned later. A legitimate completed earlier return should not have to be cancelled merely to record the next return.

Target direction: allow multiple independent returns while enforcing cumulative returned quantity/amount and preventing duplicate return of the same physical quantity.

### A2 — A return and a later exchange cannot coexist naturally

`createExchange` rejects an exchange if the order already has an active standalone return and tells the operator to cancel the return first.

That creates the same problem: a valid earlier return may need to remain true while a different item is exchanged later.

Target direction: return and exchange operations should coexist when their item/quantity and monetary effects do not conflict. Conflict checks should be based on remaining eligible quantities/facts, not the mere existence of another operation.

### A3 — Closing debt after a return is blocked with no ordinary self-service continuation

The safe payment endpoint rejects `debt_close` when the order has a return and says that closing debt after a return is a separate operation. In the current ordinary order workflow there is no clearly exposed alternate payment operation that completes that business case.

Target direction: define the correct post-return outstanding balance and allow a safe payment against that balance, preserving the actual payment date and finance history.

### A4 — Mistaken `sent` / physical-handover fact has an incomplete recovery path

Once an order is marked sent, ordinary order edit refuses to move it back to not-sent and refuses direct item rewrite/delete after physical issue. These guards correctly protect stock truth, but a mistaken shipment/handover needs an explicit correction workflow.

There is already a special safe reassessment path when deleting a falsely marked sent order, and return/exchange/correction workflows cover real physical movements. What remains missing is a natural operation for the case “the order must stay, but the sent/handover fact itself was recorded incorrectly”.

Target direction: explicit shipment/handover correction that checks fresh reservation/fulfillment/physical evidence and either safely reverses the mistaken fact or explains the concrete physical action required. Do not restore a simple mutable status toggle.

### A5 — Exchange-linked payment correction is cumbersome

The order editor intentionally permits only payment-method correction for an exchange-linked extra. That ownership boundary is correct, but the exchange workflow currently exposes create/cancel rather than a clear in-place correction of an already recorded exchange payment/date/amount.

Target direction: audit whether exchange correction should be a dedicated audited correction action instead of forcing cancel-and-recreate for ordinary data-entry mistakes.

## Role/access review still pending

Operational Autonomy R2 already made many routine actions manager-safe: unsent order create/edit, payments, shipping/workshop changes, returns/exchanges and their cancellation, routine inventory movements/transfers/checks, Workshop work, leads/call-centre work and normal cash operations.

Admin-only should remain appropriate for genuinely destructive/master-data/security actions. However `Step 190.0 access/auth` is still explicitly deferred in project context, so the current admin boundary is not treated as final product policy. It should be reviewed separately with the client instead of assuming every old admin gate is intentional.

Emergency `/api/d1-check` also depends on deploy-time `DIAGNOSTICS_ENABLED`; that is infrastructure diagnostics, not a routine business workflow, and is not currently classified as an autonomy defect.

## Development/release brittleness discovered during PR #31

The application runtime was functionally correct before final promotion, but the cumulative release gate failed because historical static tests and exact source-preservation manifests still encoded the older payment behavior. We had to refresh 189C/F5 expectations and explicitly register accepted source deltas in 1906A/1906B before the legitimate change could pass.

This is useful as a regression alarm, but the current chain is too source-shape-sensitive. It can produce false red releases when behavior changes intentionally and safely.

Long-term direction:

- keep black-box/domain behavior tests for business invariants, idempotency, stale-state conflicts, money/stock reconciliation and lost-response safety;
- prefer semantic API/output invariants over exact function-body hashes and arbitrary controller line-count ceilings;
- keep exact hashes only for deliberately frozen artifacts where byte-level preservation is actually a product requirement (for example the currently frozen Arrival UI block);
- whenever a business rule blocks a normal action, require the regression suite to prove that a supported corrective/reversal path exists.

## Priority proposed after this audit

1. Multiple returns + return/exchange coexistence.
2. Debt close after return.
3. Mistaken sent/handover correction.
4. Exchange correction UX/API.
5. Separate role/access review (Step 190.0) with client approval.
6. Gradual simplification of exact-source structural gates into semantic regression gates.

Do not weaken physical or financial truth to gain convenience. The intended standard is: **safe correction without developer intervention, with history preserved**.
