# Stage03-H6 — Pre-client technical readiness

Date: 2026-09-23

Status: **COMPLETE / GREEN on Branch2. Further pricing activation requires unresolved client decisions.**

Final green code baseline: `f6906a2b6d28b30d1e3ce179b295e2e729b45a71`.
Cloudflare monitor: `35843997644` — **success**.

Production was not changed. Production D1 was not mutated.

## H6A — itemized legacy-edit guard

Future `itemized_v1` orders fail closed in the current legacy full-order editor:
- frontend blocks editor entry;
- frontend stale-save fallback also blocks;
- backend PATCH reads persisted `pricing_mode` and rejects legacy edit semantics for itemized orders;
- dedicated lifecycle delete remains separate.

## H6B — hidden Create pricing state

The H5 Catalog resolver became runtime-reachable without activating itemized Create:
- product pick and accepted base price-driving field changes maintain hidden `unitPrice` + `catalogPriceSnapshot`;
- missing/ambiguous recommendation clears hidden recommendation state instead of inventing zero;
- visible Create UI still uses the current manual order-total flow;
- Create request still does not send `pricingMode: itemized_v1`.

## H6C — pipeline acceptance

Focused acceptance locks agreement among:
- pure server itemized arithmetic/write plan;
- explicit guarded server Create path;
- persisted pricing/read metadata;
- itemized report path;
- edit fail-closed boundary;
- hidden Catalog recommendation preparation.

Visible Create remains legacy.

## H6D — exchange guard

Legacy exchange semantics are incompatible with universal itemized totals. Therefore:
- itemized orders fail closed in backend legacy exchange creation;
- both frontend exchange entry paths block the unsupported flow;
- legacy exchange arithmetic remains untouched for legacy orders.

## H6E — post-Create finance isolation

Debt-close:
- re-reads persisted order/payment ledger;
- rejects overpayment;
- does not depend on current Catalog, Catalog snapshot or pricing generation.

Returns:
- refund amount remains explicitly manager-entered;
- refund ceiling remains received money minus already returned money;
- no automatic refund is derived from sold line price or current Catalog.

## H6F — commercial write-surface audit

Release regression now detects unexpected SQL that writes:
- `orders.total_amount`;
- `order_items.unit_price`;
- `order_items.line_total`;
- `order_items.catalog_price_snapshot`.

The reviewed commercial write surface remains confined to order Create/Edit and the legacy exchange implementation. Money, delete and shipping paths cannot silently reprice orders.

## H6G — pure frontend itemized readiness

A pure frontend preflight model now mirrors safe itemized arithmetic before UI activation:
- ignores blank item rows;
- validates quantity/final line price/snapshot/payment rows;
- derives line totals;
- derives order total, received money, debt and overpayment;
- missing final price blocks readiness instead of becoming zero;
- Catalog snapshot stays separate from actual sold price;
- explicit zero remains technically representable until client decides whether zero/free sales are commercially allowed.

This model does not send an itemized request and is not displayed as a new pricing UI yet.

## H6H — long-term retained pricing generation

Storage cleanup previously compacted old orders into `retained_order_summaries`, whose read path always described retained history as legacy. That would lose pricing-generation identity for future itemized orders after detailed rows are removed.

H6H adds:
- additive `retained_order_summaries.pricing_mode`;
- pre-0074-safe capability probe;
- post-0074 storage upsert of the original persisted pricing generation;
- safe retained read fallback to `legacy_manual_total` for older schema/data;
- no Catalog repricing or price reconstruction.

Migration:
`migrations/0074_v72_retained_order_pricing_mode.sql`.

Branch2-only migration workflow:
`35841644818` — **success**.

Environment verified before mutation:
- Worker `orders-app-branch2`;
- D1 `orders_db_branch2`;
- id `40065052-854e-44b8-bcd5-251bdd488301`;
- Production binding explicitly rejected.

Observed Branch2 D1 state during verification:
- retained rows: 0;
- live orders: 13;
- total amount aggregate: 20000;
- received aggregate: 20000;
- debt aggregate: 0;
- return aggregate: 0.

Before/after financial fingerprint matched exactly.

## H6I — final pre-client readiness matrix

One cumulative gate now verifies:
- Branch2 environment identity;
- explicit server itemized Create path and server revalidation;
- persisted pricing metadata;
- legacy Edit fail-closed behavior;
- itemized Exchange fail-closed behavior;
- manual Return boundary;
- debt-close isolation;
- delete/archive/restore lifecycle isolation;
- shipping/handover commercial-price isolation;
- exact itemized product revenue;
- retained-history pricing generation;
- schema foundations 0073 + 0074;
- Catalog resolver + frontend readiness model;
- current visible Create UI/request remains unactivated;
- documented client-policy boundaries remain present.

## H6J — adjacent surfaces isolation

Final adjacent audit covers:
- Workshop: may change workflow/status/cache fields, but not order commercial totals or sold line prices;
- Clients: aggregates persisted live and retained historical totals, not current Catalog;
- Cash / Finance-day: remain Catalog-independent and pricing-generation agnostic;
- physical return/exchange lifecycle: may read historical sold-line values for operational identity but cannot rewrite commercial price facts.

## Client decisions received — 2026-09-24

Confirmed:
1. the existing Catalog price assignment is correct: `product + material + length + adult/child`;
2. gender/color/size are not additional sale-price dimensions;
3. delivery is not a separate sale-price dimension;
4. if Catalog has no price, the manager must still be able to enter a final sold price and complete the order;
5. explicit zero sold price is allowed;
6. a zero-amount payment row may keep a preselected method and must not block order saving;
7. sold orders keep their historical sold prices permanently; later Catalog price changes affect only later/new orders.

Still unresolved:
1. exact discount UI model: final price / amount / percent;
2. whether manager override requires a reason;
3. within an unsaved draft, what happens to a manual final-price override if product/material/length/adult-child is changed afterward;
4. whether returns stay fully manual or receive only an optional suggested refund from the historical sold price;
5. itemized exchange price policy;
6. explicit discount reporting requirements.

These remaining questions no longer block implementing the confirmed zero-price / missing-Catalog-price behavior. Visible itemized Create activation should still avoid inventing discount, draft-override, return or exchange policy.

## Completion statement

As of this checkpoint, the Stage03 pricing/itemized preparation that can be completed without deciding the client's unresolved business rules is technically complete on Branch2.

## 2026-09-24 note — separate CLIENT-ZAMMLER request

A separate client request named CLIENT-ZAMMLER was implemented and deployed after this checkpoint. It does **not** resolve any Stage03 business-policy question and does **not** start roadmap Stage04.

Do not use historical `Stage04-ZAMMLER` labels in old files/commits as roadmap state. The canonical completion record is:
`docs/continuation/CLIENT_ZAMMLER_COMPLETION_20260924.md`.

The unresolved client-decision list above remains authoritative until the client answers it.

