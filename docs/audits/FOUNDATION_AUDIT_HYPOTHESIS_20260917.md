# Foundation audit — working hypothesis — 2026-09-17

## Status

This is **not an approved implementation plan** and not a rewrite proposal. It records the architectural hypothesis that now needs to be proved or disproved across the system before local fixes or the price/cost/warehouse expansion are designed.

Branch2 code baseline under analysis: `fb43e8d709b57b67cc080bb9bd64246bb036aede`.

## Why the previous M-01..M-08 findings are not yet the root cause

M-01..M-08 reveal recurring symptom classes:

- multiple entry points implement the same business problem differently;
- UI conflates unknown/default/inferred/local/persisted values;
- applicability/eligibility is checked too late;
- generic explanatory copy hides contextual rules;
- old and new workflows coexist.

These are useful but still one level above the likely foundation problem.

## Current foundation hypothesis

The application began as a **record-centric CRUD model** (orders, order_items, stock rows, coarse statuses and snapshots), while the business has evolved into a **workflow/lifecycle system** (reservation, handover, catalog identity resolution, workshop completion, delayed physical returns, exchanges, financial events, reversals, future cost/payables).

New lifecycle semantics have been added incrementally and often correctly, but there is no single explicit cross-cutting contract that tells every backend domain and every UI surface:

1. which representation is authoritative for a business fact;
2. which values are historical snapshots versus current master data;
3. which state dimensions are independent;
4. which command is allowed to transition a state;
5. which side effects must happen atomically/idempotently;
6. which read model ordinary users should see.

The likely root problem is therefore:

> **Business truth and lifecycle ownership are distributed across records, legacy fields, side tables, endpoints and UI-specific state machines instead of being consistently exposed through one domain contract/read model per business process.**

This does **not** mean multiple tables are inherently wrong, nor that the system needs event sourcing or a rewrite. Historical snapshots, current stock, movements and reservations legitimately differ. The problem is when screens independently reconstruct meaning from them or when a coarse legacy field remains visible beside a newer authoritative process.

## Evidence already found

### Workshop

`orders.workshop_status` is a coarse order-level field, while actual work is now represented by per-item Workshop tasks. A stock-only order can retain a coarse `in_workshop` value even though no Workshop task exists. The Orders table partly protects against that by checking actual Workshop items; the generic order editor still exposes the coarse field.

This is a truth-ownership problem, not a wording problem.

### Catalog / resolver

Order item input snapshots and canonical catalog identity (`product_id` / `variant_id`) can diverge. Resolver can correctly link a canonical variant while an operational surface still displays the old snapshot. Aliases, executions and variants add valid identity layers, but the UI does not always consume one resolved operational projection.

### Inventory

Physical stock, reserved quantity, movement history and pending lifecycle events are different legitimate facts. Several flows still make each screen decide how to combine them. The Warehouse UI consequently exposes concepts from the storage model instead of consistently answering the employee's current business question.

### Reports

Order date, payment date, return date and current debt are legitimately different clocks. The backend preserves those distinctions, while a global UI sentence collapses them into one false rule. This is another example of a rich domain model being flattened incorrectly at the presentation boundary.

## Return / exchange physical receipt: an important positive counterexample

The current return/exchange implementation is evidence that the application is **not fundamentally unsalvageable**.

Migration 0069 explicitly acknowledges that the old workflow could not distinguish:

- not received yet;
- physically received but intentionally not restocked.

The new model adds physical receipt tracking. Current UI/backend distinguish at least:

- `pending` — item has not physically arrived;
- `warehouse` — arrived and should go to Warehouse;
- `boutique` — arrived and should go to Boutique when allowed;
- `no_stock` — physically arrived but intentionally not returned to sellable stock.

Financial return/exchange and physical receipt are therefore separate dimensions. Delayed receipt can later trigger the inventory lifecycle, and an unresolved catalog identity can leave the stock side pending instead of pretending the item was stocked.

This is closer to the desired architecture: a real-world state is represented explicitly instead of overloaded into one boolean/status.

However, the full Return/Exchange lifecycle is **not yet accepted as correct**. We still need to audit:

- cancellation after money and/or physical receipt;
- stock reversal if an already-received return/exchange is cancelled;
- partial quantities;
- delayed receipt after the financial operation;
- `no_stock` semantics and how it appears in analytics;
- unresolved inventory lifecycle events;
- Workshop return restrictions;
- exchange old-item receipt plus new-item issue plus extra payment/refund;
- admin financial corrections;
- what ordinary users actually understand from the UI.

Astra RUN 1 did not execute these end states, so it is insufficient evidence by itself. The already-prepared targeted Admin RUN 2 includes these controls; a separate broad walkthrough is not justified yet.

## Consequence for future profitability

Product profitability cannot treat a return as one single event.

Example:

1. customer refund is completed today;
2. returned item is still `pending` in transit;
3. three days later it arrives;
4. it is either returned to sellable stock or marked `no_stock`.

The money side should affect net revenue when the refund happens. The physical/cost side should only recover inventory value when the item is actually received into sellable stock. `no_stock` must not silently restore inventory value.

Exchanges require the same split across the old item, new item and any financial difference.

Therefore future cost/profitability reporting must consume Return/Exchange physical disposition, not merely `return_amount` or a raw return count.

## What the next audit must produce before a fix plan

Build a cross-system **business truth / lifecycle map**, not another screenshot bug list.

For each major domain answer:

| Domain | Real-world lifecycle to map |
|---|---|
| Product identity | raw employee input → canonical product → execution → variant → active/retired assortment |
| Physical goods | arrival/workshop completion → location → reservation → issue/handover → return transit → receipt/disposition |
| Order | create/edit → reserve → send/hand over → return/exchange/cancel/archive |
| Workshop | requested item → active task → ready → received/issued/returned |
| Money | sale snapshot → payments/debt → refund/exchange delta → reversals/corrections |
| Future cost/payables | unit cost snapshot → stock valuation → Workshop invoice → partial/full payment → running payable balance |

For every state transition record:

- authoritative source;
- historical snapshot(s);
- derived read model(s);
- command that changes it;
- preconditions;
- side effects;
- idempotency/concurrency guard;
- reversal/correction path;
- UI entry points;
- what an ordinary employee should see and what should remain internal.

Then compare actual code against this map. The mismatches are architectural defects; only after that should they become an implementation plan.

## Current diagnostic position

There is concrete evidence that the user's discomfort is not merely subjective: multiple screens currently expose conflicting or inapplicable representations of the same business reality.

There is also concrete evidence against a total rewrite: critical-operation handling, inventory lifecycle, reservations, money events, and the newer physical return tracking already contain useful domain safeguards.

The likely task is therefore **convergence and simplification around authoritative lifecycles**, not replacing the whole system and not adding more local guards.