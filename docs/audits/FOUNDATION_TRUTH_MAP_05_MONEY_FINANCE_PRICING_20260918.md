# Foundation truth map 05 — Money / Finance / price readiness — 2026-09-18

## Scope

Branch2 baseline rechecked before this block:

`fb43e8d709b57b67cc080bb9bd64246bb036aede`

Audit branch baseline before this block:

`7ffbfbe720f9cf25690de9124db444b22151cbf1`

This is a source-of-truth / architecture audit. Branch2 and Production D1 were not modified.

Questions for this slice:

- What is the authoritative current money state?
- What is immutable money history?
- What is only physical cash?
- What do `orders.total_amount / received_amount / debt_amount / return_amount` actually mean?
- Are current reports mixing business dates incorrectly?
- Can the current order-item price fields support product profitability?
- Can current Returns allocate refund money to products/colors/sizes?
- What does Exchange do to both sale value and cash?
- Where can future sale price, cost, stock valuation and Workshop payable attach safely?

Astra's completed Manager and Return/Exchange GUI reports were also reviewed as black-box evidence. The code conclusions below distinguish arithmetic/source-of-truth findings from UI observations.

---

## 1. There are three different financial ledgers, and they should remain different

The current system has three separate concepts.

### A. Current commercial-operation state

Current positive receipts are represented by `payments`.

Current refunds are represented by non-cancelled `returns`.

The current commercial amount of an order is `orders.total_amount`.

These rows answer questions such as:

- how much is the order currently worth?
- which payments currently count?
- which refunds currently count?
- how much customer debt is still open?

### B. Immutable money history

`financial_events` is an append-only history layer.

Modern operations append events such as:

- `order_payment`;
- `debt_close`;
- `order_extra`;
- `exchange_extra`;
- `order_refund`;
- `exchange_refund`;
- `payment_reversal`;
- `refund_reversal`.

Corrections do not rewrite old event history. They append reversal/correction events.

This is the right contract for audit history.

### C. Physical cash drawer

`cash_register_entries` is a different ledger again.

It includes:
- opening balance;
- cash payments/refunds when auto-tracking applies;
- manual cash in/out;
- reconciliation adjustments;
- ledger-cycle reset.

It answers:

> how much physical cash should be in the drawer now?

It must not be treated as total business revenue because non-cash payment methods do not belong there, and opening/reconciliation movements are not sales.

### Conclusion

The existence of three ledgers is **not itself duplication debt**.

They answer three different real-world questions.

The architectural requirement is to keep their contracts explicit and prevent UI/reports from silently substituting one for another.

---

## 2. Current order money truth is recomputed from operation rows, then cached on the order

`readOrderFinancialLedger()` currently computes:

```
totalAmount    = orders.total_amount
receivedAmount = SUM(payments.amount)
returnAmount   = SUM(non-cancelled returns.amount)
debtAmount     = MAX(0, totalAmount - receivedAmount)
```

Then `syncOrderFinancialLedger()` writes:

- `orders.received_amount`;
- `orders.return_amount`;
- `orders.debt_amount`.

Therefore those three order fields are best understood as **denormalized current read projections/cache**, not independent transaction truth.

The underlying current-operation rows are stronger:

- received money → `payments`;
- refunded money → active `returns`;
- commercial order amount → `orders.total_amount`.

This is important because several read paths use the cached order fields for D1 read-budget reasons.

That is acceptable as an optimization, but the architecture should say explicitly:

> cached aggregate is not a second independently writable financial authority.

A previous code comment records that Production had zero payment-sum / `received_amount` mismatches across 1,295 active orders at the time of that forensic check. This is useful historical evidence that synchronization worked then, but it is not a fresh Production verification in this audit.

---

## 3. “Долг” is customer obligation, not net revenue

Current debt formula is:

```
debt = order total - payments received
```

Refunds are not subtracted from debt.

That initially looks surprising, but it is coherent with the current meaning:

> how much more does the customer still owe under the current order commercial amount?

Example:

```
order total 100
received 100
ordinary refund 20
debt 0
```

The business has refunded 20, but the customer does not suddenly owe 20 again.

Therefore future reports must not reinterpret `debt_amount` as:

