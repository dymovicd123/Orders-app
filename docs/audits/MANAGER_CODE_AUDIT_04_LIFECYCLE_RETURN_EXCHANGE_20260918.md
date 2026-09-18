# Lifecycle code audit — Astra Phase 1 follow-up — 2026-09-18

## Scope

Code review against Astra's live Branch2 lifecycle walkthrough in `SYSTEM_UX_WALKTHROUGH_ASTRA_LIFECYCLE_20260917.md`.

Branch2 baseline rechecked before analysis: `fb43e8d709b57b67cc080bb9bd64246bb036aede`.

No Branch2/Production code or D1 data changed. This file records architecture findings only.

## What Astra established

The tested Return path is materially healthier than several older flows:

- refund money and physical receipt are separate;
- pending receipt survives reload;
- receipt to Warehouse adds one unit once;
- cancelling the tested received Return removed the stock contribution and the active refund;
- `no_stock` preserves physical receipt without restoring sellable inventory;
- Finance arithmetic stayed coherent across those transitions.

The observed defects are primarily cross-surface projection/meaning defects, not evidence that the Return write-path lost state.

## Q1 — Why Return history and stock describe the same thing differently

This is explained by two intentionally different data layers.

`getOrderItemForReturnOrExchange()` loads the order-time snapshots plus `product_id/variant_id`.

Return/exchange history persists the snapshots:
- `product_name_snapshot`
- `gender_snapshot`
- `color_snapshot`
- `material_snapshot`
- `length_snapshot`
- `size_snapshot`

Inventory lifecycle resolution, however, prefers an existing valid `variant_id`. `resolveInventoryLifecycleCandidate()` loads the current canonical variant snapshot and applies that canonical product/variant to `inventory_stock` and `inventory_movements`.

Therefore the TEST-BE behavior is structurally expected:
- operation/history can say the historical raw/snapshot wording;
- stock can show the resolver-linked canonical SKU.

This is **not proof of wrong stock posting**. It is evidence that the UI has no shared operational projection that tells a human “historically entered as X, currently counted as canonical Y”.

This strongly supports the foundation hypothesis: two legitimate truths exist, but each screen chooses one without exposing their relationship.

## Q2 — What “Возвращён” means in the Orders table

The current UI does not derive this from physical return completion.

`isReturnedOrderRecord(order)` is simply:

`return_amount > 0`

and `orderLifecycleLabel()` also returns `Возвращён` whenever `return_amount > 0`.

The Orders table then uses that same boolean to hide ordinary Return/Exchange/Edit actions and displays one locked label `Возвращён`.

This is more serious than Astra's L-01 wording issue.

A positive **financial refund aggregate** is being promoted to a coarse **whole-order lifecycle state**.

Consequences:
- pending physical receipt still looks finished;
- `no_stock` and Warehouse receipt collapse to the same order state;
- a partial refund can make the whole order appear “returned”;
- the table hides Return/Exchange actions even though the backend Return implementation explicitly supports remaining quantities and multiple active returns.

This is a clear truth-ownership defect: one monetary field is being reused as order lifecycle/completion state.

## Q3 — Why a fully refunded order still says “Оплачено / Получено”

The server financial ledger deliberately stores different facts:

- `received_amount` = gross positive payments;
- `return_amount` = active refunds;
- `debt_amount` = `total_amount - received_amount`.

Refunds do **not** turn debt back into customer debt, which is sensible. Finance separately computes net money.

The Orders table, however:
- prints `received_amount` under “Получено”;
- `paymentStatusLabel()` says “Оплачено” when debt is zero and gross received is positive;
- does not show `return_amount` beside it.

So Astra's L-03 is a **read-model problem, not an arithmetic bug**.

The backend preserves useful gross history and active refunds; the row presents only half of that model and therefore makes “Оплачено / Получено” look like retained money.

## Q4 — How Return cancellation decides whether to reverse physical stock

`cancelInventoryLifecycleEvent()` first checks whether physical reversal is still safe.

