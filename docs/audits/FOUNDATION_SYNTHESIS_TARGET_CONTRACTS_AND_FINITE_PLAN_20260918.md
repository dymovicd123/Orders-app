# Foundation synthesis — target truth contracts + finite repair sequence — 2026-09-18

## Scope and safety

Repository: `dymovicd123/Orders-app`

Rechecked baseline before synthesis:
- Branch2: `fb43e8d709b57b67cc080bb9bd64246bb036aede`
- audit branch before this document: `56f253e8605ebe03e0afd97b05ddadde8f8a71fc`

This document synthesizes the five completed truth-map slices:
1. Order lifecycle;
2. Product identity;
3. Physical Stock;
4. Workshop;
5. Money / Finance / pricing readiness.

It also uses the completed Astra Manager and Return/Exchange lifecycle evidence.

Important limitation: `SYSTEM_UX_WALKTHROUGH_ASTRA_RUN2_ADMIN_20260917.md` in the repository is a targeted RUN-2 instruction/specification, not a completed Admin-results report. This synthesis therefore does **not** pretend that a full live Admin GUI pass was completed. Existing Admin conclusions below come from code audit and the observed simple Admin entry boundary, not from an unperformed GUI run.

No Branch2 or Production D1 mutation is part of this synthesis.

---

# 1. Final foundation diagnosis

The project does not primarily have a “bad database” or “missing safety everywhere” problem.

The strongest repeated pattern across all five domains is:

> **The low-level write model often preserves the real business facts correctly, but the application lacks one explicit cross-domain contract for how those facts become current human meaning.**

As a result:

- a historical snapshot is sometimes shown as current identity;
- a cache is sometimes read as if it were the underlying ledger;
- one monetary aggregate becomes a lifecycle label;
- one coarse order field competes with stronger per-item workflow truth;
- one generic report shell tries to describe several different business clocks;
- the same reusable master-data fact can be created from more than one domain implementation;
- future commercial analytics are tempted to infer facts that were never actually captured at line level.

This explains why the project feels patch-driven even when individual write operations are reasonably safe.

The finite repair principle is therefore:

> **Do not rewrite the strong transaction machinery. Declare one owner for each fact, classify history/cache/compatibility explicitly, add only the genuinely missing business facts, then make every UI consume shared projections built from those owners.**

---

# 2. Target truth classification

The following classification should become the architectural contract used during implementation.

## 2.1 Order / customer-operation domain

| Fact / field | Target classification | Notes |
|---|---|---|
| `orders.id / external_id` | authoritative identity | Stable order identity. |
| `orders.order_date` | authoritative business date of order | Not the business date of later money/return operations. |
| `orders.order_status` | authoritative administrative record state | Active/closed/archived/deleted. Must not be treated as universal operational lifecycle. |
| `orders.shipping_status / shipping_date` | authoritative whole-order shipping milestone | Does not replace item-level handover/reservation facts. |
| `orders.workshop_status` | compatibility / lossy cache | Current per-item Workshop task truth is stronger. Stop independent business ownership. |
| `orders.total_amount` | authoritative **current commercial order amount** | Mutable through exchange commercial adjustments; not immutable original sale value. |
| `orders.received_amount` | derived/cache | Rebuilt from `payments`. |
| `orders.return_amount` | derived/cache | Rebuilt from active `returns`. Never use as whole-order “returned” lifecycle. |
| `orders.debt_amount` | derived/cache | Current customer obligation = total - received. Not net cash or profit. |
| `order_items.product_id / variant_id` | authoritative current canonical links when resolved | Operational identity links. |
| `order_items.*_snapshot` | immutable historical/raw order wording | Keep history. Do not overwrite merely to make UI look current. |
| `order_items.quantity` | current active composition quantity | Exchange mutates it; therefore not a pure immutable original-sale ledger. |
| `order_items.unit_price / line_total` | intended historical commercial line snapshot | Correct location, but new create flow currently writes zero, so contract is not fulfilled yet. |
| `exchange_items / return_items` | operation history/snapshots | Preserve deltas/history around changed current composition. |

### Required shared projection

Create one reusable **OrderOperationalProjection** concept.

It should compose, without inventing a new universal status column:

- administrative record state;
- whole-order shipping milestone;
- item-level handover/remaining reservation state;
- Workshop progress derived from actual Workshop tasks;
- money: total / gross received / refunded / net retained / debt;
- Return/Exchange active and pending physical facts;
- catalog-resolution completeness;
- next valid action(s).