- net sale;
- profit;
- net cash;
- sale value after returns.

It is a separate current-obligation metric.

---

## 4. The current Finance summary has mostly correct metric separation

The Finance UI explicitly distinguishes:

- **Продажи** — by order date;
- **Поступило** — by payment date;
- **Вернули клиентам** — by refund date;
- **Чистое движение** — received minus refunded.

This matches the underlying report code.

The daily finance view also distinguishes:
- current `payments`;
- immutable `financial_events`;
- physical `cash_register_entries`.

It can report reconciliation as matched / limited / different instead of pretending all three datasets are identical.

Astra's Return lifecycle pass also found the tested Return cancellation coherent:
- incoming money;
- refund;
- net movement;
- cancelled refund excluded after cancellation.

No arithmetic contradiction was observed in that test.

### Preserve this

The finance core should not be replaced by one giant “balance” table.

The current separation of:
- commercial order value;
- incoming money;
- refunds;
- cash drawer;
- immutable audit history

is one of the stronger parts of the system.

---

## 5. Reports still have a date-contract contradiction

The generic Reports screen says:

> “Период в финансовых отчётах всегда определяется по дате заказа.”

That statement is false for several existing reports.

Actual backend behavior includes:
- sales → order date;
- payments → payment date;
- returns → return date;
- debt closures → payment date;
- manager/city views → mixed measures with each fact using its own business date.

Astra independently observed both conflicting explanations on the same Reports screen and classified it as M-08 HIGH.

### Root cause

This is not primarily a wording typo.

It is another projection problem:

> one shared report shell tries to describe heterogeneous business facts with one global period rule.

The correct rule is not “all reports use one date”.

The correct rule is:

> **each fact belongs to its own business date, and the report must state which fact the selected period filters.**

Finance already moves in that direction. Reports has not fully caught up.

---

## 6. Current “Продажи” is booked order value, not cash and not profit

`financeReport.overview.totalSales` is built from:

`SUM(orders.total_amount)`

for orders whose `order_date` lies in the selected period.

Therefore “Продажи” currently means approximately:

> commercial order value booked on that order date.

It does **not** mean:
- cash received;
- received minus refunds;
- profit;
- gross margin;
- value of physically shipped goods;
- value of stock consumed.

That distinction is valid, but future profitability must not reuse the label “sales” as if it were already a complete profit measure.

---

## 7. Current create flow makes per-item sale-price history unusable for new orders

The schema already contains:

- `order_items.unit_price`;
- `order_items.line_total`.

This is the correct place for an immutable historical line-sale price snapshot.

The old W7 readiness note correctly said catalog/default pricing should remain separate from historical transaction price.

However, the current create workflow does this:

```
unitPrice: 0
```

for every item sent to the server.

The user enters one separate:

`Цена заказа`

and `calculateTotals()` lets this order-level override win over the sum of item prices.

The create UI even explicitly says:

> “Цена и дата живут отдельно от товарных позиций.”

### Consequence

For a new multi-item order such as:

```
Dress A
Dress B
Order price = 90 000
```

the database can currently contain:

```
A unit_price = 0
B unit_price = 0
orders.total_amount = 90 000
```

So although the schema is structurally price-ready, the **current transaction workflow is not line-price-ready**.

We cannot truthfully answer:

> how much revenue did Dress A generate?

from current new-order rows.

This is a major blocker for:
- profitability per product;
- profitability per color;
- profitability per size;
- margin by SKU;
- correct revenue reversal when one line is returned.

---

## 8. Manual whole-order price and future automatic item pricing need an explicit contract

Today the order total can be a manual override independent of line prices.

Future automatic pricing cannot simply populate `unit_price` and assume:

```
order total = SUM(line totals)
```

because the existing workflow permits a separate whole-order amount.

Before implementation we need one clear business contract for:
- whether employees can override item prices;
- whether they can override only the whole order total;
- discounts;
- bundles;
- delivery or other order-level adjustments;
- how a manual total is allocated across lines for profitability.

Without that rule, “autoprice” could make the UI look convenient while leaving the accounting model contradictory.

### Safe invariant already known

