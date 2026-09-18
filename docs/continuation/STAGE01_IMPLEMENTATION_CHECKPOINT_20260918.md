# Stage 0+1 — implementation checkpoint (2026-09-18)

Status: R1 + R2 are implemented and green on the isolated feature branch. Production D1 was not touched. Do not merge/deploy this branch yet; continue Stage 0+1 in small guarded slices.

## Source of truth

- Production/main baseline at the beginning of this slice: `main`.
- Implementation branch: `feature/stage01-truth-projections-20260918`.
- Current green implementation head: `1499582f1ca1819f7e18971b1073cf45495f144a`.
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

A temporary CI-only branch `w-stage01-check4-20260918` and draft PR #72 were used only to trigger the existing `Quality check` workflow.

Final successful run:

- GitHub Actions run: `35327687377`
- cumulative `npm run release:check`: SUCCESS
- production build: SUCCESS
- dependency audits: SUCCESS
- PR #72 was closed without merge.

The focused Stage01 R2 regression itself also passed before the remaining cumulative suite:

`STAGE01 CANONICAL ITEM PROJECTION R2 PASSED`

## Current safety boundary

Do not touch Production D1 while Stage 0+1 is still being assembled.

Do not rewrite order snapshots during Resolver repair.

Do not let a shared projection become a hidden mutation layer: projection is read-model logic only.

Do not collapse return money, return workflow, shipping, Workshop, and catalog identity into one coarse order status.

## Next work

Before starting the next mutation-bearing block, audit the remaining order surfaces for duplicated/contradictory truth derivation against the two shared projections.

Priority targets:

1. find any remaining working-order screens/actions that still infer current item identity from snapshot text instead of the canonical projection;
2. find any remaining order actions that still infer active Return/Exchange or Workshop state from coarse legacy fields instead of `OrderOperationalProjection`;
3. keep historical/finance/audit views intentionally historical where appropriate rather than mechanically converting every screen to canonical-first;
4. only after that audit, take the next smallest Stage 0+1 slice and add its own focused regression + exact structural layer.

