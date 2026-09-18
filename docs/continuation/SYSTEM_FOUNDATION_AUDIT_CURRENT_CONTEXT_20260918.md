# SYSTEM FOUNDATION AUDIT — CURRENT CONTEXT

Updated: 2026-09-18

## Why this file exists

This is the durable continuation context for the current system-wide audit of `dymovicd123/Orders-app`.

If the chat/session ends, start from this file, then re-check `branch2` and the audit branch in GitHub before doing any new analysis.

Do not rely on stale chat memory when repository state can be re-read.

## Repository / branch safety

Repository: `dymovicd123/Orders-app`

Production code branch currently audited:
- `branch2`
- baseline at last check: `fb43e8d709b57b67cc080bb9bd64246bb036aede`

Documentation/audit branch:
- `audit/system-ux-walkthrough-20260917`
- audit head immediately before this context update: `826454fb43247870baffa11ec3a7a54a52bd4272`

Rules:
- do not mutate Production D1 for exploratory work;
- do not merge temporary/audit branches wholesale into main/branch2;
- audit documents may be written only to the audit branch;
- implementation must not begin until the architectural audit produces a consolidated plan and the user accepts it.

## Product constraints from the owner/client

- Access model intentionally stays simple: ordinary working mode + simple Admin mode.
- Do not invent approval queues, complex accounts/roles, proposal inboxes, “call administrator” workflows, or organization-heavy process machinery.
- Real users ignore explanatory noise and do not want to maintain the system.
- The simplest visible action must be the safe/correct action.
- Important unfinished work must reappear in the workflow that needs it; do not rely on badges/queues alone.
- UI should expose business actions and next steps, not internal vocabulary such as canonical SKU, variant identity, lifecycle event, reservation, etc.
- The goal is a finite, releasable system that can run without the owner babysitting it.

## Why the current audit exists

The user feels the application is still “strange”, fragile and patch-driven even though many individual flows work.

The audit must determine whether this is:
1. mostly local UX defects; or
2. a deeper architectural mismatch.

Do not jump from a symptom directly to a redesign.

## Current foundation hypothesis

The strongest current hypothesis is:

> The write-side/domain model often preserves several correct independent facts, but the application lacks one deliberate operational read-model per workflow. Different screens promote different local fields/snapshots into the human meaning of “what is happening now”.

This creates contradictions in presentation even when the underlying transaction/state changes are internally coherent.

Examples already found:
- a financial refund aggregate (`return_amount > 0`) is used as the whole-order lifecycle label `Возвращён`;
- historical order-item snapshots remain visible in Return history while stock uses the canonical SKU linked by `variant_id`, with no visible bridge between them;
- gross received money is shown as `Получено / Оплачено` without adjacent active refunds/net retained money;
- coarse `orders.workshop_status` can survive beside per-item Workshop task truth;
- resolver can link canonical data while order snapshots still display old values;
- Reports store legitimate different date clocks but one global UI sentence flattened them into one rule.

This is not yet a rewrite mandate. Several backend areas already have strong lifecycle/idempotency safeguards.

## Completed audit documents

Read these before continuing:
- `docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_MANAGER_20260917.md`
- `docs/audits/MANAGER_CODE_AUDIT_01_M01_M04_20260917.md`
- `docs/audits/MANAGER_CODE_AUDIT_02_M05_M07_20260917.md`
- `docs/audits/MANAGER_CODE_AUDIT_03_M08_20260917.md`
- `docs/audits/FOUNDATION_AUDIT_HYPOTHESIS_20260917.md`
- `docs/audits/WAREHOUSE_CLIENT_REQUIREMENTS_20260917.md`
- `docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_LIFECYCLE_20260917.md`
- `docs/audits/MANAGER_CODE_AUDIT_04_LIFECYCLE_RETURN_EXCHANGE_20260918.md`
- `docs/audits/FOUNDATION_TRUTH_MAP_01_ORDER_LIFECYCLE_20260918.md`
- `docs/audits/FOUNDATION_TRUTH_MAP_02_PRODUCT_IDENTITY_20260918.md`
- `docs/audits/FOUNDATION_TRUTH_MAP_03_PHYSICAL_STOCK_20260918.md`
- `docs/audits/FOUNDATION_TRUTH_MAP_04_WORKSHOP_PRODUCTION_20260918.md`