The same projection should feed:
- Orders table;
- order details;
- resolver entry;
- Return/Exchange entry;
- Warehouse links back to an order.

No screen should recreate lifecycle meaning from raw `return_amount`, `workshop_status`, etc.

---

## 2.2 Product / catalog identity domain

| Fact / field | Target classification | Notes |
|---|---|---|
| `catalog_products.id` | authoritative base-product identity | Stable current product identity. |
| `catalog_products.name` | current canonical label | Rename must preserve recognition continuity. |
| `catalog_products.is_active` | current selectable/assortment flag, pending exact retirement policy | Do not over-interpret as complete sell-through/replenishment policy. |
| `catalog_stock_positions` | authoritative execution identity | Product + material + length. |
| `catalog_variants.id` | authoritative exact SKU identity | Execution + category/gender/color/size. |
| variant copied material/length | compatibility/denormalized copy | Execution should conceptually own these values. |
| `reference_values` | authoritative allowed vocabulary | Not SKU identity. |
| `catalog_product_aliases` | recognition map | Raw naming → current product. |
| `catalog_value_aliases` | normalization map | Raw attribute value → canonical value. |
| `catalog_input_aliases` | recognition shortcut | Full confirmed raw input → exact canonical variant, with identity verification. |
| `inventory_stock.*_snapshot` | mutable current display cache | Despite “snapshot” naming, not immutable event history. |
| `inventory_movements.*_snapshot` | immutable event-time description | Historical. |

### Required current-vs-history projection

Every operational surface must be able to answer separately:

1. **Что записали тогда?** → historical snapshot.
2. **Что это за товар в системе сейчас?** → canonical product/execution/SKU.
3. **Как он назывался в конкретной операции?** → event snapshot where relevant.

For active work, canonical identity should normally be primary after resolution.
Historical raw wording should remain available as history/context, not masquerade as unresolved current identity.

---

## 2.3 Resolver / master-data ownership

Resolver currently has two different business jobs:

1. link an order line to existing canonical data;
2. create new reusable catalog/master data when it genuinely does not exist.

These jobs must remain conceptually separate.

### Target contract

**Ordinary working mode may:**
- answer a concrete business fact;
- select an existing product/SKU/reference;
- link the order line to an already-existing canonical identity.

**Simple Admin mode is required only at the exact mutation that creates/changes reusable master data.**

Do not:
- send all ambiguity into “admin required”;
- create proposal queues;
- create a new approver workflow;
- force the employee to leave the current task and remember a separate maintenance queue.

When a current task needs Admin authority, the existing simple Admin mode should be activated at that same context and return to the same task.

### Duplicate owner to remove

Warehouse Arrival must no longer own a separate implementation for creating:
- product;
- execution;
- variant;
- reference-like reusable facts.

Arrival can request/consume the same canonical **catalog master-data command** used by Catalog/Resolver.

One fact → one mutation owner.

---

# 3. Physical Stock target contract

| Fact / structure | Target classification | Notes |
|---|---|---|
| `inventory_stock.quantity` | authoritative current physical quantity | Current physical count. |
| active `inventory_reservations` | authoritative promised/reserved obligation ledger | Business reservation truth. |
| `inventory_stock.reserved_quantity` | derived/cache | Keep for D1 efficiency, but reconcile against reservation ledger. |
| free quantity | derived | physical - active reserved. |
| `inventory_movements` | immutable movement history | Provenance/history, not current count authority by itself. |
| `inventory_stock_checks` | physical observation/history | Later physical count can supersede inference. |
| completed stocktake results | strong physical truth boundary | Preserve conflict-safe completion semantics. |
| `inventory_lifecycle_events` | domain-event history for Return/Exchange/etc. | Preserve idempotent/reversal logic. |

## 3.1 What not to simplify away

Preserve:
- physical count separate from reservation;
- negative free stock as visible shortage;
- exact physical count stronger than older inferred event;
- stocktake atomicity and baseline conflict handling;
- Return physical receipt separate from refund money;
- lifecycle provenance and safe reversal;
- physical stock allowed to exist before canonical identity is fully known.

## 3.2 What the Warehouse UI should become

Current `Остатки` mixes:
- browsing assortment;
- explaining reservations;
- integrity/revision work.

