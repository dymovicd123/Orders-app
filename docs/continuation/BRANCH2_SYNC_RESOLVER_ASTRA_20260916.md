# Astra handoff — Branch2 sync + resolver acceptance

Date: 2026-09-16

## Mission

Update **Branch2 only** to the current `main` runtime while preserving the proven Branch2 environment invariants, safely reconcile the Branch2 D1 schema, deploy the exact validated Branch2 source, then create temporary Branch2-only test orders for manual acceptance of the new human-first catalog resolver.

Do **not** mutate Primary Production, `orders_db_prod`, the Primary Worker `orders-app`, or `main`.

## Exact Git state

- Repository: `dymovicd123/Orders-app`
- Current main/Production source: `f183c41a6f02a4bb996d174516ef9e0b1ba04eaa` — PR #70 `Redesign catalog resolver as human-first flow`.
- Old Branch2 HEAD: `adec6098777bebe4709615e1256cc5dd468b444d`.
- Recovery ref already created: `backup/branch2-before-sync-20260916` -> exact old Branch2 SHA. Never move/delete it during this task.
- Histories diverged at merge base `9dd334c2357c6f44544a6b28bd095a8e1f434ef3`: main is about 269 commits ahead; Branch2 has about 43 branch-only commits.

Do **not** mechanically rebase/replay hundreds of commits. Build a clean Branch2 candidate from exact current main and reapply only proven Branch2 environment deltas.

## Live Branch2 identity — already verified read-only

A read-only Cloudflare audit ran successfully in GitHub Actions:

- workflow: `Branch2 sync read-only audit`
- successful evidence run: `35113616022`
- only `d1 list`, SELECT and PRAGMA were used; `rows_written=0`.

Live Branch2:

- Worker: `orders-app-branch2`
- D1 logical name: `orders_db_branch2`
- live D1 ID: `40065052-854e-44b8-bcd5-251bdd488301`
- title marker: `Система заказов 2`

The old Branch2 `wrangler.jsonc` still points to the correct live DB.

## Proven Branch2-specific invariants to restore on top of current main

Starting from `f183c41...`, preserve only these unless a new audit proves another delta is truly environment-specific:

1. `wrangler.jsonc`
   - Worker name `orders-app-branch2`
   - binding `DB`
   - `database_name = orders_db_branch2`
   - `database_id = 40065052-854e-44b8-bcd5-251bdd488301`
   - must not contain `orders_db_prod`
   - preserve current-main non-environment Wrangler behavior/options when compatible.
2. `index.html` title exactly `Система заказов 2`.
3. `worker/domains/auth.ts`, `verifySimpleAdminPassword`: retain Branch2 fallback safety. If no stored admin hash exists, read `require_stored_admin_password`; when it is `1`, return false rather than falling back to env/default password.
4. Port/update `scripts/test-branch2-environment.mjs` to the current main tree and append it to the **current** cumulative `release:check`. Do not replace the current release chain with the old shorter Branch2 package script.
5. If a structural preservation manifest needs an environment-specific registration, update only the intended semantic delta. Do **not** restore stale Branch2 `listOrders` logic merely because an old Branch2 manifest recorded it.

## D1 safety — critical finding

Never run blanket `wrangler d1 migrations apply` on Branch2.

Read-only audit found:

- `d1_migrations` has only 47 rows and ends at `0044_v72_operation_integrity.sql`.
- Branch2 nevertheless contains post-0044 schema/behavior, so later effects were at least partly introduced outside the migration journal or via historical sync work.
- Therefore journal absence is **not** proof that a migration should be replayed.

Confirmed missing from live Branch2:

- `catalog_products.gender_scope` — 0068 not applied.
- 0068 support tables absent: `catalog_gender_scope_repairs`, `catalog_gender_variant_repairs`, `catalog_gender_stock_baseline`.
- `return_items.physical_tracking` and `return_items.physical_received_at` absent.
- `exchange_items.physical_tracking` and `exchange_items.physical_received_at` absent.
- audited indexes from 0065, 0066, 0067 and 0069 absent.

Migration character:

- 0065/0066/0067: additive indexes only.
- 0069: additive columns + indexes.
- **0068 is data-changing**: adds product-level `gender_scope`, creates audit/baseline tables, classifies product scopes, may remap/merge blank-gender variants and canonical references/current stock. Treat it as the high-risk migration.

Before any D1 write, create a Branch2-only recoverable backup/export/snapshot. Never copy Primary data into Branch2.

Then compare 0045–0064 migration effects with actual `sqlite_master`, PRAGMA columns, indexes/triggers and relevant business invariants. Apply **only genuinely missing effects**. Do not replay a migration simply because it is absent from the journal. If a migration is materially already present, leave business rows untouched; reconcile journal state only after exact equivalence is demonstrated.

### 0068 preflight required before write

Use SELECT-only analysis first. Report counts for:

- products by intended `gender_scope` rule;
- active blank-gender variants;
- proposed in-place variant changes;
- proposed variant merges and keeper IDs;
- affected stock rows/quantities/reserved quantities;
- affected `order_items`, `workshop_tasks`, `inventory_reservations`, aliases, lifecycle, transfer, stock-check/stocktake references.