Astra lifecycle Phase 1 report is also preserved in the audit branch. It should not be re-run unless a specific missing scenario becomes necessary.

## Important result from Return/Exchange vertical slice

Astra tested Return lifecycle:
- refund while physical item still pending;
- later physical receipt to Warehouse;
- cancellation after receipt;
- received-without-restock.

Observed stock/money stayed coherent through F5:
- pending did not restore stock;
- receipt added exactly one;
- cancellation removed the active refund and tested stock contribution;
- `no_stock` did not restore sellable stock.

Code review confirmed:
- physical receipt, refund, destination and inventory lifecycle are separate facts;
- Return cancellation can preserve newer physical truth rather than blindly reverse it;
- Exchange backend preflights physical shortage before creating the exchange record.

Therefore Return write-side should mostly be preserved.

Important UI/read-model defects confirmed:
- `isReturnedOrderRecord = return_amount > 0` makes a monetary aggregate masquerade as whole-order lifecycle state and hides normal actions;
- order rows show gross `received_amount` / “Оплачено” without local refund/net context;
- Return history uses historical snapshots, stock uses canonical identity, with no visible relationship;
- cancellation intentionally opens a fresh Return draft and stores the literal technical comment `Отменено из интерфейса Cloudflare`.

## Completed foundation truth-map slice: Order lifecycle

The first full truth-map slice is complete.

Strong findings:
- `order_status` is best understood as administrative record state / archive gate, not operational fulfillment truth;
- `shipping_status` is a whole-order milestone while individual physical handover truth lives in reservations/lifecycle state;
- `workshop_status` is a coarse compatibility aggregate beside stronger per-item Workshop tasks;
- financial columns on `orders` are cached aggregates, not one payment lifecycle;
- `return_amount > 0` is incorrectly promoted by the frontend into whole-order `Возвращён` state and action gating;
- `order_items` represents current post-exchange composition as well as sale-line snapshots, so future profitability/history must not assume current `order_items` alone equals the original sale.

The strongest architectural diagnosis after this slice:

> The write model often has enough independent truth, but there is no single deliberate operational projection that composes those facts for ordinary users. Screens use local shortcuts as whole-process meaning.

Do not “fix” this by adding one more status column. The next slices must determine the authoritative facts first, then later a reusable operational read-model can be designed across domains.

## Completed foundation truth-map slice: Product identity

The second full truth-map slice is complete.

Strong findings:
- canonical identity core is good and should be preserved: product ID → execution (product + material + length) → concrete variant (execution + category + gender + color + size);
- aliases are recognition rules, not alternate identities;
- order snapshots are intentionally historical/raw while product_id/variant_id are current canonical links;
- Orders API already joins canonical fields but deliberately returns snapshot-first fields, which explains the visible resolver mismatch;
- inventory_stock *_snapshot fields are mutable current display caches, unlike immutable order/movement snapshots — the same naming hides different contracts;
- execution owns material/length by Identity V3, but variants also keep copied material/length and the canonical loader reads the variant copies;
- used variant identity edits are generally guarded well;
- product rename is weaker: it changes the canonical label without automatically preserving the old name as alias or immediately refreshing current stock display;
- product is_active supports “stop new selection, keep remaining stock/history visible” reasonably well, but does not model “sell remaining stock, stop replenishment”;
- resolved in-flight orders can still fulfill after product deactivation, but unresolved raw order lines can become stranded because resolver only targets active products.

Price/cost consequence:
- do not yet assume product-level price/cost;
- confirm whether material/length execution can change sale price or cost;
- actual sold unit_price remains historical sale truth;
- cost for profitability must be captured at receipt/production time;
- grouping must use stable canonical IDs, not raw names.

