# Phase 1B — Workshop return/exchange disposition

Status: completed and release-gated on branch2 before promotion to main.
Date: 2026-08-26.

## Scope

This phase changes only Workshop-origin return/exchange inventory disposition semantics.

- A Workshop-origin returned item does **not** enter Warehouse/Boutique stock by default.
- Workshop return intake requires an explicit per-line decision.
- Explicit Workshop intake may target **Warehouse** only.
- Workshop -> Boutique is rejected in both UI and backend.
- Ordinary Warehouse/Boutique return behavior remains compatible with the previous default.
- No-stock returns skip inventory lifecycle mutation.
- Explicit Workshop -> Warehouse intake still uses the existing exact-identity, freshness and idempotency barriers.
- Arrival UI was not changed.
- No D1 repair, migration or business-data write was part of this phase.

## Important implementation details

The frontend now transmits the existing per-line `restock` decision. `ReturnItemDraft` also keeps the source type so Workshop lines can default to no-stock and be handled explicitly in the return UI. The exchange UI distinguishes Workshop-origin old items and does not offer Boutique as a destination.

The backend no longer forces every selected return row to `restock: true`. For Workshop rows, an omitted restock decision is deliberately interpreted as no-stock; an explicit Workshop -> Boutique request is rejected. Activity text reflects the actual stock disposition.

## Regression / structural gates

The cumulative Worker declaration chain was extended with `scripts/phase1b-workshop-return-disposition-worker-manifest.json`. The Phase 1B declaration baseline for `createReturn` / `createExchange` is the accepted Finance F2 post-change hash, because Finance F2 is later than 192B2A4 in the cumulative chain.

The Step 192A1 regression checks were also extended to assert the explicit disposition boundary. The test uses a section boundary for `createReturn` because its TypeScript signature contains inline object-type braces and cannot be parsed safely by the old brace-only helper.

## Verified commits

- branch2 tested source commit: `7849d648ced06518d5b255c5a945699e95c04fc5` — `Fix Workshop return disposition semantics`.
- main tested source commit: `3776d2d86aa1375be464674c8b3362c04b1a1ef4` — `Fix Workshop return disposition semantics`.

The branch2 Phase 1B workflow completed the full `npm run release:check` successfully before committing source. Main was not merged wholesale because main and branch2 histories had diverged; instead the exact tested Phase 1B file delta was promoted only after verifying the main baseline blobs matched the branch2 tested pre-patch baseline, followed by another full successful `npm run release:check` on main.

## Resume point

Phase 1B is finished. Continue with the next planned warehouse phase only after confirming the Cloudflare build for the current branch head is successful. Do not reopen Arrival UI or introduce D1 repair/migration work as part of this completed phase.