Target UI should expose those as distinct human tasks while reusing the same facts.

### Main stock browse

Business-first hierarchy:

> **Товар → Цвет → Размер**

with material/length/audience shown where they actually distinguish the execution/SKU.

For each concrete line show:
- on hand;
- in orders;
- free;
- whether identity needs clarification;
- whether assortment is inactive/retired;
- later: sale price / cost / stock value if the commercial model exists.

### Reservation explanation

From a stock/SKU line:
- show which orders consume the reserved quantity;
- open the exact order;
- use the shared OrderOperationalProjection for its next action.

### Physical integrity

Revision/check is a distinct work action:
- count selected goods or full point;
- include inactive/retired SKUs that still have physical stock;
- do not silently omit them from “full” stocktake.

### Confirmed fix

A “full” stocktake must include retired canonical positions when physical stock/reservation/history says they are still present.

---

# 4. Workshop target contract

| Fact / structure | Target classification | Notes |
|---|---|---|
| `workshop_tasks` | authoritative current production workflow | Per order item. |
| `orders.workshop_status` | compatibility / cache | Must stop independent editing/ownership after migration. |
| current Workshop work sheet / “Накладная” | operational production instruction | Not financial invoice/payable. |
| physical warehouse receipt of produced item | separate inventory event | Do not auto-stock merely because production is ready. |
| future production completion fact | **missing authoritative historical event** | Needed for cost/payable/history. |
| future Workshop payable/invoice | **missing financial domain** | Separate liability, not customer debt. |

## 4.1 Preserve current good boundary

`Готово` does not automatically mean:
- added to warehouse stock;
- customer paid;
- Workshop paid;
- a financial invoice exists.

That separation is correct.

## 4.2 Remove dual ownership

Once consumers migrate:
- derive order-level Workshop summary from tasks;
- stop treating generic `orders.workshop_status` as independently editable business truth;
- later retire or retain only as compatibility if migration cost requires it.

Do not add another status column.

## 4.3 Missing historical fact

Before Workshop cost/payable reporting, add a durable production/accounting event with:
- order item / Workshop task link;
- quantity;
- business completion/acceptance date;
- historical cost snapshot;
- actor/source;
- reversal/supersession semantics.

The exact moment of liability recognition remains a client/business decision.

---

# 5. Money / Finance target contract

| Fact / structure | Target classification | Notes |
|---|---|---|
| `payments` | authoritative current positive-payment operations | Current money-in facts. |
| active `returns` | authoritative current refund operations | Current money-out/refund facts. |
| `financial_events` | immutable financial audit history | Reversals/corrections appended; do not rewrite old history. |
| `cash_register_entries` | authoritative physical cash-drawer ledger | Includes non-sale cash movements; not universal finance. |
| `orders.total_amount` | current commercial order amount | Distinguish from cash and from original immutable sale history. |
| order received/return/debt fields | derived/cache | Reconcile from current operation rows. |

## 5.1 Metric meanings must remain explicit

- **Продажи / booked commercial value** — order commercial amount by the order/sale business date.
- **Поступило** — actual incoming payment operations by payment date.
- **Возвращено** — active refund operations by refund date.
- **Чистое движение денег** — incoming minus refunded; still not profit.
- **Долг клиента** — current outstanding obligation.
- **Наличные в кассе** — physical cash-register ledger.
- **Прибыль / маржа** — unavailable until line revenue and historical cost are captured correctly.

## 5.2 Reports rule

Remove the false global statement that all financial report periods are based on order date.

Each report must state the clock it uses:
- sales → order date;
- payments → payment date;
- refunds → return/refund date;
- debt closures → payment date;
- mixed report → each measure uses its own factual date, made explicit.

---

# 6. Missing commercial facts required before truthful pricing/profitability

The system is identity-ready for prices, but not transaction-attribution-ready.

These are genuine missing facts/contracts, not UI polish.

## 6.1 Actual sale amount per line

New orders must stop writing zero historical line price while only storing a whole-order amount.

Target invariant:

> every sold line has an actual frozen commercial amount that can be attributed to that line.

Existing `order_items.unit_price / line_total` are the natural historical location, but current exchange/current-composition behavior means lifetime analytics must also use operation history/deltas rather than assume current `order_items` is the untouched original sale.

## 6.2 Whole-order discount/override allocation

