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
- audit head immediately before this context update: `699ead84a9a8be1dd725ce2c7fa65c6338394a68`

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

Next full slice: **Product identity / canonical SKU / historical snapshots / assortment state**.

Questions:
- What is the authoritative current identity of a product/SKU?
- Which order-item values are immutable historical wording versus current operational identity?
- When resolver changes `product_id / variant_id`, which screens should switch to canonical display and which must preserve raw history?
- How do aliases, executions, variants and reference values participate in identity without becoming separate user concepts?
- What exactly does `is_active` mean for product and variant, especially when retired assortment still has physical stock/history?
- Where can future default sale price and default cost belong without rewriting historical order/receipt facts?
- Is the catalog/resolver model already sufficient and only missing a shared read projection, or are there genuine identity ownership defects?

After Product Identity, STOP, save the audit doc, update this context again, and report before moving to physical Stock/Reservations.

## Working discipline

The user explicitly asked not to lose work if the chat runs out.

Therefore:
- after every meaningful audit block, save a document in `docs/audits/`;
- update this file with the last completed block and exact next step;
- stop at a clean checkpoint instead of trying to finish several heavy domains in one response.