Whatever default price is used, the actual price accepted for the sale must be frozen on the historical order line and never change when catalog price changes later.

---

## 9. Current Return knows which items came back, but normal UI does not allocate refund money to them

The backend `return_items` table has an `amount` column.

The backend `createReturn()` can accept an amount per returned item.

But the current Return UI sends only:
- `orderItemId`;
- quantity;
- physical-state/restock decision.

It does **not** send per-item refund amount.

Therefore normal Return operations preserve:
- total refund money at `returns.amount`;
- returned item identities;
- returned quantities;
- physical disposition.

But they do not preserve a reliable rule such as:

> 18,000 ₸ of this refund belongs to red size 48 and 22,000 ₸ belongs to black size 50.

### Consequence

The current data is sufficient for:
- total refund cash;
- return counts;
- physical stock return.

It is **not sufficient for truthful SKU-level revenue/profit reversal** on arbitrary multi-item returns.

This directly affects the client's request for:
- profitable colors;
- profitable sizes;
- product profitability;
- sales and returns together.

---

## 10. Exchange exposes a dangerous future double-counting trap

Exchange financial handling has a different commercial effect from an ordinary Return.

### Extra-payment exchange

The code:
- creates an extra payment;
- increases `orders.total_amount` by the exchange financial amount.

### Refund exchange

The code:
- creates a refund Return + immutable refund event;
- **decreases `orders.total_amount` by the exchange financial amount**.

Therefore after:

```
original order total = 100
exchange refund = 20
```

the current order can become:

```
orders.total_amount = 80
returns.amount = 20
```

Cash truth is:

```
received 100 - refunded 20 = 80
```

But a naïve future formula:

```
net revenue = orders.total_amount - returns
```

would incorrectly produce:

```
80 - 20 = 60
```

### Important asymmetry

A normal standalone Return records a refund but does not reduce `orders.total_amount`.

An exchange refund does reduce `orders.total_amount`.

So `orders.total_amount` is neither:
- immutable original sale value;
- nor uniformly “sale after every refund”.

It is closer to the current commercial order amount, including exchange price-difference adjustments.

### Conclusion

Future profitability cannot be built by subtracting Return totals from current order totals.

Commercial adjustment and cash movement must remain distinct facts.

---

## 11. Current Product report is not a profitability report

The visible Product report currently shows:
- product;
- quantity;
- number of orders.

It does not show:
- revenue;
- returns;
- return rate;
- color;
- size;
- cost;
- margin;
- stock value;
- profitability.

That is consistent with the current data limitations.

There is also a backend `order_sales` field in one product grouping query that sums the **whole order total** for each product grouping.

For a multi-product order, that can attribute the same whole-order revenue to multiple products.

The current renderer does not expose that field, which avoids showing a false revenue number.

### Direction

Do not “finish” product profitability by exposing `order_sales`.

It requires proper per-line commercial attribution first.

---

## 12. Product/color/size performance requires transaction identity, not display text

Current product report grouping is based largely on snapshot text such as:
- product name;
- material;
- gender.

The client now wants:
- best colors;
- best sizes;
- stale assortment;
- profitability.

Those metrics should ultimately group by stable canonical IDs where available:
- product_id;
- execution/stock-position identity if required;
- variant_id for exact SKU/color/size.

Historical snapshots remain valuable as display/audit facts, but should not be the grouping identity for future commercial analytics.

This is the same Product truth rule already established in foundation slice 02.

---

## 13. The correct future sale-price boundary

A future default/current catalog price should be **master data**, not historical order truth.

Conceptually:

```
catalog/default sale price
        ↓ resolve at order creation
actual accepted line sale price
        ↓ freeze
order_items.unit_price / line_total
```

Later catalog price changes must not rewrite old order lines.

The exact default-price granularity is still a business decision:
- base product;
- product + material/length execution;
- exact variant/SKU;
- inherited base price + overrides.

Do not choose that hierarchy only because the database supports all three identity levels.

It should match how the client actually prices goods.

---

## 14. The correct future cost boundary is different from sale price

Sale price answers:

> what did the customer pay / agree to pay?

Cost answers:

> what did this unit cost the business?

For warehouse goods, if acquisition cost can change by receipt/batch, future profitability cannot safely use:

