# Order deletion mobility checkpoint — 2026-09-01

Production source commit before this docs-only checkpoint: `0c43f95b8303429af54629bd5abfc99ee4c1b0bb`.

## Completed

- Added a scoped `POST /api/orders/:id/delete` path for erroneous-order deletion.
- Ordinary staff can invoke deletion; the old frontend admin-only gate was removed.
- Deletion reuses existing critical-operation/idempotency infrastructure.
- Active returns and exchanges are preflighted and, when canonical reversal is safe, cancelled automatically before logical order deletion.
- Existing return/exchange reversal paths remain the source of truth for stock and money rollback.
- An already physically issued/shipped order remains a factual safety boundary rather than silently guessing inventory truth.
- Arrival / `Приход` was not changed.

## Verification

The exact main-based source passed the full cumulative `npm run release:check` gate in GitHub Actions after the final actor typing correction. Targeted order-delete mobility regression also passed.

Exact eight-file production delta relative to `de9b5eb342bbb2625883d1157ad11c4b0f287d79`:

1. `package.json`
2. `scripts/order-delete-mobility-worker-manifest.json`
3. `scripts/test-order-delete-mobility.mjs`
4. `scripts/test-step1906a-worker-modularization.mjs`
5. `src/App.tsx`
6. `src/features/sections/OrdersTableSection.tsx`
7. `worker/domains/order-delete.ts`
8. `worker/index.ts`

## Deployment note

The first Cloudflare build for source commit `0c43f95b8303429af54629bd5abfc99ee4c1b0bb` was terminated by Cloudflare while initializing (`Build failed to initialize and was timed out`). It did not fail in application build/test logic. This docs-only checkpoint intentionally re-triggers the same Production source through Cloudflare without changing product source.

## Immediate next action

1. Confirm the re-triggered Production deploy succeeds.
2. Resolve the Production Worker URL through existing Cloudflare deployment credentials.
3. Read and verify exact order `ORD-20260829144801-F3A7DDC3`.
4. Delete it through the new scoped API so return/exchange/money/stock reversal logic is exercised normally, not by raw D1 mutation.
5. Verify the order is absent from active/all operational order listing and record the result.
6. Continue with the admin-dependency / operational-mobility audit before final Warehouse completion.

## Mobility audit principle

Do not simply remove all admin guards. Classify each blocker:

- deterministic routine action: self-recover automatically;
- one missing physical fact: ask one narrow factual question, then continue;
- genuine policy/destructive administration: keep admin-only.

Priority operational dead-ends already identified include catalog review required to finish a live order, pending return/exchange inventory resolution, mistaken return/exchange cancellation, routine order correction, and Inventory panel redirects that hide safe narrow workflows from ordinary staff.
