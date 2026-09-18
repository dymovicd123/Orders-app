# Stage 0+1 — implementation checkpoint (2026-09-18)

Status: R1 + R2 + R3 + R4 + R5 + R6 are implemented and green on the isolated feature branch. Production D1 was not touched. Do not merge/deploy this branch yet; continue Stage 0+1 in small guarded slices.

## Source of truth

- Production/main baseline at the beginning of this slice: `main`.
- Implementation branch: `feature/stage01-truth-projections-20260918`.
- Current green implementation head: `ce4dbadf9e55c341311d858839bc44ccd26223e0`.
- Branch2 remains separate; its head observed during this work: `fb43e8d709b57b67cc080bb9bd64246bb036aede`.
- No Production D1 migration/write was performed.

## R1 — OrderOperationalProjection

Implemented a shared frontend projection in `src/app/orderOperationalProjection.ts`.

The projection now separates operational facts that were previously collapsed into coarse fields:

- received money;
- returned money;
- net retained money;
- debt;
- active return/exchange operation;
- archive/delete/sent state;
- concrete Workshop task state from `workshop_tasks`, with legacy `orders.workshop_status` only as fallback;
- permissions/actions such as edit, return, exchange, shipping and handover.

Important behavior:

- `return_amount > 0` no longer automatically means «the order is in Return/Exchange».
- Return/exchange UI does not automatically throw an order out of normal working flow only because historical returned money exists.
- Workshop state is derived from item/task truth first.
- The ordinary editor and order details use the same shared projection instead of reimplementing status conditions.
- Manager send/edit regressions were updated to assert the shared projection rather than old JSX inline conditions.

Permanent focused regression:
`scripts/test-stage01-order-truth-projection-r1.mjs`

## R2 — CanonicalItemProjection

Implemented shared backend item projection in `worker/domains/orders-relations.ts`:

`canonicalItemProjection(item)`

Goal: once Resolver has linked an order row to the current canonical catalog identity, the **working order** must show the current canonical product/SKU, while the immutable manager input at order creation remains separately available as history.

Rules implemented:

1. If a valid canonical product link exists, working `productName` uses the canonical catalog product name.
2. Exact canonical SKU fields (gender/color/material/length/size) are projected when an exact variant link exists.
3. Base-product-only resolution changes product/category identity but does not invent SKU characteristics; those remain from the order-time snapshot until an exact variant is linked.
4. `originalSnapshot` is returned separately and keeps:
   - product name;
   - audience/category input;
   - gender;
   - color;
   - material;
   - length;
   - size.
5. Resolver still does **not** rewrite historical snapshot columns. It links `product_id` / `variant_id`.
6. `listOrders` and `getOrder` now use exactly the same canonical/history projection.
7. Order details show the current canonical title as the main truth and add `Изначально при оформлении: ...` only when the historical title actually differs.

Frontend `OrderRecord.items` now exposes:

- `productId`;
- `variantId`;
- `catalogIdentity: 'snapshot' | 'product' | 'variant'`;
- `originalSnapshot`.

Permanent focused regression:
`scripts/test-stage01-canonical-item-projection-r2.mjs`

Exact preservation manifests:

- `scripts/stage01-canonical-item-projection-r2-worker-manifest.json`
- `scripts/stage01-canonical-item-projection-r2-frontend-manifest.json`

The 190.6A Worker and 190.6B frontend structural chains were extended narrowly rather than weakened.

## Regressions encountered while validating R2

Two old static tests correctly stopped the first cumulative runs because they encoded the previous implementation shape.

1. `test-step192b2a4-order-create-save-integrity.mjs`
   - old assertion expected `audienceType:` to be literally inside `orders-write.ts`;
   - updated to require the same invariant through shared `canonicalItemProjection`.

2. `test-catalog-order-history-preservation-r1.mjs`
   - old test required snapshot-first working order reads;
   - that contradicted the new explicit Stage 0+1 contract.
   - test now protects the actual invariant: snapshots are immutable/preserved and exposed separately, while current working identity may follow repaired canonical FKs.

No production rule was bypassed to make these tests pass.

## Final validation

R2 used temporary CI-only branch `w-stage01-check4-20260918` / draft PR #72. R3 used `w-stage01-check5-20260918` / draft PR #73. Both PRs were CI triggers only and were closed without merge.

Final successful run:

- R2 GitHub Actions run: `35327687377` — SUCCESS.
- R3 final GitHub Actions run: `35330539221` — SUCCESS.
- cumulative `npm run release:check`: SUCCESS
- production build: SUCCESS
- dependency audits: SUCCESS
- PR #72 and PR #73 were closed without merge.

The focused Stage01 R2 regression itself also passed before the remaining cumulative suite:

`STAGE01 CANONICAL ITEM PROJECTION R2 PASSED`

## R3 — Workshop / order action truth

The next audit found two concrete contradictions around Workshop state and order action entry.

### Workshop task truth

`workshop_tasks` is now the operational truth for whether Workshop work is still pending.

- `orderWorkshopPendingForShipping()` counts concrete task rows and uses coarse `orders.workshop_status` only as a compatibility fallback when an order has Workshop items but genuinely has no task records.
- A stale coarse `in_workshop` cache can no longer keep shipment blocked after all real tasks are done/cancelled.
- `updateWorkshopTask()` treats refresh of the coarse order cache as secondary after the concrete task mutation is committed. A cache-refresh failure is logged and cannot turn the successful task mutation into a false API failure.
- Workshop activity-log writes are also secondary after the mutation; log failure no longer reclassifies a committed task update as failed.
- The Workshop PATCH route best-effort reads back the fresh order and returns it to the frontend. If readback fails, it returns `refreshRequired` instead of false-failing.
- The frontend immediately `upsert`s that fresh order, so Orders and Workshop no longer disagree about readiness until a later unrelated reload.

