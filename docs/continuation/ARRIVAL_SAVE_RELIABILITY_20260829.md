# Arrival save reliability — 2026-08-29

## Status

**COMPLETE on branch2 and Production source.** This checkpoint commit exists to trigger/verify the final Cloudflare Production build that contains the tested source commit below.

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

## Verified chain

Safe validation source:

- `6abec7b1f8c651296f3a59772d0d759084df481d` — `Fix arrival materialization over retired catalog identity`

Branch2:

- tested source commit `74aba2557d1e80f313fdaf9ea475d7b17ff74f83` — `Fix arrival save reliability`
- full cumulative `npm run release:check`: green
- Cloudflare branch2 build confirmed green on descendant checkpoint `539195eec4796d75115e8add722fa9bb4b009405`

Production/main:

- tested source commit `eba117377471d1bbee284f1689bfbd90371933f1` — `Fix arrival save reliability`
- exact Production baseline was verified against `b5566176b5159fc5b1c24c1930095879c3ea5552` before applying the branch2-tested seven-file delta
- full cumulative `npm run release:check`: green
- resulting Production source tree is identical to the safe-tested source tree (`6c80f05d910062b54bf61889a5199f4a60873ec0`)

## Invariants

- Arrival UI is unchanged.
- Existing stock quantities/reservations are not rewritten by this patch.
- No migration and no repair SQL.
- Historical retired catalog rows remain historical and inactive.
- Request-id idempotency remains in place; successful manual inventory writes still rotate to a new request id only after success handling.

## Resume point

After the Cloudflare monitor for this Production checkpoint is green, the Arrival save reliability incident is closed. Resume the planned warehouse roadmap from the next unfinished phase; do not reopen Arrival UI work unless a new reproducible defect appears.


## Incident 2026-10-06 — child audience encoded as gender

### Client symptom

Production client saw:

`Не удалось выполнить операцию. Обновите страницу и повторите действие...`

during a real Arrival batch containing multiple products and child variants. A confirmed row was `СӘУЛЕТ ЖИЛЕТ · ХАКИ · age 1`.

### Read-only Production forensic

A dedicated diagnostic branch queried only `orders_db_prod` with explicit Production identity hard-stops. No mutations were performed.

Important findings:
- `СӘУЛЕТ ЖИЛЕТ` is active and unisex.
- For `child · ХАКИ · 1`, Production has three active historical identities: neutral gender, ЖЕН, МУЖ. The neutral child SKU is valid historical Catalog truth.
- `СИНИЙ БОМБЕР` existed as an active product with zero executions, zero variants and zero Arrival movements. This is consistent with Catalog product materialization occurring before a later failure stopped the operation.
- Other rows from the same work period later arrived successfully, confirming the incident was identity-specific rather than a total Arrival outage.

### Root cause

The Arrival UI historically auto-filled `ДЕТСКИЙ` into the gender field when the user selected child audience.

That is semantically wrong:
- `child` is audience/category;
- gender identity is independent.

The backend for a unisex product expects either an explicit adult concrete gender or, for child audience after this fix, a neutral child identity. Passing `ДЕТСКИЙ` as gender prevented exact matching with an existing neutral child SKU and could reject materialization.

### Fix

Branch2 PR #300 and Production PR #301:
- stop injecting `ДЕТСКИЙ` as gender;
- normalize legacy open Arrival drafts carrying `ДЕТСКИЙ` to neutral child gender;
- backend resolves neutral child identity after fixed female/male product scope, but before the adult-unisex strict guard;
- fixed-scope female/male products still resolve to their required gender;
- adult unisex still requires explicit ЖЕН/MУЖ.

No D1 migration and no data rewrite.

### Release evidence

Branch2:
- PR #300 exact-head Quality: `37497814696` success.
- merge: `0a3cfd9601b9882a93bd69cb8adb0229bf984cd6`.
- safety: `37498063888` success.
- deploy: `37498063990` success.

Production:
- PR #301 exact-head Quality: `37500952248` success.
- merge: `da6a95da219220928f6ed6b41c63d1dbebee57ff`.
- Cloudflare deploy: `37501136513` success.
- `cloudflare-deploy/main`: success.

The `СИНИЙ БОМБЕР` product row was intentionally not deleted or rewritten. A later valid Arrival can safely materialize its execution/SKU under the existing active product.
