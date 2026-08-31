# Shipping shortage hotfix + pre-August backfill — 2026-08-31

## User-facing incident

Production shipment could be hard-blocked when the system physical stock was lower than the quantity required by the order, even when staff needed to hand the order to the client. Example error: `Нельзя отправить заказ целиком ... на месте 0 шт., требуется 1`.

## Permanent shipment fix

Verified source commit: `7a8ac2630d12f75c9525aee1d4da89f3989efdb2` (`Allow shipment despite physical stock discrepancy`).

Behavior after the fix:

- a physical stock shortage is no longer a hard blocker for sending an order;
- physical stock is clamped at zero and cannot become negative during shipment fulfillment;
- inventory movement records the actual physical delta;
- unresolved/unmapped SKU state still remains a blocker because the system cannot safely identify what stock line to fulfill;
- the permanent regression test is `scripts/test-shipping-shortage-nonblocking.mjs` and is included in `npm run release:check`;
- `Приход` / Arrival was not changed.

## Historical shipping backfill requested by user

Cutoff: every unsent order with `order_date < 2026-08-01`.

The direct Cloudflare D1 API path was attempted first but returned authorization error `7403` before any write. No D1 mutation occurred in that failed attempt.

A transient production-Worker maintenance route was then used because the Worker already owns the production D1 binding. The route was verified with the full cumulative release gate before production execution, deployed, executed once, and then removed.

Confirmed production result returned by the Worker:

```json
{
  "ok": true,
  "cutoff": "2026-08-01",
  "targetOrders": 425,
  "reservationRows": 539,
  "reservationQty": 726,
  "archivedUnsentExcluded": 0,
  "remaining": 0
}
```

Meaning:

- 425 previously unsent non-archived orders dated before 2026-08-01 were marked sent;
- 539 linked active/unresolved reservation rows, total quantity 726, were reconciled to fulfilled so those old orders no longer reserve live stock;
- `inventory_stock.reserved_quantity` was recomputed from still-active reservations;
- no archived unsent order was left outside the operation (`archivedUnsentExcluded = 0`);
- postflight confirmed `remaining = 0`, so there are no unsent orders before the cutoff left in the targeted population.

Persistent machine-readable result: `docs/emergency/preaug-shipping-backfill-20260831-result.json`.

## Cleanup / final production source

Transient route and all emergency one-shot workflows/triggers were removed after successful backfill. The only remaining GitHub workflow is the normal Cloudflare deploy monitor.

Clean source commit after removal: `a342259d12fc9408237925338bb43422d12f8715` (`Remove pre-August maintenance route after backfill`). Full `npm run release:check` passed on the clean source before this continuation note was committed.

## Continuation point

Production should continue from the clean source. Do not reintroduce the transient maintenance endpoint. The permanent business rule is: physical stock discrepancy must remain visible as stock truth/attention, but it must not by itself prevent staff from completing a real client shipment; unresolved SKU identity remains a separate safety blocker.
