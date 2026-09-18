# Stage 0+1 implementation checkpoint — 2026-09-18

Repository: `dymovicd123/Orders-app`

## Safety / branches

- Branch2 remains unchanged at `fb43e8d709b57b67cc080bb9bd64246bb036aede`.
- Implementation branch: `feature/stage01-truth-projections-20260918`.
- Current implementation head: `f0551322f59ed8b83f68368e4e02572a6833653a`.
- Production D1 was not touched.
- No merge into branch2/main has happened.
- Temporary CI branches used only to trigger the existing `w*` quality workflow:
  - `w-stage01-check-20260918`
  - `w-stage01-check2-20260918`
  - `w-stage01-check3-20260918`
  Never merge these wholesale.

## Implemented checkpoint: Order operational truth projection

Added:
- `src/app/orderOperationalProjection.ts`

The shared projection now composes:
- administrative archive/deleted state;
- active Return operation count;
- gross received / refunded / net retained / debt;
- Workshop per-item task summary with coarse order status only as compatibility fallback;
- action eligibility for debt, Return, Exchange, edit, send, shipment correction and stock handover.

Important semantic changes:
- removed `return_amount > 0 => whole order returned` lifecycle shortcut;
- previous Return no longer removes the order from Return/Exchange candidate lists;
- active Return operation still blocks destructive edit and conservative shipment/correction, matching backend safety rather than pretending the whole order is terminal;
- Orders table now shows gross received plus refunded/net retained context;
- Workshop summary is derived from per-item task status first;
- generic order editor no longer exposes coarse Workshop status as an editable business field;
- Order Details no longer exposes the old whole-order “Готово” Workshop control.

Frontend consumers updated:
- `src/features/sections/OrdersTableSection.tsx`
- `src/features/sections/OrderDetailsSection.tsx`
- `src/features/sections/OrderEditorSection.tsx`
- `src/app/controllers/useOperationalViewModel.ts`
- `src/App.tsx`
- `src/app/utils.ts`

Stage 0 regression added:
- `scripts/test-stage01-order-truth-projection-r1.mjs`
- added to `release:check`

Existing static regressions updated only where their old source-string assertions had been replaced by the shared projection:
- `scripts/test-order-edit-autonomy.mjs`
- `scripts/test-step1904-storage-database-hygiene.mjs`
- `scripts/test-manager-routine-access-r1.mjs`
- `scripts/test-manager-workshop-sent-order-actions-r2.mjs`

The exact frontend structural manifest was extended for this bounded delta:
- `scripts/stage01-order-truth-projection-frontend-manifest.json`
- `scripts/test-step1906b-frontend-modularization.mjs`

## CI result

A temporary `w*` branch was used because the repository quality workflow runs on pushes to `w*`.

Final verification:
- workflow: `Quality check`
- run id: `35323483156`
- tested SHA: `f0551322f59ed8b83f68368e4e02572a6833653a`
- conclusion: **success**

The successful run includes:
- cumulative `release:check`;
- Stage01 regression;
- existing Return/Exchange, order edit/delete, Warehouse, D1 budget, modularization and finance regressions;
- TypeScript;
- Vite production builds;
- bundle budget;
- Wrangler deploy dry-run.

Two earlier CI attempts failed only because old static tests still looked for the removed inline UI predicates. They were updated to assert the same safety semantics through `projectOrderOperationalState()`; the final run is green.

## What is NOT done yet

Stage 1 is not complete.

Still pending:
1. **CanonicalItemProjection / active-work display**
   - operational order screens should show current canonical product/SKU after resolver;
   - raw order snapshots must remain available as historical input;
   - do not rewrite historical snapshots.
2. **Resolver save-state clarity**
   - local selection / preview / saved state must be unambiguous;
   - role switch/admin boundary must not retain stale manager-local state;
   - manager may link existing canonical facts;
   - simple Admin mode is required only for actual reusable master-data creation/change.
3. **Contextual resolver cleanup**
   - preserve one contextual path;
   - do not introduce approval queues or “call admin” workflow.
4. After those changes:
   - rerun cumulative quality check on a temporary `w*` branch;
   - only then consider isolated Branch2 deploy/GUI acceptance.

## Exact next step

Continue Stage 1 with **CanonicalItemProjection and order read mapping** first.

Before editing:
- recheck Branch2 and feature branch heads;
- inspect `worker/domains/orders-read.ts`, `worker/domains/orders-write.ts`, `worker/domains/orders-relations.ts`, and order item frontend types;
- expose both historical and canonical item fields in the API contract without overwriting snapshots;
- make active operational order UI prefer canonical display when `product_id/variant_id` is resolved, while details/history can still show what the manager originally entered.

Stop again after this coherent sub-block is green; do not combine it with Warehouse/pricing.
