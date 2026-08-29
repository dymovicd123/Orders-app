# Arrival save reliability — 2026-08-29

## Scope

Hotfix for the Warehouse `Приход` save path. The Arrival UI itself remains frozen: no visual/layout/form redesign is part of this change. No D1 migration, repair, or manual business-data mutation is included.

## Problems fixed

1. **Committed write reported as failure because a follow-up read failed.**
   `saveInventoryMovement()` previously awaited post-write refreshes with `Promise.all`. After the POST had already returned success, any failed inventory/catalog refresh could throw into the outer catch and show a red operation failure. This could invite an employee to repeat an already committed arrival.

   Fix: post-commit refreshes are now best-effort via `Promise.allSettled`. Mutation failure is still fail-closed before the commit boundary; read refresh failure can no longer reclassify a successful write as a failed write.

2. **Arrival materialization blocked by a retired historical catalog identity.**
   Retired variants intentionally remain in history and can still own their globally unique `external_id`. When a physically real combination later reappeared through Arrival, `INSERT OR IGNORE` could be suppressed by that retired row, after which the resolver failed because no active variant existed.

   Fix: if the canonical generated `external_id` is already owned by a retired variant, the new active physical combination receives a deterministic replacement identity derived from the canonical id and active execution. The retired historical row is not reactivated or rewritten.

## Regression guards

- `scripts/test-arrival-save-reliability.mjs`
- `scripts/test-arrival-materialization-reliability.mjs`
- `scripts/arrival-save-reliability-worker-manifest.json`
- Step 190.6A structural allow-list is extended only for the exact `resolveInventoryCreatableItemsBulk` declaration delta.
- `npm run release:check` includes both new tests.

## Verified source

Safe validation branch final source:

- `6abec7b1f8c651296f3a59772d0d759084df481d` — `Fix arrival materialization over retired catalog identity`

Branch2 promotion:

- `74aba2557d1e80f313fdaf9ea475d7b17ff74f83` — `Fix arrival save reliability`
- Exact pre-hotfix blobs were verified against Production baseline `b5566176b5159fc5b1c24c1930095879c3ea5552` before copying the tested seven-file hotfix.
- Full cumulative `npm run release:check` passed on branch2 before the source commit was pushed.

## Invariants

- Arrival UI is unchanged.
- Existing stock quantities/reservations are not rewritten by this patch.
- No migration and no repair SQL.
- Historical retired catalog rows remain historical and inactive.
- Request-id idempotency remains in place; successful manual inventory writes still rotate to a new request id only after success handling.

## Resume point

Wait for Cloudflare branch2 deployment of a descendant of source commit `74aba255...`. Only after branch2 deploy is confirmed green, promote the exact tested source delta to `main`, run the same full release gate there, trigger/confirm the Production Cloudflare build, then continue the warehouse roadmap.