Focused regression:
`scripts/test-stage01-workshop-truth-r3.mjs`

Exact Worker/frontend preservation layers:
- `scripts/stage01-workshop-truth-r3-worker-manifest.json`
- `scripts/stage01-workshop-truth-r3-frontend-manifest.json`

### Shared action entry

Order controller entry points now consult the same `OrderOperationalProjection` before opening or executing working actions.

Covered entry points include debt, return, exchange, edit, Workshop edit, final shipment and mistaken-shipment correction. This removes another class of drift where buttons and controller handlers could encode different lifecycle rules.

Focused regression:
`scripts/test-stage01-order-action-entry-r3.mjs`

Exact frontend layer:
`scripts/stage01-order-action-entry-r3-frontend-manifest.json`

The existing manager/autonomy regressions were updated only where they had been asserting obsolete inline JSX/controller conditions. They now protect the same safety boundary through the shared projection.

## R4 — Finance correction commit/readback boundary

The money/finance audit found one concrete reliability contradiction in `correctExchangeFinancials()`.

Before R4, the exchange financial correction could successfully commit the payment/refund/exchange/order/cash changes and synchronize the order ledger, then call `getOrder()` before `completeCriticalOperation()`. A transient secondary read failure at that point could report the already-committed money correction as failed and leave the idempotent operation in a misleading state.

R4 aligns this path with the safer Return/Exchange patterns already used elsewhere:

- after the business writes and `syncOrderFinancialLedger()` succeed, the critical operation is completed immediately with a minimal successful response and `refreshRequired: true`;
- order readback happens only after completion and is best-effort;
- successful readback enriches only the first response with `order` and `refreshRequired: false`;
- readback failure logs a warning and keeps the operation successful;
- activity logging remains secondary and cannot false-fail the correction;
- the unchanged/idempotent branch uses the same readback isolation.

Focused regression:
`scripts/test-stage01-finance-correction-reliability-r4.mjs`

Exact Worker preservation layer:
`scripts/stage01-finance-correction-reliability-r4-worker-manifest.json`

Final validation:
- temporary draft PR #74, closed without merge;
- GitHub Actions Quality check run `35331323128`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R5 — Return/Exchange Workshop cache reliability

The follow-up lifecycle audit found the same commit-boundary hazard around the legacy coarse Workshop cache in Return/Exchange operations.

Concrete Return/Exchange mutations already update the real lifecycle/task truth first. R5 makes the later `refreshOrderWorkshopStatusFromTasks()` call best-effort in:

- return creation;
- exchange creation;
- return cancellation;
- exchange cancellation.

A transient failure while refreshing `orders.workshop_status` can therefore no longer turn already-committed lifecycle work into an API failure. The authoritative records remain the concrete Return/Exchange rows, inventory lifecycle records, and `workshop_tasks`; the coarse order field remains compatibility/cache only.

Focused regression:
`scripts/test-stage01-return-exchange-workshop-cache-r5.mjs`

Exact Worker preservation layer:
`scripts/stage01-return-exchange-workshop-cache-reliability-r5-worker-manifest.json`

Final validation:
- temporary draft PR #75, closed without merge;
- GitHub Actions Quality check run `35332084525`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R6 — Unshipped queue no longer depends on refund history

The remaining Orders read path still had one old lifecycle shortcut: `shippingStatus=not_sent` excluded every order with `return_amount > 0`.

That contradicted the shared Stage 0+1 contract. A partial or historical refund is a money fact and must not make an otherwise active, physically unshipped order disappear from the ordinary `Не отправлено` work queue.

R6 removes that dependency. The visible shipping filter now follows `shipping_status` only.

The legacy explicit `status=returned` API filter is intentionally left unchanged in this narrow slice; R6 fixes only the current user-facing shipping queue and does not broaden into API compatibility semantics.

Focused regression:
`scripts/test-stage01-unshipped-refund-decoupling-r6.mjs`

Exact Worker preservation layer:
`scripts/stage01-unshipped-refund-decoupling-r6-worker-manifest.json`

Final validation:
- temporary draft PR #76, closed without merge;
- GitHub Actions Quality check run `35332881155`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## Current safety boundary

Do not touch Production D1 while Stage 0+1 is still being assembled.

Do not rewrite order snapshots during Resolver repair.

Do not let a shared projection become a hidden mutation layer: projection is read-model logic only.

Do not collapse return money, return workflow, shipping, Workshop, and catalog identity into one coarse order status.

## Next work

The Order / product identity / Workshop/action slices and the first Finance reliability slice are green. Continue the money/finance audit, but preserve the already-proven F2–F9 semantics and only patch concrete contradictions.

Priority targets:

1. find any remaining working-order screens/actions that still infer current item identity from snapshot text instead of the canonical projection;
2. find any remaining order actions that still infer active Return/Exchange or Workshop state from coarse legacy fields instead of `OrderOperationalProjection`;
3. keep historical/finance/audit views intentionally historical where appropriate rather than mechanically converting every screen to canonical-first;
4. only after that audit, take the next smallest Stage 0+1 slice and add its own focused regression + exact structural layer.