```
current stock quantity × today's master cost
```

for historical COGS.

For Workshop goods, the previous slice established the same rule:
- current/default Workshop cost may be master data;
- actual historical production cost must be frozen on the production/accounting event.

Therefore future cost architecture needs:
- a current/default cost rule for convenience;
- historical acquisition/production cost snapshots for completed real-world events.

FIFO vs weighted average vs exact lot tracking is **not chosen** in this audit.

---

## 15. Workshop payable must enter Finance as liability/payable, not customer revenue

The client wants:
- production invoice/history;
- paid/unpaid/partial;
- running debt to Workshop.

That is a **business payable** domain.

It must not be represented as:
- negative customer revenue;
- a customer Return;
- a cash-register-only entry;
- a mutation of `orders.debt_amount`.

The existing customer money model can inspire safety patterns:
- immutable event/history;
- current payable balance;
- explicit payments/reversals;
- audit-safe corrections.

But Workshop payable is a separate liability to a counterparty.

The exact liability-recognition moment still requires business confirmation:
- production completion;
- acceptance;
- Workshop invoice/statement.

---

## 16. Cash drawer must not become the universal finance ledger

The physical cash module is well-scoped today.

It tracks:
- physical cash balance;
- manual cash in/out;
- reconciliation;
- cash payment/refund effects.

Future:
- Workshop payment;
- supplier payment;
- operating expense;
- cost accrual

may or may not move physical cash.

If they are cash payments, they can also produce cash-register movements.

But their primary business truth should live in the appropriate payable/expense domain, with cash as the physical payment channel.

Otherwise Finance would become dependent on one payment method.

---

## 17. Astra GUI evidence aligns with the code diagnosis

Astra did not find a demonstrated arithmetic contradiction in the tested finance/Return paths.

It did find:
- gross received and net movement are different and can both be numerically correct;
- cancelled refund was excluded correctly;
- Return physical receipt remained separate from refund money;
- Reports date instructions contradicted the actual mixed date semantics.

So the strongest finance diagnosis is **not**:

> the money calculations are fundamentally broken.

It is:

> the money core is fairly robust, but commercial attribution and human-facing metric contracts are incomplete.

That distinction matters. Rewriting the ledger would create more risk without solving profitability.

---

## 18. Confirmed root defects / missing contracts from this slice

### F-ROOT-01 — order aggregate fields are caches but many reads can look at them as primary facts

Modern mutation paths synchronize them, but the contract is implicit.

### F-ROOT-02 — historical line sale price exists in schema but current create workflow writes zero

Order-level sale value cannot be truthfully attributed to individual products/SKUs.

### F-ROOT-03 — ordinary Return does not allocate refund money to returned lines

Item/quantity truth and refund-money truth are separate with no line-level monetary attribution.

### F-ROOT-04 — Exchange refund changes both commercial total and refund cash history

Naïve “order total minus returns” analytics will double-subtract exchange refunds.

### F-ROOT-05 — Reports uses one generic date explanation over facts with different business dates

Astra M-08 confirms the contradiction in the live GUI.

### F-ROOT-06 — Product report is quantity/order-frequency analytics, not commercial profitability

Current data model does not yet support truthful product/color/size margin.

### F-ROOT-07 — current `order_sales` product-group field is unsafe as product revenue

It can attribute whole-order totals to each product group in a multi-item order.

### F-ROOT-08 — future prices/costs/payables have no shared explicit commercial attribution contract yet

Adding UI fields before defining this would create another layer of contradictory totals.

---

## 19. Strong mechanisms to preserve

Do not rewrite these simply to “simplify Finance”:

- `payments` as current positive-payment facts;
- `returns` as current refund-operation facts with cancellation status;
- immutable `financial_events` with reversal events;
- `syncOrderFinancialLedger()` as reconciliation of order aggregate caches;
- explicit payment business date vs recorded-at audit time;
- physical cash as separate `cash_register_entries`;
- cash opening/reconcile/reset distinct from sales;
- Finance reconciliation diagnostics;
- Return physical receipt separate from refund money;
- Exchange financial operations explicitly typed as extra payment / refund / none.

