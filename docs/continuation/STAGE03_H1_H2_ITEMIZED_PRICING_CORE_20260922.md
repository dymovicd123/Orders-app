# Stage03-H1/H2 — pure itemized pricing core

Date: 2026-09-22
Final green Branch2 baseline: `40e3d39d1fc3b13c00f6e10811279e712ca40ad4`
Cloudflare monitor: `35761143468` — success

## H1 — pure money arithmetic

`worker/domains/order-pricing.ts` introduces a database-independent itemized calculator.

Contract:
- line total = quantity × actual sold unit price;
- order total = sum of line totals;
- received amount = sum of payment facts;
- debt = max(total − received, 0);
- overpayment is exposed and the save validator rejects it;
- missing final price is invalid;
- explicit zero is mathematically representable pending client policy;
- no current Catalog lookup, Catalog snapshot reinterpretation, manual order-total override or D1 access participates in arithmetic.

Focused gate:
`scripts/test-stage03-h1-itemized-money-calculator.mjs`.

## H2 — pure write-plan contract

H2 adds `buildItemizedOrderWritePlan`.

The write plan contains:
- explicit `pricingMode: 'itemized_v1'`;
- normalized quantity and final sold unit price;
- server-derived line totals;
- nullable immutable Catalog recommendation snapshot;
- server-derived order total, received amount and debt.

The Catalog snapshot is historical context only. It never participates in the commercial total formula.

Focused gate:
`scripts/test-stage03-h2-itemized-write-plan.mjs`.

## Inactive-by-design boundary

H1/H2 are not imported by the current runtime order path. This is intentional.

No behavior changed for:
- current Create Order UI;
- current Edit Order UI;
- legacy orders;
- Catalog autofill;
- Returns;
- Exchanges;
- Finance reports;
- D1 data;
- Production.

Exact structural manifests keep this deliberate inactive state auditable rather than silently weakening dead-code protections.

## Deployment recovery notes

H1 initially failed Step 190.6A because the new standalone Worker module was outside the historical declaration baseline. Exact newest-layer normalization fixed that.

The next H1 run then failed Step 190.6C because the module was intentionally unreachable. 1906C now permits only the exact manifested pricing file while all other unexplained unreachable Worker modules still fail.

The first H2 run failed the older H1 focused gate because that gate searched the entire shared pricing file for `catalogPriceSnapshot`. H2 legitimately introduces the snapshot in a separate write-plan layer. The H1 gate was narrowed to the H1 calculator function, preserving the intended arithmetic isolation without forbidding H2 metadata.

Final monitor `35761143468` is green.

## Next bounded step

Prepare the server-side new-order integration boundary:
- existing requests remain legacy-compatible by default;
- only an explicit future `itemized_v1` request may invoke H2;
- server must ignore/reject a manual order-level total for itemized mode and persist H2-derived values;
- current UI must not send itemized mode yet;
- no Catalog autofill until unresolved product rules are decided.