Before autopricing implementation, decide:
- item-price editing vs whole-order override;
- discounts;
- bundle/whole-order price differences;
- how any difference is allocated to lines for analytics.

Do not hide an unexplained 5,000 discount in `orders.total_amount` while line totals still sum to 90,000 if product profitability is expected.

## 6.3 Refund/commercial reversal allocation per line

Normal Return UI currently captures:
- returned item;
- quantity;
- physical disposition;
- total refund amount.

It does not capture/derive a trustworthy monetary allocation to each returned line.

That allocation is required for:
- net revenue by product;
- return rate by product/color/size;
- gross margin after returns.

## 6.4 Historical cost basis

Need a historical cost snapshot at the actual acquisition/production boundary.

Do not calculate old profitability using today's mutable default cost.

The valuation method for changing warehouse costs remains a business decision:
- weighted average;
- FIFO;
- exact lot;
- another explicitly accepted simple rule.

## 6.5 Workshop payable

Need a separate liability model:
- payable/invoice document or equivalent;
- production lines;
- historical cost amount;
- paid/part-paid/unpaid;
- payment history;
- outstanding Workshop balance;
- correction/reversal.

It must not be represented as:
- customer debt;
- negative customer revenue;
- a cash-only ledger row.

---

# 7. Shared projections the application actually needs

Do **not** create a new giant materialized “god status” table.

Create reusable read contracts / projection functions/endpoints.

## 7.1 OrderOperationalProjection

Answers:
- what remains to do with this order now?
- what has physically left?
- what is still in Workshop?
- what still needs product resolution?
- what money is retained/refunded/owed?
- is a Return item still expected physically?
- what is the next valid action?

Consumed by:
- Orders;
- Details;
- Resolver entry;
- Return/Exchange;
- Warehouse links.

## 7.2 CanonicalItemProjection

Answers:
- historical/raw wording;
- current canonical product/SKU;
- current display label;
- retired/active state;
- unresolved fields;
- alias/recognition does not leak into user wording.

Consumed by:
- Orders;
- Resolver;
- Stock;
- Return/Exchange;
- Workshop;
- Reports.

## 7.3 StockAvailabilityProjection

Answers:
- on hand;
- active reserved;
- free;
- shortage;
- affected orders;
- latest physical truth/revision context;
- identity completeness.

Consumed by:
- create/edit order;
- Warehouse browse;
- handover;
- exchange replacement check;
- revision.

## 7.4 CommercialLineProjection

Only after the missing price/cost facts exist.

Answers per canonical sold line:
- gross sold quantity/value;
- returned/refunded quantity/value;
- net commercial revenue;
- historical cost/COGS;
- margin;
- dimensions product/color/size;
- current stock/value.

Consumed by:
- assortment performance;
- product/color/size reports;
- Warehouse commercial view;
- profitability.

## 7.5 FinancePeriodProjection

Answers using explicit factual clocks:
- booked sales;
- incoming payments;
- refunds;
- net cash movement;
- customer debt snapshot;
- later Workshop liabilities/payments as a separate block.

---

# 8. Mutation ownership that must be consolidated

## 8.1 Catalog/master data

### Today
At least:
- Catalog/Resolver path;
- Warehouse Arrival path

can create canonical master data with different surrounding validation/contracts.

### Target
One canonical master-data service/command layer.

All callers use it:
- Catalog maintenance;
- Resolver Admin step;
- Arrival Admin step.

The caller can provide context, but cannot invent a second creation algorithm.

## 8.2 Workshop lifecycle

### Today
- task statuses have real per-item workflow meaning;
- order-level Workshop status is also independently editable/updated.

### Target
Task command owns Workshop workflow.
Order summary is derived.

## 8.3 Reservation summary

### Today
Ledger rows and cached `reserved_quantity` are consumed by different views.

### Target
Reservation ledger owns obligation.
Cache is updated/rebuilt by one shared reservation service and treated as optimization only.
Add an integrity check/reconciliation path rather than letting each UI choose its authority.

## 8.4 Product current display

Current canonical label should be joined/read from canonical product identity.
Mutable stock “snapshot” fields may remain a cache, but they are not an alternate naming authority.

## 8.5 Legitimate multiple stock writers that should NOT be collapsed

Do **not** replace these with one generic “set stock” button/API:
- Arrival;
- customer handover;
- Return receipt;
- Exchange;
- transfer;
- stocktake;
- manual physical correction.