The simplification target is the read/projection contract and line economics, not deletion of these safety layers.

---

## 20. Metric contract for later design

The eventual UI/report layer should not use one vague “money” number.

At minimum, preserve distinct meanings:

```
Booked sales / commercial value
  = order commercial terms, by order/business sale date

Cash received
  = positive payment operations, by payment date

Refunded cash
  = active refund operations, by refund date

Net cash movement
  = cash received - refunded cash
  (still not profit)

Customer debt
  = outstanding customer obligation

Line revenue
  = frozen historical sale amount attributed to exact sold line
  (currently missing for new orders)

COGS / historical cost
  = frozen acquisition/production cost consumed by sold line
  (not yet implemented)

Gross margin
  = line revenue adjusted by commercial returns/adjustments - COGS
  (cannot yet be computed truthfully)

Physical cash balance
  = cash-register ledger
  (not total revenue)
```

---

## 21. Practical price-readiness conclusion

The answer to “are we ready to add prices?” is:

> **Identity-wise: mostly yes. Transaction-attribution-wise: not yet.**

Good existing anchors:
- stable product/execution/variant identity;
- `order_items.unit_price`;
- `order_items.line_total`;
- exact SKU stock history.

Missing before profitability:
- populate actual historical line sale prices on new orders;
- define order-level discount/override allocation;
- allocate refund money/commercial reversal to returned lines;
- define cost granularity and historical cost basis;
- model Workshop production payable separately.

This should be fixed as one coherent commercial model, not as independent “price fields” added to Catalog, Warehouse, Reports and Workshop.

---

## 22. Strongest foundation diagnosis after five slices

Across Order, Product, Stock, Workshop and Money, the same pattern is now repeated enough to call it a root cause:

### The write-side core often preserves the real facts well.

Examples:
- payments vs refunds;
- immutable financial reversals;
- physical stock;
- reservations;
- stocktakes;
- per-item Workshop tasks;
- Return physical receipt;
- canonical product identity.

### The system becomes fragile where broad legacy aggregates or UI-local projections try to summarize those facts.

Examples:
- `orders.workshop_status` beside Workshop tasks;
- `orders.return_amount > 0` used as lifecycle shorthand;
- reservation cache beside reservation ledger;
- historical snapshot beside canonical product identity;
- one order total with zero line prices;
- one report-period explanation over several business dates.

### Therefore the finite repair direction is not “rewrite the app”.

It is:

> **Declare one owner for each fact, classify caches/snapshots explicitly, add the few genuinely missing economic facts, and build reusable operational/commercial projections from those owners.**

That explains why local patches have kept multiplying: the local code was often compensating for an unstated cross-domain contract rather than an isolated bug.

---

## 23. Remaining business questions before implementation

These cannot be inferred safely from code:

1. At what level is normal sale price defined: product, execution, exact SKU, or inherited overrides?
2. Are manual per-order discounts/whole-order prices allowed after automatic pricing? If yes, how should they be allocated to lines?
3. At what level does cost vary?
4. If warehouse cost changes by receipt, does the client expect weighted average, FIFO, exact lot, or a simpler accepted method?
5. When exactly does debt to Workshop arise: completion, acceptance, or their invoice?
6. Are partial Workshop invoices/payments applied to documents, items, or only a running balance?

These are business rules, not missing code.

---

## 24. Next checkpoint

This completes the five planned foundation truth-map domains:
- Order;
- Product;
- Physical Stock;
- Workshop;
- Money / Finance.

A full new Return/Exchange GUI audit is not automatically required: Astra already completed the lifecycle pass, and the code slices above inspected the relevant physical and financial transitions.

The next useful block should be a **cross-domain synthesis / target contracts + finite repair sequence**, with one focused Return/Exchange code check only where the synthesis still has an unresolved dependency.

That synthesis should answer:
- which existing fields/tables become authoritative, cache, snapshot or legacy compatibility;
- which duplicate mutation paths should collapse to one command;
- which missing facts must be added before prices/profitability;
- how to simplify Warehouse/Resolver/Finance/Reports UI without removing safety;
- what can be deleted/retired after migration;
- what the finite “done” acceptance criteria are.

Stop here before designing or implementing that plan.
