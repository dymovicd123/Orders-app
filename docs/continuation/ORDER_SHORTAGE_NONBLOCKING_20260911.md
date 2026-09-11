# Order shortage save recovery — 2026-09-11

## Trigger

A Production video showed an existing order edit failing with `order_stock_shortage` before the operator had any visible way to choose the already-supported «Сейчас проверить не могу» path. The edit UI intentionally hid the stock-decision panel until the first server rejection, so the first save became an artificial blocker.

## Product rule

An order may be created or edited even when Warehouse/Boutique free stock is insufficient and the operator cannot physically count the item right now. A physical count remains optional and authoritative when supplied; the absence of a count must not make the order itself unsavable.

## Fix

`src/app/controllers/useApiClient.ts` now normalizes only ordinary order create (`POST /api/orders`) and order edit (`PATCH /api/orders/:id`) JSON writes:

- Workshop lines are untouched.
- If `observedPhysicalQuantity` is explicitly supplied, it is preserved and remains authoritative.
- If `shortageAcknowledged === true` is already present, it is preserved.
- Otherwise Warehouse/Boutique lines are sent with `shortageAcknowledged: true`, equivalent to the existing «Сейчас проверить не могу» decision.

This removes the forced first-failure cycle without weakening the Worker's existing stock/reservation accounting. The order may create a shortage/negative free availability that remains visible to Warehouse workflows, but the business order is not blocked merely because the physical check was deferred.

A focused regression `scripts/test-order-shortage-save-nonblocking.mjs` is included in `npm run release:check`. The exact `useApiClient.ts` delta is chained into the historical 1906B structural gate through `scripts/order-shortage-nonblocking-frontend-manifest.json` and a frozen predecessor fixture.

No migration. No D1 mutation performed as part of the patch. Arrival and Branch2 are unchanged.

## Separate issue from the same video

The return path appears to have restored one `ЕНЛИК ШАПАН` unit into a historical exact SKU with `Пол не указан`, while a visually similar canonical `ЖЕН` SKU remained at zero. This is a separate SKU-identity/legacy-link issue and is intentionally not changed by this order-save hotfix. Before correcting Production data or return identity rules, inspect the exact order item and both variant IDs read-only.