They are different domain commands with different provenance and reversal rules.

They should share inventory primitives/idempotency, but keep their business meanings.

This is important: “one source of truth” does **not** mean “one generic mutation endpoint for every event”.

---

# 9. UI simplification contract

The interface should stop making the employee interpret architecture.

## 9.1 One problem, one natural place to continue

Examples:
- unresolved item encountered during shipping → resolver opens in the same order flow;
- stock shortage encountered during order creation → exact stock context/action is available from that order;
- Return money completed but physical item pending → order shows that next physical action, not a generic “returned” final state;
- an Admin-only reusable-data mutation → simple Admin mode is activated at that exact step.

No separate maintenance inbox is required for ordinary completion.

## 9.2 Show next action, not internal state names

Prefer:
- “Уточнить товар”;
- “Товар ещё не пришёл”;
- “Принять на склад”;
- “Цех ещё не готов”;
- “Получено 50 000 · возвращено 10 000 · осталось у нас 40 000”.

Avoid requiring users to understand:
- canonical;
- lifecycle;
- resolver;
- reservation;
- execution;
- variant.

These terms may remain internal.

## 9.3 Distinguish three UI states

The audit repeatedly found them blurred:

1. **suggested/default**;
2. **selected locally but not saved**;
3. **saved fact**.

Resolver answers, Arrival defaults, size “not selected”, and similar UI must make these states visually/behaviorally unambiguous.

## 9.4 Do not rely on explanatory prose

A user should not have to remember a note saying where a problem moved.

The actual button/action/navigation should carry the workflow.

---

# 10. What should be preserved instead of rewritten

The following mechanisms are valuable and should survive the cleanup:

- stable product / execution / variant identity;
- catalog aliases with identity verification;
- variant-history mutation guards;
- item-level reservations;
- early partial physical handover;
- final shipping command;
- stocktake conflict/atomicity logic;
- physical check precedence;
- lifecycle event provenance;
- Return physical receipt separate from refund;
- Return cancellation preserving newer physical truth;
- Exchange shortage backend preflight;
- per-item Workshop tasks;
- Workshop direct-to-customer semantics;
- current payment rows + immutable financial event history;
- reversal rather than destructive money-history rewrite;
- physical cash ledger separate from business revenue;
- archive instead of deleting business history;
- idempotent critical-operation machinery.

The project should become simpler **around** these mechanisms, not by deleting them.

---

# 11. Legacy/compatibility elements to stop expanding

Do not build new features on top of these as primary truth:

- `orders.workshop_status`;
- `orders.ready_at`;
- `orders.warehouse_received_at`;
- frontend predicate `return_amount > 0 => whole order returned`;
- snapshot-first operational display after canonical resolution;
- variant copied material/length as a second canonical owner;
- `inventory_stock.reserved_quantity` as business authority;
- `inventory_stock.*_snapshot` as if immutable history;
- product report `order_sales` based on whole-order totals;
- one global “all reports use order date” period explanation;
- independent Arrival catalog-creation logic;
- broad legacy resolver/admin escape surfaces once the natural contextual path covers the required operations.

Retire/remove only after all consumers migrate and regression coverage proves no remaining use.

---

# 12. Finite repair sequence

This is the proposed project-ending sequence.

It intentionally separates structural repair from requested new features.

## Stage 0 — Freeze truth contracts and regression baseline

Goal: prevent new patches from adding more competing meaning.

Actions:
- document the classification in this synthesis in code-facing types/comments/contracts;
- add focused invariant tests for the known dangerous shortcuts before changing consumers;
- no new generic statuses;
- no new duplicated master-data writer;
- no new report metric without an explicit business-date/source definition.

Exit criteria:
- every implementation PR states which authoritative fact it reads/writes;
- current Branch2 behavior has a regression baseline.

---

## Stage 1 — Shared operational projections + Orders/Resolver cleanup

Goal: remove the worst current human contradictions without changing strong write-side mechanics.

Implement:
- `OrderOperationalProjection`;
- canonical-vs-history `CanonicalItemProjection`;
- stop `return_amount > 0` from acting as whole-order completion;
- show refund/net context beside gross received;
- derive Workshop summary from tasks;
- hide irrelevant Workshop state on non-Workshop orders;
- working order surfaces show current canonical identity after resolver while preserving raw historical wording in details/history;
- resolver reuses one contextual flow;
- manager can link existing facts;
- Admin mode appears only for reusable master-data mutation;
- local resolver selection cannot masquerade as saved state.

