# Система заказов — continuation context

Updated: 2026-09-01 (Asia/Almaty)

## Current production baseline

- Main branch after D1 optimization pass: `5efc75d69b6ad75d5a8deec472e33938d855c7f3`.
- Cloudflare deploy monitor was started for this exact commit after promotion.
- Arrival UI (`Приход`) remains frozen: do not change it unless the user explicitly reverses that decision.

## Why D1 optimization became urgent

On 2026-09-01 Production stopped serving every D1-backed read because the account hit Cloudflare D1 Free daily row-read limit. Live response after the classifier patch was HTTP 503 with code `d1_daily_read_limit`. Data was not reported damaged. The Free-tier daily limit resets at 00:00 UTC (05:00 Asia/Almaty).

The immediate priority became reducing row-read amplification before returning to feature work.

## D1 optimization R1 — deployed before R2

R1 main commit: `414320141ae84e54ac8ddffcf87c67f39a858b59`.

Key changes:

- The ordinary orders list no longer runs the full stock handover forensic payload just to compute two flags.
- `fetchOrderStockHandoverRows` gained a compact list-flags path while the full resolver remains the canonical source for explicit handover flows.
- Exact `ORD-...` lookup uses direct indexed `external_id` equality instead of the broad free-text `INSTR`/items/payments scan.
- Relation/stat reuse was improved so complete small filtered result pages do not immediately rescan the same relations for summaries.
- Permanent regression: `scripts/test-d1-read-budget-r1.mjs`.

R1 was confirmed deployed by Cloudflare deploy monitor.

## D1 optimization R2 — current main

Validated candidate passed:

- `npm run typecheck`
- full `npm run release:check`
- all warehouse/order/finance regression gates
- Vite production build
- post-build bundle budget
- Wrangler deploy `--dry-run`

Permanent R2 files/code were promoted to main; temporary workflow/patcher/registrar/trigger were removed before promotion.

R2 changed six Worker read declarations (tracked by `scripts/d1-read-budget-r2-worker-manifest.json`):

1. `fetchOrderStockHandoverRows`
   - compact all-active mode for background Warehouse Attention summary;
   - full handover payload remains for explicit detail/handover screens.

2. `getWarehouseAttentionSummary`
   - summary requests compact handover rows;
   - explicit `details=1` remains full fidelity.

3. `listOrders`
   - `ORD-...` prefix search uses an indexed external-id range instead of falling immediately into the broad search path;
   - complete-page relation/stat reuse also works with selected date ranges where safe.

4. `listInventory`
   - active catalog variant is joined once instead of using a correlated per-row active-variant existence lookup.

5. `listTeamEmployees`
   - order/attendance/reference counters are preaggregated and joined instead of correlated subqueries per manager.

6. `listClients`
   - filtered total is carried by the page query (`COUNT(*) OVER()`) rather than issuing another filtered count query.

Frontend R2:

- Warehouse Attention summary has a short TTL/in-flight coalescing path to avoid duplicate simultaneous/recent reads.
- Inventory writes explicitly force Attention refresh, so caching does not leave write aftermath stale.

Permanent regression: `scripts/test-d1-read-budget-r2.mjs`.

## What is intentionally NOT done yet

No D1 index migration was applied while the daily read quota was exhausted. Do not blindly create indexes without live `EXPLAIN`/rows-read evidence after reset.

Do not claim that code optimization alone can bypass an already exhausted Cloudflare daily quota. Until reset/plan upgrade, D1 itself can reject reads.

## Tomorrow / next execution order

### 1. Post-reset production acceptance and real cost measurement

After 05:00 Asia/Almaty (00:00 UTC):

- verify D1 reads recovered;
- verify the exact deployed main commit;
- exercise representative read paths without artificial high-volume polling;
- collect D1 `rows_read` / Insights for R1+R2;
- compare top consumers with the pre-fix profile;
- only then decide which indexes are justified.

### 2. Return to orders autonomy and restrictions

User explicitly wants deterministic routine operations to work without constant admin intervention.

Priorities:

- finish the duplicate/error order `ORD-20260829144801-F3A7DDC3` check/removal safely after D1 recovery;
- user-confirmed physical fact: the item was NOT actually handed to the customer (`physicalOutcome = not_issued`);
- safe-delete only through business endpoint; never direct SQL delete/update;
- if already deleted, verify return #33 is cancelled and newer physical truth was preserved;
- if not deleted, use idempotent safe-delete and verify reservations/workshop/returns/exchanges/physical stock did not double-mutate;
- continue reducing admin-only restrictions where the outcome is deterministic and safe;
- admin remains for genuine ambiguity/policy/high-risk decisions, not routine business work.

### 3. Finish Warehouse

Keep the established warehouse principles:

- Physical / Reserved / Available are separate truths;
- no partial shipments (all-or-nothing);
- newer physical check/stocktake beats older inverse arithmetic;
- known deterministic situations should self-resolve;
- unknown SKU/attribute/policy ambiguity may require admin;
- keep UI simple, small-screen friendly, fewer clicks;
- do not reintroduce developer jargon into user-facing screens;
- `Приход` remains frozen.

### 4. Second full system optimization/audit

User believes the current findings may be only a small part of the problem. After autonomy + Warehouse are stable, perform another cross-system audit, not just SQL review.

Audit the full chain:

- UI render/effects -> API request fan-out;
- duplicate/in-flight/retry reads;
- endpoint payload overfetch;
- Worker query fan-out;
- correlated subqueries / full scans / repeated aggregates;
- D1 indexes and query plans;
- `rows_read` and `rows_written` per major workflow;
- dashboard, orders, clients, team, workshop, finance, reports, warehouse, catalog, references;
- caches and invalidation correctness;
- background/summary endpoints that are loaded even when the user did not open that section;
- expensive exports/reports;
- Cloudflare Worker/D1 limits and storage/bundle costs.

The goal of this second audit is to find structural cost problems that the first D1 emergency pass could not expose while Production was quota-blocked.

## Project invariants / workflow

- Before every Warehouse patch, audit adjacent workflows and data-entry paths, not only one screen.
- After each meaningful step, update this continuation context.
- When the user is local, patches should still be deliverable as one Windows root command `.APPLY_STEP...cmd` if needed.
- Production safety and idempotency take precedence over cosmetic convenience.