It deliberately skips changing physical quantity when:
- a stocktake is currently active;
- a later exact physical stock check exists for the same source + variant;
- reversing an inbound event would make current physical quantity negative;
- the lifecycle event lacks a trustworthy event timestamp.

If none applies, it writes the exact inverse inventory movement.

If reversal is skipped, the lifecycle event is still cancelled, but the newer/stronger physical fact is preserved and the reason is stored on the lifecycle event.

This is a relatively strong piece of architecture: an administrative cancellation does not blindly overwrite newer physical reality.

The physical receipt timestamp itself is not erased. That also explains Astra's observed text `Получен; проведение в Склад отменено`: “the item was physically seen/received” remains historical fact, while this Return no longer owns an active inventory effect.

Open business question: if a Return is financially cancelled after a real physical receipt, what operational disposition should the received item have? The code preserves the historical receipt and can reverse its stock contribution, but the business meaning of where that real item went is not represented as a separate post-cancellation disposition. Do not call this a bug until the intended business rule is confirmed.

## Q5 — Exchange submit remains enabled during shortage

Frontend allows the primary `Оформить обмен` button to remain enabled while showing shortage.

The backend is stricter and checks the replacement **before it creates the Exchange record**:
- resolve canonical replacement variant;
- read physical stock;
- if physical < requested and no explicit observed physical count was supplied, throw;
- if the supplied observed physical count is below requested, throw.

Only after this preflight does it insert `exchanges` and mutate old/new items.

Therefore Astra's unsubmitted E1 does **not** reveal a data-integrity hole. The backend would reject the ordinary shortage case before persisting the Exchange.

But the UI violates the “simplest visible action is safe/correct” principle: a clearly impossible draft still advertises the final submit as available and relies on backend rejection.

## Q6 — Why cancellation immediately opens a new Return form

This is explicit frontend behavior, not an incidental render artifact.

After a successful cancellation, `cancelReturnEntry()`:
- upserts the returned order;
- sets `returnSelectedOrderId` to that order;
- creates a new Return draft from the updated order.

That directly explains Astra L-04.

The cancellation comment is also hard-coded to:

`Отменено из интерфейса Cloudflare`

and this comment is sent to the backend and stored as `returns.cancellation_comment`. It is not merely hidden technical provenance.

Both are presentation/workflow defects, not server correctness defects.

## Fundamental conclusion from this vertical slice

The Return lifecycle itself is one of the better parts of the system.

Its main state dimensions are explicit:
- financial refund;
- physical receipt;
- destination/disposition;
- inventory lifecycle application;
- cancellation/reversal.

The deeper problem appears at the **projection boundary**.

The application repeatedly takes one legitimate domain fact and uses it as a shortcut for a broader human state:

- `return_amount > 0` becomes “the order is returned”;
- gross payments become “Оплачено / Получено” without adjacent refund/net context;
- historical snapshots become the operation description while canonical identity becomes stock description, with no relation shown.

This is stronger evidence for the current foundation hypothesis than the earlier isolated UI findings.

The recurring defect is not merely “too many statuses”. It is:

> **the write model contains multiple correct dimensions, but screens do not consume a single intentional business read-model; each surface promotes whichever local field is convenient into the human meaning of the whole process.**

That creates apparent contradictions even when the underlying transactions are internally consistent.

## What this means for the next audit

Do not redesign Return/Exchange from scratch.

Preserve:
- explicit delayed physical receipt;
- Warehouse/Boutique/no-stock disposition;
- canonical inventory lifecycle;
- guarded exact reversals;
- gross payment + refund history;
- critical-operation/idempotency protections.

Next architectural audit should look for the same projection failure across:
1. order lifecycle;
2. product identity/resolver;
3. physical stock/reservations;
4. Workshop;
5. price/cost/payables.

For each domain, identify the authoritative write facts **and separately define the one operational read-model ordinary users should consume**.

That distinction now appears to be the most promising root-level explanation for the system's “strange” and fragile feel.

## Stop point

This file answers Astra handoff questions 1–6 from code except for the final business interpretation of post-cancellation physical disposition, which requires an explicit business rule rather than more source inspection.

No implementation changes were made.