Do not yet implement prices/profitability.

Exit criteria:
- same order has the same operational meaning in Orders, Resolver, Return/Exchange and Warehouse link-back;
- refresh/close does not create a false saved indication;
- a manager never gets “admin required” merely because a different screen wrapped the same resolvable fact differently.

---

## Stage 2 — Warehouse simplification + catalog write ownership

Goal: make Warehouse a usable daily tool on the established facts.

Implement:
- one canonical catalog/master-data mutation service reused by Resolver/Catalog/Arrival;
- Arrival validates identity completeness before its main action and does not convert guessed/default draft state into reusable data invisibly;
- stock browse organized around product → color → size, with execution details only where relevant;
- on-hand / reserved / free all come from one StockAvailabilityProjection contract;
- direct links from reserved stock to exact affected orders;
- separate browse, physical check/revision, and operation/history tasks in UI;
- full stocktake includes retired/inactive goods that physically remain;
- decide and implement explicit retired-stock sell-through policy after client confirmation.

Exit criteria:
- one physical SKU shows the same identity and quantity semantics everywhere;
- no second catalog-creation implementation exists in Arrival;
- full revision cannot omit visible physical retired stock;
- ordinary warehouse use does not require knowing resolver/catalog architecture.

---

## Stage 3 — Price + line-commercial model

Goal: make future sales/profitability data truthful at the moment it is created.

First obtain the bounded business decisions in section 14.

Then implement:
- current/default sale price at agreed identity granularity;
- automatic price fill in order creation/edit;
- actual accepted historical price frozen on each sold line;
- explicit discount/whole-order override allocation;
- line-level commercial attribution through Exchange;
- refund monetary allocation to returned lines;
- never rewrite historical sold prices when catalog price changes.

Migration/history rule:
- old orders with no truthful line allocation remain marked historical/unknown for line-profit analytics;
- do not fabricate line revenue by dividing old order total unless the client explicitly accepts a deterministic backfill rule.

Exit criteria:
- a new multi-item order always has exact line amounts whose sum reconciles to the commercial order amount;
- Returns/Exchanges reconcile both total cash and line commercial deltas;
- changing current product price cannot alter old sale history.

---

## Stage 4 — Historical cost + Workshop payable

Goal: add cost/procurement/production economics without corrupting stock or customer revenue.

Implement:
- default/current cost at agreed granularity;
- historical acquisition cost snapshot at the agreed inventory-cost boundary;
- immutable Workshop completion/acceptance/accounting event;
- Workshop payable/invoice ledger;
- partial/full payment and outstanding balance;
- payment method/cash integration without making cash the primary payable truth;
- reversal/correction history rather than destructive edits.

Do not auto-stock Workshop output solely because the production task is ready/done.

Exit criteria:
- current Workshop debt is derivable from explicit payable facts;
- old production cost does not change when default cost changes;
- paying Workshop affects liability and the chosen money channel, not customer revenue;
- production, stock receipt and payable remain separate facts.

---

## Stage 5 — Finance / Reports / assortment analytics rebuild on the shared commercial model

Goal: satisfy the client reporting requirements without inventing numbers.

Implement:
- report-specific date semantics;
- product/color/size grouping by canonical IDs;
- gross sales, returns, net commercial value;
- units sold/returned;
- return rate;
- COGS and gross margin once historical cost exists;
- current stock cost value;
- potential sale value using current sale price;
- stale/slow assortment views with explicit period definition;
- Workshop payable/payment reports;
- keep cash drawer clearly separate from business-wide finance.

Exit criteria:
- a number has one definition everywhere;
- product revenue never comes from repeating whole-order totals for each product;
- Exchange refund cannot be double-subtracted;
- unknown historical cost/price is shown as unknown, not zero;
- selected report explains its actual date basis.

---

## Stage 6 — Remove compatibility UI / legacy shortcuts

Only after all consumers use the new contracts:
- remove or hide obsolete broad Workshop order controls;
- retire duplicate resolver/legacy review entry points;
- remove frontend lifecycle shortcuts based on cache fields;
- stop consuming copied/legacy identity values where canonical owner exists;
- consider schema cleanup only if it reduces real maintenance cost and migrations are safe.

