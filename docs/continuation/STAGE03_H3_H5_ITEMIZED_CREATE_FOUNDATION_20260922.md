# Stage03-H3/H4/H5 — Itemized Create foundation

Date: 2026-09-22

Status: **GREEN on Branch2; UI activation still intentionally deferred.**

Final green Branch2 baseline: `07718e7ad04ec00091e97be9f6a016fbbe01d333`.
Cloudflare monitor: `35767177144` — **success**.

## H3 — explicit server Create path

The real Create Order backend can now consume the H2 write plan only for an explicit `pricingMode: itemized_v1`.

The current behavior remains safe by default:
- no pricing mode means `legacy_manual_total`;
- the existing UI does not request itemized mode;
- manual order-level total remains valid only on the legacy path;
- itemized money is recalculated server-side;
- overpayment remains blocked;
- the validated write plan is frozen into the critical-operation context for retry safety;
- itemized order rows persist `pricing_mode = itemized_v1`;
- itemized lines persist actual `unit_price`, derived `line_total`, and nullable `catalog_price_snapshot`;
- current Catalog prices are not looked up by H3;
- existing Edit/Return/Exchange paths are not converted.

## H4 — exact future product revenue

For `itemized_v1`, product gross revenue can now be read exactly from persisted `order_items.line_total`.

The report keeps legacy ambiguity explicit:
- itemized exact revenue has its own field;
- itemized and legacy order counts are separate;
- legacy orders are not proportionally allocated or guessed;
- the old compatibility `order_sales` field is retained but remains hidden from UI;
- current mutable Catalog price and Catalog recommendation snapshots are excluded from revenue arithmetic.

Final H4 green baseline: `13ed605ad3629f79f72cb59b001f0b3ad7695229`.
Cloudflare monitor: `35764445435` — **success**.

## H5 — pure Catalog recommendation resolver

The frontend now has a pure resolver for the accepted Stage03 base pricing dimensions:
`product + material + length + adult/child`.

It consumes the already-existing Catalog response:
- active canonical product identity;
- known product aliases;
- execution prices from `catalog_execution_prices`;
- `СТАНДАРТ` material/length identity when fields are empty.

Resolver output is deliberately conservative:
- exact single recommendation -> matched sale price + future Catalog snapshot value;
- missing product -> no price;
- missing execution price -> no price;
- conflicting price candidates -> ambiguous/fail closed;
- no network call;
- no draft mutation;
- no UI import/activation yet.

Structural safety:
- exact H5 frontend manifest normalizes `src/app/types.ts` and temporarily removes the exact added pure resolver while historical Step 190.6B layers replay;
- Step 190.6C allows only that exact inactive resolver until a later Create UI step imports it.

## Boundaries preserved

H3-H5 did not:
- change Production;
- mutate Production D1;
- turn on itemized Create UI;
- autofill Catalog prices into manager drafts;
- reinterpret old orders;
- alter payment facts;
- activate itemized existing-order edits;
- change Return/Exchange policy;
- decide unresolved client pricing policy.

## Deferred next work

When work resumes:
1. connect the new-order UI to itemized semantics only inside already accepted pricing dimensions;
2. preserve safe behavior when Catalog recommendation is missing/ambiguous;
3. protect future itemized orders from legacy Edit semantics;
4. add end-to-end Branch2 coverage for itemized creation/read/report paths;
5. stop at client-policy boundaries instead of inventing pricing rules.