The foundation hypothesis is now supported by both Order and Product domains:

> The system often has the right facts, but does not explicitly classify historical snapshots, current canonical identity, mutable display caches and derived operational read-models.

## Completed foundation truth-map slice: Physical stock

The third full truth-map slice is complete.

Strong findings:
- current physical quantity authority is `inventory_stock.quantity`;
- durable business reservation truth is active `inventory_reservations`; `inventory_stock.reserved_quantity` is a derived/cache aggregate;
- ordinary Остатки reads the reserved cache, reservation detail reads actual reservation rows, and Warehouse Attention recomputes active reservation totals — no single read contract currently declares/reconciles the hierarchy;
- physical-check rows and completed stocktakes are deliberately stronger facts than older inferred lifecycle reversals;
- full stocktake implementation is strong: baseline/recount conflict handling, atomic completion lock, exact count application, check-history write, and no partial completion;
- pending Return/Exchange/Workshop inbound respects newer physical checks/full-stocktake boundaries rather than blindly double-adding stock;
- positive physically-found stock may exist with no canonical variant yet, which is a good separation of physical truth from product identity;
- **confirmed contradiction:** ordinary inventory keeps inactive SKU visible when it still has quantity/reserve, but creation of a “full” stocktake excludes inactive product/variant rows; retired physical stock can therefore be visible yet omitted from physical revision;
- **confirmed ownership defect:** Warehouse Arrival can create product/execution/variant through `resolveInventoryCreatableItemsBulk()`, a separate master-data creation implementation from Catalog/Resolver and without the same complete reference/value validation contract;
- current Остатки combines three jobs: browse, explain order reservations, and perform integrity/cycle-count work;
- browse hierarchy follows technical execution → color → category/gender → size, while client asks primarily product → color → size and commercial usefulness;
- future inventory value cannot safely be `quantity × today's cost` if historical batch cost can vary; cost methodology remains a business decision.

Current strongest root diagnosis:

> Business facts are increasingly correct, but truth ownership and the ordinary read projection are not centralized. Complexity accumulates at subsystem boundaries and in UI-side reconstruction.

Do not rewrite Revision/Return/Reservation safety machinery. Most of it should be preserved.

## Completed foundation truth-map slice: Workshop / production boundary

The fourth full truth-map slice is complete.

Strong findings:
- per-item `workshop_tasks` linked to `order_items` are the strongest current Workshop workflow truth;
- Workshop read paths intentionally use tasks for workflow/status and order items for product/history facts;
- Workshop order creation intentionally resolves only base product, not exact SKU; this is valid for made-to-order work and should not be “fixed” by forcing variants early;
- the main `Готово` action only changes task workflow state; it does not add stock, create inventory movement/lifecycle, record physical warehouse receipt, create cost or create a Workshop payable;
- this is largely correct: Workshop-only orders can go directly from production readiness to customer handover without entering sellable warehouse stock;
- Return/Exchange already treats later physical receipt of Workshop goods as a separate explicit inventory lifecycle event;
- **confirmed ownership defect:** `orders.workshop_status` is a second coarse lifecycle representation beside per-item task status; it is partly derived from tasks and also independently editable;
- `refreshOrderWorkshopStatusFromTasks()` collapses every “no active tasks” state to `ready`, losing distinctions between done/ready/cancelled mixtures;
- every new order draft defaults coarse `workshop_status='in_workshop'`, including orders with no Workshop items; shipping code compensates by also checking actual Workshop item/task counts;
- old `orders.ready_at` and `warehouse_received_at` fields appear unused in current domain code and should be treated as schema sediment, not revived automatically;
- current “Накладная цеха” is generated from active requested work and has no money/cost/payable facts; it is operationally a production work sheet, not the future financial Workshop invoice/payable requested by the client;
- **critical future-accounting gap:** production completion has no immutable domain event/timestamp/cost snapshot. Mutable task status + `updated_at` cannot be the historical production ledger;
- once cost/payable exists, `Вернуть` must reverse/supersede a completion fact rather than erase historical production;
- future boundaries must remain separate: work instruction, production completion, physical warehouse receipt, and Workshop financial liability/payable;
- historical production cost must be snapshotted at the agreed production/accounting boundary rather than inferred from a later mutable default cost;
- cost granularity (product vs execution vs exact SKU vs custom) remains a real business decision and must not be guessed.

