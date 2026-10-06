# Exchange Set V2 — current Branch2 continuation

Date: 2026-10-05  
Repository: `dymovicd123/Orders-app`  
Work branch: `w-exchange-set-v2-20261005`  
Target: **Branch2 only**  
Green candidate before this documentation checkpoint: `1e73b99649248d388d087f23251296a73d302def`  
Quality run: **37347886635 — success** (cumulative regression gate + TypeScript + clean build + Wrangler dry-run)

## Why this exists

The old Exchange UI and H9C batch model still represented the business operation as several explicit **old → new pairs**. That was technically resumable, but it forced operators to invent one-to-one correspondence that does not exist in real exchanges.

The current itemized Exchange model is now a single business operation with two independent collections:

- **old items removed from the order**;
- **new items added to the order**.

There is no required pairing and cardinalities may differ.

Legacy `legacy_manual_total` orders keep the previous compatibility flow. Production/main is not part of this change.

## Accepted commercial / money semantics

For `itemized_v1`:

`new order total = current order total - historical sold value removed + sold value added`.

Rules:
- removed value uses each old row's persisted historical `unit_price`; current Catalog never reprices the old sale;
- each new row has factual `unit_price` plus separate historical `catalog_price_snapshot`;
- current Catalog is only a recommendation source;
- `line_total = quantity × unit_price`;
- actual net paid is `received_amount - return_amount`;
- if new total is greater than net paid, the remainder is debt; the operator may receive all, part, or none of it now;
- if net paid is greater than new total, the server derives the exact refund amount and requires only its method;
- the operator no longer manually chooses “no money / extra payment / refund” for smart itemized Exchange;
- server revalidates all old price/quantity snapshots and the starting order total before mutation.

Concrete client scenario now maps naturally:
- already paid 4,000;
- final exchanged goods total 24,000;
- resulting debt is 20,000;
- receiving 20,000 by Kaspi closes the debt without any fake surcharge or price rewrite.

## Physical truth of old items

Each selected old line has its own physical state:

- `not_issued`: client never received it; remove only the reservation / unfinished Workshop obligation, **do not add Physical**;
- `pending`: client still has it; Exchange completes commercially, but the old line appears in the delayed-return queue;
- `warehouse`: already returned, add to Warehouse through the normal lifecycle path;
- `boutique`: already returned, add to Boutique;
- `no_stock`: physically returned, but deliberately do not add to tracked stock.

Important safeguards:
- stock-backed rows use exact per-item `stock_writeoff_status` to decide whether they were issued;
- Workshop rows do not have the same stock-fulfillment status, so a sent order is the Workshop-specific fallback for physical handover;
- a contradictory `not_issued` claim is rejected server-side when physical handover is already proven;
- an unissued reserved item never performs a fake “-1 then +1” stock round trip.

## Delayed return queue

Pending old items are shown as grouped Exchange returns.

UX:
- one group per Exchange;
- every old line chooses its own final destination (Warehouse / Boutique / no stock);
- one “Подтвердить прибытие всех товаров” button processes the group;
- partial-arrival UI was deliberately not introduced.

Runtime safety:
- each Set V2 delayed old line has its own lifecycle key `exchange:<exchangeId>:old:<exchangeItemId>`;
- parent `exchanges.old_return_source` is **not** overwritten for Set V2, because one operation may contain several different destinations;
- legacy single-item Exchange keeps its historical parent-field/event-key semantics;
- grouped UI receipts reuse the idempotent per-item receive operation, stop on the first failure, invalidate stock caches, and defer expensive history/inventory refresh until the group pass finishes.

## New-item flow

Smart Exchange starts with one ready blank new row and can add/remove any number of rows.

New rows keep:
- Catalog-aware product/material/length/audience price recommendation;
- manual sold-price override without silent overwrite;
- Warehouse / Boutique / Workshop source;
- quantity and exact characteristics;
- explicit physical-count confirmation when tracked Physical is insufficient;
- Workshop comment, urgent flag, due date and due time.

## History

The history API now exposes:
- `isSetExchange`;
- complete `oldItems[]`;
- complete `newItems[]`;
- per-line physical receipt/lifecycle truth.

Search matches all old/new product names. Pending-return summary counts all pending old lines for Set V2 while preserving the exact legacy first-old-item projection for old consumers.

## Cancellation

Set V2 cancellation is one logical operation and:
- cancels/reverses all Exchange lifecycle events when safe;
- retires all new order rows/reservations/Workshop tasks;
- restores every old quantity and its historical sold line value;
- restores a never-issued reservation instead of manufacturing Physical;
- reverses linked extra payment or refund;
- recomputes order total from active itemized lines;
- refuses cancellation when a new item has already been consumed by a later active Exchange or standalone Return.

Fresh physical truth still wins: lifecycle cancellation uses the existing stocktake/later-check/insufficient-physical guards.

## Compatibility / schema