Abort rather than guess if merge/keeper semantics are ambiguous. Only after the preflight is coherent should 0068 be applied to Branch2, followed by explicit postcondition checks.

## Candidate validation before moving `branch2`

On the clean current-main-derived candidate with Branch2 environment restored:

- `npm ci`
- `npm run release:check`
- `npm run verify:db-safety`
- `npm run build`
- `npm run lint` — no new errors; unchanged known warnings are acceptable
- Wrangler dry-run against Branch2 config
- PR #70 focused resolver regression must pass
- Branch2 environment test must pass
- grep/audit that no Branch2 runtime/config points at `orders_db_prod`

Only after source + D1 schema are compatible and gates are green, update `branch2` to the exact validated candidate. A force update is acceptable because the old Branch2 head is already preserved in `backup/branch2-before-sync-20260916`.

Then require **exact matching** `cloudflare-deploy/branch2` success for the final SHA. Verify Cloudflare built/deployed `orders-app-branch2`, not Primary.

## Post-deploy smoke

Read-only smoke after exact deployment:

- `/api/health`
- app title = `Система заказов 2`
- admin-mode status/login preserves stored-password-required guard
- Orders / Workshop / Warehouse / Finance open without server errors
- resolver review/context endpoints work against Branch2 with the new API contract
- no request/config touches Primary D1.

# Resolver manual-acceptance fixtures — Branch2 only

Create temporary orders using the **normal application/API order creation path**, not raw SQL. This deliberately exercises order creation too.

Use obvious markers such as `TEST RESOLVER 20260916 A`, etc. No real customer contacts, no real payments, no real shipping. Prefer unpaid/zero-payment orders where supported. Never create them in Primary.

Prepare each case up to the point where the user can manually trigger/open the resolver. Do not auto-finish the only copy before screenshots are taken.

## A — combined no-color + no-size

Unresolved stock line that maps to an exact existing SKU whose canonical facts are `БЕЗ ЦВЕТА` + no size. Expected UX: **one combined confirmation**, not two questions.

## B — compound name + explicit new-reference confirmation

Unresolved line whose raw name contains a known base product plus a remainder token/phrase. Expected UX:

1. ask what the remainder means (material/color);
2. if the resulting value is not already in references, ask separately for explicit reference creation/approval before save.

If a genuinely new reference is required, use an obvious disposable TEST-prefixed value.

## C — exact existing combination

Facts uniquely match an existing canonical variant. Expected UX: converge to one `Подтвердить товар`, with no unnecessary reference creation.

## D — unknown gender historical exception

Genuinely unresolved historical-style row with unknown gender. Verify:

- manager/ordinary path does not invent a gender or genderless canonical SKU;
- admin-only legacy exception remains separate;
- using the legacy exception does not create a canonical SKU with unknown gender.

## E — lazy full-catalog loading

Open an ordinary resolver case while observing requests. Opening the resolver must **not** fetch full `/api/catalog`. Small candidate/context reads are expected. Full catalog may load only after explicit advanced/admin fallback (`Не нашли правильный вариант?` or equivalent).

## F — Workshop product-only

Workshop line requiring catalog resolution. Expected UX: stop at base-product selection/confirmation; do not ask warehouse SKU color/size/material questions.

## G — sequential multi-item / replay safety

One order with 2–3 unresolved positions. Expected:

- positions resolve sequentially;
- double-click cannot replay mutation;
- if practical, simulate one post-write recheck/read failure and prove retry rechecks without replaying successful mutation;
- after final resolver item, flow re-enters existing `markOrderSentToClient` instead of bypassing it;
- existing handover/warehouse/catalog blockers still execute.

## Leave fixtures for the user

At task end, leave at least one untouched/manual-ready copy of each useful case (or a smaller set only when one order cleanly covers several cases without losing clarity). Return a compact table containing:

- fixture letter;
- Branch2 order ID and external ID;
- visible marker/customer;
- exact button/action to click to open resolver;
- expected first question/screen;
- whether admin mode is required.

Do not send any fixture to a real client and avoid consuming real stock.

## Cleanup happens only after user UX acceptance

After screenshots/manual acceptance, cleanup via supported app/admin flows: cancel/delete/archive test orders, verify no active reservations/workshop tasks remain, and remove TEST-only aliases/reference values only when unused and supported. Do not raw-delete business rows for convenience.

# Required final Astra report

Return:

1. old Branch2 SHA, candidate SHA, final deployed Branch2 SHA;
2. exact Branch2 Cloudflare build/deploy/check run IDs and conclusions;
3. exact D1 backup method/reference;
4. schema audit: which 0045–0069 effects were already present vs newly applied;
5. 0068 preflight counts and postcondition counts;
6. validation command results;
7. resolver fixture order IDs/table;
8. every intentional residual difference between main and Branch2.

If any step could touch `orders_db_prod`, Primary Worker `orders-app`, or 0068 proposes an ambiguous merge, stop and report instead of guessing.