Do not do destructive schema cleanup just for aesthetic purity.

Exit criteria:
- grep/code audit shows no operational consumer depending on retired shortcuts;
- regression suite protects replacement contracts.

---

## Stage 7 — Final operational acceptance and scope freeze

Run short real-user journeys on Branch2, Manager first then simple Admin mode.

Required journeys:
1. create known-stock order;
2. create shortage/deferred-stock order and later resolve it;
3. resolver existing identity;
4. resolver true new master data under simple Admin mode;
5. Workshop order → ready → customer handover;
6. Return pending physical receipt → receive / no-stock / cancellation;
7. Exchange with enough stock and with shortage;
8. Arrival known SKU and true new SKU;
9. transfer + physical check + full stocktake including retired stock;
10. partial payment / debt closure / refund;
11. multi-item priced order + partial Return + Exchange;
12. Workshop payable + partial/full payment once implemented;
13. Finance and Reports reconciliation;
14. mobile-width critical flows.

For every critical journey verify:
- refresh/reload;
- retry/idempotency;
- same facts across screens;
- correct next action;
- no hidden dependency on a separate queue;
- no explanatory text required to discover the basic flow;
- acceptable Cloudflare/D1 read/write cost.

After this:
- scope freeze;
- only correctness defects block release;
- optional polish is not allowed to reopen architecture.

---

# 13. “Done” definition for this project

The project is complete when all of the following are true:

1. **One owner per fact.** Every important business fact has an explicit authority.
2. **No cache masquerades as domain truth.** Cached fields may exist for performance but are derived/reconcilable.
3. **No snapshot masquerades as current identity.** History and current canonical truth are visibly distinct.
4. **One contextual Resolver path.** Existing identity is ordinary work; reusable master-data creation is the exact Admin boundary.
5. **Warehouse is understandable by product/color/size.** Physical, reserved and free quantities are consistent across surfaces.
6. **Revision covers what physically exists.** Retired stock is not omitted from a full count.
7. **Workshop has one workflow authority.** Per-item tasks own production state; financial payable is separate.
8. **New orders have truthful line sale values.**
9. **Returns/Exchanges have truthful line commercial deltas.**
10. **Historical cost exists where profitability needs it.**
11. **Finance metrics have fixed definitions and correct business dates.**
12. **Reports never fabricate product revenue/profit from whole-order aggregates.**
13. **Critical unfinished work resurfaces in the task that needs it.**
14. **Manager and Admin journeys both survive refresh/retry without owner intervention.**
15. **Production operation no longer depends on the project owner remembering hidden exceptions.**
16. **No known HIGH-severity workflow dead end remains.**
17. **No new feature is required to declare release complete.**

This is a finite acceptance target, not “perfect forever”.

---

# 14. Bounded business decisions still required

These should be asked as specific decisions before Stage 3/4 implementation, not left as architectural ambiguity.

## Pricing

1. What owns normal sale price?
   - base product only;
   - product + material/length execution;
   - exact SKU;
   - inherited base with overrides.

2. Can manager override:
   - each line price;
   - only total order price;
   - discount field;
   - some combination?

3. If whole-order final price differs from line defaults, how should the difference be allocated for analytics?

## Cost

4. At what level does normal cost vary?
   - product;
   - execution;
   - SKU;
   - receipt/lot only.

5. If warehouse acquisition cost changes over time, which accepted valuation method should be used for sold-stock COGS?

## Workshop

6. When does Workshop liability arise?
   - when task is marked produced;
   - when production is accepted;
   - when Workshop issues its invoice/statement.

7. Can one Workshop payment cover multiple production documents, and are partial payments required per document?

## Assortment retirement

8. If a product is removed from assortment but physical stock remains:
   - sell remaining stock;
   - block sale immediately;
   - allow only Admin override.

These are the remaining genuine business choices. Everything else in this synthesis is primarily an engineering/UX contract.

---

# 15. What should happen next

Do **not** immediately implement all seven stages.

The next safe step is owner review of this synthesis.

If accepted:
- implement only Stage 0 + Stage 1 first on an isolated Branch2-derived feature branch;
- run focused regression/build checks;
- deploy to isolated Branch2 environment;
- perform a short Manager/Admin acceptance for the affected journeys;
- stop and review before Stage 2.

This keeps the project finite and prevents another “fix ten subsystems in one pass” cycle.

