# Stage03-G1 — report / pricing isolation audit

Date: 2026-09-22
Green code baseline: branch2 `f290648f8ffbc43eb2bebbcacafbaa26a568cef9`
Cloudflare monitor: `35753441638` — success

## Purpose

Before item-level pricing is activated, verify that existing reports do not accidentally reinterpret historical business facts from mutable current Catalog prices.

The audit covered:

- Finance overview;
- payment-method report;
- manager report;
- city report;
- product report;
- returns report;
- debt / closed-debt report;
- Finance day journal and reconciliation;
- cash register and historical cash views;
- order finance summary;
- team plans and department plans;
- team activity;
- leads and Call Centre surfaces;
- dashboard/report renderers;
- Orders debt surface;
- Orders list/period aggregate path.

## Result

The audited reports remain based on persisted historical facts:

- sales / average check / manager and city sales -> `orders.total_amount`;
- received and payment-method breakdown -> `payments.amount + payments.method`;
- current debt -> `orders.debt_amount`;
- returns -> `returns.amount`;
- exchange activity -> `exchanges.financial_amount`;
- Finance-day chronology/reconciliation -> payment / financial-event / cash-ledger facts;
- cash register -> `cash_register_entries` and related cash/financial-event facts;
- manager and department plan fact -> actual payments minus actual returns;
- team activity -> order snapshots, financial events, returns and exchange financial facts.

No audited report/dashboard path reads `catalog_execution_prices`.

Therefore changing a product's current Catalog price does not rewrite or reinterpret these existing reports.

## Important dependency for future itemized orders

Several sales reports intentionally depend on `orders.total_amount`.

That remains correct only if future `itemized_v1` creation persists a server-derived final order total after line discounts/overrides.

Reports themselves should still not read the mutable current Catalog price.

## Existing product-report issue confirmed

The backend product aggregate still has a legacy field:

`order_sales = SUM(o.total_amount)`

while grouping through `order_items`.

For a multi-product order, this is not exact revenue attributable to one product and can duplicate the whole order total across product groups.

This defect predates Stage03.

Current UI does **not** display `order_sales`; the visible product report currently shows product, quantity and order count. Stage03-G1 adds a regression guard so the unsafe field cannot silently appear as exact product revenue.

Do not use this field for exact product revenue, margin, profitability or discount analytics.

For future `itemized_v1`, exact product revenue can use historical `order_items.line_total`. Legacy orders still have no trustworthy general per-item revenue allocation.

## Reports safe to keep without client decisions

The following are technical invariants and do not need client policy:

- current Catalog price never rewrites historical reports;
- payment-method reporting is based on actual payments;
- cash is based on actual cash movements;
- debt is based on final persisted order total versus received money;
- old legacy orders retain their own historical total;
- return/exchange monetary facts stay independent until their future pricing policies are explicitly redesigned.

## Still unresolved by business policy

This audit does not decide:

- how exact product revenue should be presented for legacy multi-product orders;
- whether the client wants explicit discount reports;
- return refund defaults from sold item price;
- exchange price-difference policy;
- historical profitability allocation.

## Regression gate

`scripts/test-stage03-g1-report-price-isolation.mjs`

The gate protects current report sources and keeps mutable Catalog prices out of historical reporting.
