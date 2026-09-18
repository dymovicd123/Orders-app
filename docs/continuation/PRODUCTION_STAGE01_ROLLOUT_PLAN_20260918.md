# Stage01 Production rollout plan — 2026-09-18

## Frozen release facts

- Production baseline branch: `main`
- Production baseline commit: `412ba8b4f2a72873232103944e2a3a777a6dbcd9`
- Stage01 Branch2 validated commit: `21b6ad6bbe066d7c11ced060507c4ccff2d5e7f6`
- Release branch: `release/stage01-production-20260918`
- Production Worker: `orders-app`
- Production D1: `orders_db_prod`
- Production D1 id: `17e68a41-1d58-4a36-8a63-47c3e32443c4`

The release branch deliberately restores the Production `wrangler.jsonc` and removes the Branch2 title marker before any merge to `main`.

## Production read-only audit

Temporary Production-readiness workflow run `35368742387` passed.

Verified before any Production mutation:

- existing Production read APIs return HTTP 200 for admin mode status, auth state, dashboard, reference data, Orders, Workshop counts, Warehouse Attention and Catalog;
- Production contains every Branch2-required schema object and column before R14, excluding the five R14 search triggers that are intentionally the new delta;
- migration/data markers match Branch2 for:
  - `human_inventory_v2=active`;
  - `safe_early_handover_v1_guard=ready`;
  - `catalog_identity_v3=active`;
  - `catalog_cleanup_188j=active`;
  - `client_cleanup_188k2=active`;
  - `financial_history_model=189c-v1`;
- Production `order_search_items_fts` currently contains exactly one row per `order_items` row: 3751 / 3751;
- the two new R14 catalog-refresh triggers are currently absent, as expected;
- D1 Time Travel is available and returned a current bookmark during the audit.

Production row-count baseline captured during the audit:

- orders: 1494
- order_items: 3751
- payments: 1676
- returns: 37
- exchanges: 57
- workshop_tasks: 2099
- inventory_stock: 1112
- inventory_reservations: 1102
- inventory_lifecycle_events: 55

These counts are diagnostic baselines only; they may legitimately increase before release.

## Critical migration-ledger constraint

Production `d1_migrations` is not a trustworthy history.

At audit time it contained only:

- `0001_init.sql`
- `0067_v72_o1_read_budget_indexes.sql`

The physical Production schema nevertheless contains the required pre-R14 schema and the major durable data-migration markers.

Therefore:

**Do not run `wrangler d1 migrations apply` against Production for this rollout.**

Doing so can attempt to replay old migrations whose physical effects are already present.

Migration-ledger reconstruction is a separate maintenance task and is not part of Stage01 promotion.

## Production database change for Stage01

The only proven missing schema behavior required by the Stage01 release is R14 migration:

`migrations/0070_v72_stage01_canonical_order_search.sql`

R14 changes derived order-search infrastructure only:

- rebuilds `order_search_items_fts` from current canonical + historical vocabulary;
- replaces the three item-search refresh triggers;
- adds catalog product/variant refresh triggers.

The Stage01 cross-regression guards that R14 does not rewrite Orders, order items, payments or catalog business/history rows.

### Required pre-migration sequence

Immediately before executing R14:

1. Re-run the Production read-only preflight.
2. Retrieve and record a **fresh** D1 Time Travel bookmark.
3. Verify:
   - Production D1 id is exactly `17e68a41-1d58-4a36-8a63-47c3e32443c4`;
   - `order_items` count equals `order_search_items_fts` count;
   - the two R14 catalog triggers are still absent;
   - current Production read smoke is green.
4. Apply **only** `0070_v72_stage01_canonical_order_search.sql` directly. Do not invoke the migration runner.

Expected command from a checkout of this release branch:

```bash
npx wrangler d1 execute DB --remote --config wrangler.jsonc --file migrations/0070_v72_stage01_canonical_order_search.sql
```

### Required post-migration verification

Before changing `main`:

- all five R14 triggers exist:
  - `trg_order_search_items_ai`
  - `trg_order_search_items_ad`
  - `trg_order_search_items_au`
  - `trg_order_search_catalog_products_au`
  - `trg_order_search_catalog_variants_au`
- `order_search_items_fts` row count still equals `order_items` row count;
- Production read smoke remains green.

If any of those checks fail, do not promote code.

## Code promotion sequence

Only after R14 is verified in Production D1:

1. Confirm this release PR Quality check is green.
2. Confirm `main` is still at the expected Production baseline or review any intervening commit.
3. Merge the release PR into `main`.
4. The existing Cloudflare build/deploy pipeline will deploy Worker `orders-app`.
5. Wait for `cloudflare-deploy/main` to report success.
6. Run the Production read smoke again.
7. Verify Orders search, Workshop counts, Warehouse Attention, Catalog, Returns/Exchanges and order detail readback.

Do not run automated mutation E2E against Production. The successful mutation E2E belongs to isolated Branch2.

## Rollback strategy

### Code-only failure

If D1 is healthy and the problem is Worker/frontend behavior:

- restore the previous Production code commit `412ba8b4f2a72873232103944e2a3a777a6dbcd9` on `main`;
- allow the normal Cloudflare Production deployment to finish;
- re-run read smoke.

R14 is additive derived-search infrastructure and does not require immediate removal for a code-only rollback.

### Database failure caused by R14

Use D1 Time Travel only if the database itself was damaged and only after deciding that Production writes since the pre-release bookmark may be lost.

Retrieve a fresh bookmark immediately before the migration and preserve it in the release record.

Cloudflare restore command form:

```bash
npx wrangler d1 time-travel restore DB --config wrangler.jsonc --bookmark="<PRE_RELEASE_BOOKMARK>"
```

D1 Time Travel overwrites the database in place. It is a last-resort database rollback, not the first response to an application-code bug.

## Current release boundary

This document prepares the release but does not authorize or perform Production mutation.

No Production D1 migration and no Production code deployment should occur until the release PR is green and the operator explicitly proceeds with the rollout sequence above.
