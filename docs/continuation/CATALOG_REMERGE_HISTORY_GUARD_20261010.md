# Re-merge lifecycle history gate — 2026-10-10

## Confirmed prerequisite
The isolated Branch2 D1 schema 0100 workflow run 38038992518 succeeded (including Stage04, stock, money and ledger fingerprint assertions). Cloudflare Branch2 monitor 38038992469 succeeded. Main / production remain untouched.

## Scope of this checkpoint
The old one-shot endpoint treated any original `catalog_variant_consolidations` receipt with matching target as an idempotent success. After a validated generation-2 undo, the original source SKU can be active again and the receipt still exists. Returning `alreadyConsolidated:true` is wrong; after a later generation-3 merge to a different keeper it is also wrong to consider the original keeper current.

- Read-only preview now distinguishes a restored source and refuses to offer the obsolete first-generation button.
- The existing write endpoint now uses the latest immutable generation, succeeds idempotently only for an inactive source pointing at the effective current keeper, and fails closed on restored active SKUs.
- SQLite regression simulates original merge, validated-undo-shaped generation-2 lifecycle, and a hypothetical generation-3 new keeper. It asserts immutable root receipt, shipped order snapshots, active source semantics, and correct current keeper detection.

## Explicitly not done
There is **no** generation-3 write endpoint or physical-stock compensation, and this patch makes **no inventory/order/finance changes**. Adding a production re-merge writer needs its own atomic append-and-retire proof with database-level CAS, per-location evidence, stale-employee-form handling and regression / deployment checks. The normal one-shot merger remains the only merge writer until then. No long-lived staff locks.
