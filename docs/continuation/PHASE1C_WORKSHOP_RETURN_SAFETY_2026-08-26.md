# Phase 1C — Workshop return/exchange safety regression

Status: COMPLETE.
Date: 2026-08-26.

This checkpoint supersedes the older `WAREHOUSE_CURRENT_CONTEXT.md` current-next-action line that still points to Phase 1B. Phase 1B and Phase 1C are now complete; the next Warehouse action is Phase 1D acceptance.

## What Phase 1C proved

No additional business-logic patch was required after the Phase 1B implementation. The reviewed code already has the required safety architecture, so Phase 1C was made a permanent release regression gate instead of inventing another behavior change.

The new durable test is:

- `scripts/test-phase1c-workshop-return-safety.mjs`

and `npm run release:check` now runs it before the existing stocktake functional acceptance test.

The gate protects these invariants:

- Workshop task completion/status remains production-only and does not write Warehouse/Boutique stock.
- A Workshop-origin client return defaults to no-stock.
- Workshop stock intake requires an explicit Warehouse decision; Workshop -> Boutique stays blocked.
- A no-stock Workshop return/exchange old item does not resolve canonical inventory identity and does not create lifecycle/catalog work.
- Return/exchange lifecycle events use stable event keys and replay-safe `INSERT OR IGNORE` recovery.
- Applied lifecycle mutations are pending-guarded, D1-batched and idempotent after lost response.
- Unknown explicit Warehouse intake has one pending identity-resolution path rather than multiple competing mutations.
- Exact Workshop -> Warehouse intake still passes the physical freshness barrier.
- Manual identity resolution re-checks freshness immediately before stock mutation.
- Trusted later full stocktake or later exact physical check supersedes an older inbound event; an overlapping/active stocktake holds it.
- Return/exchange cancellation remains lifecycle-backed and replay-safe; applied intake reverses the exact previous physical delta once.
- Return history preserves the distinction between the client return record and requested/pending/applied/cancelled Warehouse intake.

## Functional freshness cases executed

The Phase 1C test calls the real `inventoryLifecycleDeferredInboundDisposition(...)` with deterministic D1 reads and verifies:

1. inbound before a later trusted full stocktake -> `supersede / stale_before_full_stocktake`;
2. inbound overlapping trusted full stocktake -> `hold / overlaps_full_stocktake`;
3. later exact physical check -> `supersede / later_physical_check`;
4. fresh explicit inbound after the trusted boundary -> `apply / fresh`;
5. active stocktake -> `hold / active_stocktake`.

## Gate history

The first Branch2 run failed only in the newly-written test parser: it assumed `fulfillOrderReservationsV2` followed `getOrderShipmentInventoryBlockers` in source order. The full pre-existing release gate itself had already passed. The test was corrected to assert the established Workshop blocker invariant without depending on declaration order.

- Branch2 durable test commit: `de5e9817b2b8f74d1015d355048284a4f42bc000` — `Fix Phase 1C regression parser boundary`.
- Branch2 successful Phase 1C workflow run: `32956857045` — full `npm run release:check` SUCCESS.
- Main Phase 1C test added: `aea94a38342dd7429b219905c55c553f91829680`.
- Main release wiring: `cbdc049d452154772b0edcc8460712b45fca3157`.
- Main successful Phase 1C workflow run: `32957040295` — full `npm run release:check` SUCCESS.

Temporary verification workflows were removed after the successful gates. There was no migration, D1 repair, production-data mutation or Arrival UI change in Phase 1C.

## Next action — Phase 1D

Perform Branch2 then Production acceptance. Start with deployed/read-only/technical acceptance. Do not invent a live Primary mutation merely to satisfy the checklist: a real return/exchange mutation is allowed only if an intentionally selected safe business scenario exists. If no such scenario is available, record technical/read-only acceptance and explicitly leave real-mutation acceptance deferred rather than touching arbitrary client data.