- no migration was introduced;
- `legacy_manual_total` Exchange still uses the previous compatibility path;
- H9A/H9B/H9C tests remain green as historical compatibility coverage;
- Set V2 is identified durably through the `exchange_set_create` critical-operation lineage, not by nullable parent columns.

## Direct regression gates added

- `scripts/test-exchange-set-v2.mjs`
- `scripts/test-exchange-set-v2-ui.mjs`

The change is additionally wrapped by the existing exact runtime/190.6 structural preservation layers through:
- `scripts/exchange-set-v2-20261005-worker-manifest.json`
- `scripts/exchange-set-v2-20261005-frontend-manifest.json`

## Post-merge safety audit — 2026-10-05

After PR #285 merged to Branch2, a second focused audit found two edge cases and fixed them on the follow-up branch:

1. **Cancellation after later money movement.** A Set V2 cancellation now freezes a pre-mutation cancellation plan, proves the projected restored order total and projected net paid, and refuses to proceed if cancelling the Exchange would leave unexplained overpayment or refunds greater than retained payments. Old-line restore quantities use frozen baseline/target values, so a lost response/retry cannot add the exchanged quantity twice.
2. **Repeated identical new SKU rows.** Smart Exchange now aggregates their total physical demand before showing availability. One shared physical observation is propagated across the identical rows, matching the backend's grouped-SKU preflight instead of letting each row appear independently sufficient.

Quality run for the follow-up runtime candidate `9f2678eb6267e0138236ded68c255a9916768457`: **37349436746 — success**.

## Current checkpoint / next action

PR #285 runtime was merged to Branch2 at `d6e08c2a4028ff7fc256884b2496a0204f1611f7`.
Exact merged-SHA safety run **37348603139 — success** and Cloudflare deploy monitor **37348603110 — success**; native Cloudflare build succeeded, so guarded direct fallback was skipped.

Follow-up safety branch: `w-exchange-set-v2-postmerge-safety-20261005`; runtime candidate `9f2678eb6267e0138236ded68c255a9916768457` passed Quality run **37349436746**.

Next:
1. let the docs-only candidate pass Quality;
2. merge the reviewed branch into **branch2** only;
3. verify exact merged-SHA Quality / Branch2 deploy;
4. manually accept at least:
   - unsent old goods (no stock duplication);
   - the 4,000 paid / 20,000 Kaspi / 24,000 final-total scenario;
   - several old items → different number of new items;
   - mixed delayed-return destinations in one Exchange;
   - Workshop replacement including urgency/deadline;
   - cancellation after a clean Exchange;
5. after Exchange acceptance, continue the requested full **Return + Exchange** usability/business audit.

Do not promote to Production/main from this checkpoint without a separate explicit release decision.


## Manager-first UX follow-up — 2026-10-06

The Set V2 domain model above stays authoritative. This follow-up changes only how a manager sees and completes the workflow.

The old-item cards now separate three facts that previously looked alike:
- **in the order** — the real `order_items.quantity`;
- **available to exchange** — shown only when earlier operations reduced the remaining exchange capacity;
- **price** — the historical sold unit price, explicitly labelled as price.

This fixes the misleading case where an order line with quantity 1 and unit price 0 visually appeared as “0 / шт.” and could be mistaken for zero items or stock. Stock quantity is not presented as the old-order quantity.

The main form now asks only:
1. what the client returns;
2. what the client receives;
3. what happens with money.

New-item entry uses progressive disclosure: product, quantity and source are visible first; characteristics and pricing appear after product selection. Existing Catalog auto-fill, exact variant controls, stock-shortage confirmation and Workshop fields remain available underneath that simpler entry flow.

The money section no longer repeats the full arithmetic twice. It shows the new order total, previous total and already-paid amount, then one outcome: collect money, refund money, or no movement. The final Save area shows a short quantity/total summary and explains missing required input before submission.

History cards now summarize actual returned/issued quantities rather than old/new row counts. Pending-return and legacy-history wording was also rewritten for operators while preserving the same physical/lifecycle state.

Regression/preservation:
- `scripts/test-exchange-set-v2-ui.mjs` covers quantity-first cards, progressive new-item entry, plain-language money, save readiness and quantity-based history;
- `scripts/exchange-human-ux-20261006-frontend-manifest.json` plus its predecessor fixtures layer this delta over the already accepted Return/Exchange source-default and Exchange Set V2 baselines;
- both Branch2/main runtime preservation and the 190.6 frontend structural gate normalize this UX layer explicitly rather than weakening earlier exact checks.

Release evidence:
- final PR-head Quality `37441517474` — success;
- PR #291 merged to Branch2 at `3241634f3e99eb136e5bfd3a2637f23a3e7cefb2`;
- exact merged-SHA Branch2 safety `37441679060` — success;
- exact merged-SHA Cloudflare deploy monitor `37441678666` — success.

Manual acceptance is the next step. Production/main is still out of scope.