Preserve the strong per-item Workshop linking and Workshop-aware Return/Exchange safety. Do not auto-stock on `Готово`.

## Warehouse/client requirements that must influence later design, but are NOT yet an approved plan

Client asks for:
- inventory grouped/understood by color and size;
- sales and returns viewed together;
- useful colors/sizes / assortment performance;
- identify stagnant/no-longer-relevant assortment;
- cost price + sale price per product;
- value frozen in stock at cost and potential sale value;
- Workshop production invoices and payment status;
- running payable balance with Workshop.

Do not implement these as independent widgets until product/stock/money truth ownership is mapped.

Deactivation is preferred over hard deletion because history must remain. Exact business behavior for “retired but still has stock” still needs explicit confirmation.

Future profitability must treat financial refund and physical return disposition separately. A refund can happen before the item arrives; `no_stock` must not restore inventory value.

## Price/cost direction — not yet implementation

Current catalog has no true product default price/cost model; order items already keep historical sale price snapshots.

Likely invariants to preserve:
- future default sale price belongs to product/master data;
- each sale keeps an immutable historical unit-price snapshot;
- manual order price overrides must not be overwritten by later SKU/color/size changes;
- new catalog price must not rewrite old orders;
- unknown price should be NULL/explicitly missing, not zero;
- cost must have historical receipt/production snapshots if profitability is required.

Do not choose FIFO/weighted-average/etc. without confirming business rules.

## Astra usage

Astra is for black-box GUI evidence, not architecture.

Completed:
- Manager sweep.
- Return/Exchange lifecycle Phase 1.

Warehouse Phase 2 is currently paused. Do not launch it until the main architecture audit says what exact GUI questions remain.

## Current audit method

Build a cross-system map for each domain:

1. real-world facts/state dimensions;
2. authoritative write source(s);
3. historical snapshots;
4. derived/aggregate fields;
5. command/API allowed to mutate each fact;
6. preconditions;
7. atomic/idempotent side effects;
8. reversal/correction path;
9. existing UI/read models;
10. mismatches where one local field is promoted into an incorrect whole-process meaning.

Domains to map:
- Order lifecycle;
- Product identity / canonical SKU / assortment state;
- Physical goods / stock / reservations / lifecycle events;
- Workshop;
- Money;
- future price/cost/payables.

The output should distinguish:
- strong write-side mechanisms to preserve;
- truth-ownership defects;
- projection/read-model defects;
- genuine missing business states;
- pure local UI defects.

## Immediate next step

Next full slice: **Money / Finance source of truth**.

Questions:
- Which source is authoritative for received money, refunds and net cash: payments, returns, financial_events, cash entries, or order aggregates?
- Which order totals are immutable historical facts and which are caches/derived values?
- Where are payment rows and financial_events deliberately duplicated, and how is drift prevented/repaired?
- What should “выручка”, “получено”, “долг”, “возврат”, “чистые деньги” and future “прибыль” each mean?
- Can current per-item unit_price/line_total be trusted for product profitability, especially because create flow currently sends unitPrice=0 while orderTotal is separate?
- Where should default selling price and auto-pricing attach, and when must a historical price snapshot be frozen?
- How should future Workshop production completion/cost/payable enter Finance without becoming order revenue?
- Which existing finance/report surfaces consume incompatible interpretations of the same money?

After the Money/Finance slice, STOP, save its audit document, update this continuation file, and report before moving to report/UI redesign.

## Working discipline

The user explicitly asked not to lose work if the chat runs out.

Therefore:
- after every meaningful audit block, save a document in `docs/audits/`;
- update this file with the last completed block and exact next step;
- stop at a clean checkpoint instead of trying to finish several heavy domains in one response.
