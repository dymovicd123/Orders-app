# Orders-app — current project continuation context

Updated: 2026-09-04
Branch for continuation context only: `context/project-continuation`

This file is the canonical continuation point for ChatGPT work on the project. It is intentionally kept off `main` so context updates do not trigger a Production Worker deploy.

## User workflow requirements

- For each practical patch, provide one ready-to-run Windows CMD command/file from the project root when local execution is needed.
- Keep continuation context updated in GitHub; do not send standalone context files to the user unless explicitly requested.
- Before Warehouse patches, audit related flows end-to-end rather than fixing only one screen.
- Arrival UI is frozen and must not be changed.
- Prefer measured, minimal, reversible changes; especially for D1 read-budget work.
- Avoid `wrangler d1 execute --file` for small release/repair SQL in this project. Use bounded `--command` statements when practical because the D1 import endpoint previously produced `D1_RESET_DO` behavior.

## Current release state

### main / Production Worker

Current validated R5.6 release commit:

`fd0f509912a2939c8e9f0b84a7093b82a1d47c60`

Release contents:
- migration `0066_v72_d1_read_budget_r5_finance_summary_indexes.sql`;
- four additive indexes;
- two truth-equivalent runtime predicate rewrites where NULL had already been semantically excluded;
- focused R5.6 regression coverage;
- exact cumulative Worker declaration allow-list update;
- migration safety allow-list update.

PR #9 was squash-merged into `main`.

GitHub -> Cloudflare Production deploy monitor run `33875914433` completed successfully.

### Production D1

Production database: `orders_db_prod`

R5.6 migration 0066 was applied successfully using one statement per `wrangler d1 execute --command` call. Branch2 was not targeted.

Confirmed Production indexes:

- `idx_payments_payment_date_order_amount`
- `idx_orders_current_debt_partial`
- `idx_order_items_pending_writeoff_status_order`
- `idx_order_items_workshop_order_quantity`

Successful Production D1 apply/verify workflow run: `33876464739`.

Representative measured Production rows_read for 2026-08-01..2026-09-04, immediately before vs immediately after migration 0066:

- payment-method summary: `1595 -> 1595`
- current debt: `1321 -> 12`
- pending stock writeoff: `5208 -> 2`
- Workshop grouped aggregate: `3317 -> 1736`

Corresponding reductions:

- payment summary: no measured rows_read reduction on this range;
- current debt: about 99.1%;
- pending writeoff: about 99.96%;
- Workshop aggregate: about 47.7%.

`EXPLAIN QUERY PLAN` confirmed the intended indexes were selected:

- payments: `SEARCH p USING INDEX idx_payments_payment_date_order_amount`
- current debt: `SEARCH orders USING INDEX idx_orders_current_debt_partial`
- pending writeoff: `SEARCH oi USING INDEX idx_order_items_pending_writeoff_status_order`
- Workshop aggregate: `SCAN order_items USING COVERING INDEX idx_order_items_workshop_order_quantity`

Important: do not claim the payment index reduced rows_read based on this measurement. It was selected by the planner but measured `1595 -> 1595`.

### Branch2

Branch2 was not changed by R5.6 and remained at:

`adec6098777bebe4709615e1256cc5dd468b444d`

## Safety state at R5.6 release

Immediately before the successful Production D1 apply:

- full `release:check` passed;
- `verify:db-safety` passed;
- focused R5.6 regression passed;
- TypeScript/build/dry-run gates passed as part of release check;
- migration 0066 was additive only;
- Arrival UI was unchanged;
- Production target identity was verified before D1 commands;
- the first one-shot D1 workflow attempt failed only in diagnostic `jq` formatting before any migration statement ran; the corrected second run performed and verified the mutation successfully.

The temporary ops branch was reset back to the clean R5.6 release commit after the successful D1 run, so the one-shot mutation workflow is not left at the current branch tip.

## Order / Warehouse reliability state inherited into current release

Current release already contains the prior safety work, including:

- resumable order create/edit and browser idempotency;
- retry-safe order counters/reservations;
- controlled shortage/input failures;
- Workshop preflight;
- secondary read isolation;
- non-blocking shipping discrepancy behavior;
- order delete mobility with physical-truth freshness protection;
- return/exchange cancellation autonomy;
- manager-safe routine Warehouse operations;
- signed 12h admin session and server-owned actor headers;
- bounded D1 fan-out/mutation rowsets from Step 191E;
- daily Warehouse attention/context work from 192B2A*;
- movement picker UX from 192B2B.

## Next point

R5.6 itself is complete. Do not reopen it without new evidence.

Next read-budget work should start from fresh, read-only Production measurements. The next candidate label is R5.7, but only if a new forensic identifies a real high-read path with a measured optimization opportunity.

Preferred next action:

1. run a read-only Production baseline for remaining Finance and Orders Summary SQL paths;
2. record exact `rows_read` by query and period;
3. identify the largest remaining contributors;
4. change nothing until an index/query rewrite is demonstrated against the measured Production shape;
5. preserve business truth and all current release invariants.
