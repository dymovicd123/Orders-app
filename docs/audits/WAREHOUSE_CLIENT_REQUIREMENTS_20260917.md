# Warehouse client requirements — captured 2026-09-17

## Source-derived requirements from the client message

The client asks for the Warehouse area to support these business views and controls:

1. Stock should be distinguishable by **color**.
2. **Sales and returns should be visible together** for the same merchandise, because an item can sell every day while also generating daily returns.
3. They want to see the **most effective colors and sizes**.
4. They want to see **product profitability / assortment performance**.
5. Products that have lost relevance in sales should be removable from the active assortment so stagnant stock does not accumulate.
6. Every product should have a **cost price** and a **sale price** set from the warehouse/catalog side.
7. They want warehouse value indicators such as:
   - how many units are in stock;
   - how much money is frozen in stock at cost;
   - how much revenue the current stock could produce at sale price (forecast/potential sales value).
8. When Workshop items become ready, they want a separate financial **Workshop invoice / goods-received note** showing the value of goods received.
9. That Workshop invoice should persist as history with payment state such as **unpaid / partially paid / paid**.
10. They want a running **Workshop payable ledger**: existing debt plus new daily invoices plus payments, effectively a debit/credit history with a current amount owed to Workshop.

## Important distinction: source requirement vs interpretation

The following design implications are analysis, not literal wording from the client.

### A. Do not physically delete catalog products for assortment retirement

Current Branch2 already has `is_active` on products and variants. The active Catalog UI filters inactive products/variants out. Inventory reads also deliberately keep an inactive catalog variant visible while it still has non-zero physical or reserved stock, and hide inactive zero-stock rows from routine stock reads.

That is a useful base behavior:

- historical orders/reports keep their references and snapshots;
- an item removed from the active assortment does not disappear while physical units still exist;
- once it is inactive and has no stock/reservations, it stops cluttering routine stock browsing while remaining in DB/history.

Do not use DB deletion to solve assortment retirement.

One business rule still needs client confirmation later: when an item is removed from assortment but stock remains, should employees still be allowed to sell the remaining units (sell-through) or should it be blocked immediately? Do not invent that policy during implementation.

### B. Current stock overview is technically hierarchical, but not yet business-oriented

Current stock grouping is primarily product/business identity + category + material + length. The expanded browse hierarchy is effectively:

`product -> execution (material/length) -> color -> category/gender -> size`

This is logically consistent with catalog identity, but the client is explicitly asking to think about merchandise in terms of **color, size, sell-through, returns, profitability and frozen money**.

This may explain part of the subjective discomfort with the current “Остатки” screen: it is optimized for inventory correctness and variant identity, not for scanning the assortment like a shop owner/manager.

Do not patch this by adding more explanatory text. The next Warehouse redesign should test a more merchandise-oriented presentation.

### C. Sales price and cost price need different historical semantics

A simple current/default price can live on the base product for normal order autofill. But historical financial truth must remain on transaction snapshots.

Likely minimum model:

- product current/default sale price;
- product current/default cost price;
- order item `unit_price` remains the immutable sale-price snapshot for that sale;
- inventory receipt / Workshop invoice line needs a cost snapshot so future cost changes do not rewrite historical profitability.

Do not set unknown price/cost to `0`; zero is a real monetary value. Unknown should be nullable/explicitly missing.

### D. “Frozen money” and profitability cannot safely be calculated from only today’s product cost if costs can change

If cost price never changes, `stock qty × current cost` is enough.

If costs can change between batches (likely, but not stated by the client), accurate current inventory valuation and historical margin require cost snapshots/cost layers or a defined valuation rule (e.g. weighted average/FIFO). Do not choose an accounting method without confirming the business requirement.

For the first implementation, separate two questions:

- **current assortment defaults** (sale price / cost price used for new work);
- **historical transaction cost** used for actual profitability and Workshop payable history.

### E. Existing Workshop “Накладная” is not the requested financial payable invoice

Current Workshop “Накладная” is an operational/printable list of Workshop tasks by period/urgency. It contains item characteristics and quantities but is not a persistent supplier-payable record with amount and payment state.

The client request therefore implies a new financial entity, not just adding a total to the existing printable table.

Likely conceptual entities (names not final):

- Workshop invoice header (date/status/total/paid/balance);
- Workshop invoice lines (product/variant/qty/unit cost snapshot/line total);
- Workshop payments/adjustments;
- derived current Workshop payable balance.

The Workshop task remains production workflow; the invoice is financial history. Avoid making one overloaded table/entity represent both.

### F. Sales + returns + color/size should become one assortment-performance read model

The request is not just “add a color filter”. The useful read model should be able to answer, for a product/color/size over a chosen period:

- sold units;
- returned units;
- net sold units;
- sales revenue;
- return amount;
- gross/net margin when cost data exists;
- current stock;
- stock cost value;
- potential sales value;
- possibly days since last sale / sell-through later if useful.

Do not create separate unrelated mini-reports for color, size, returns and profitability if one grouped assortment-performance query can serve them.

## Product/UX direction for the Warehouse redesign

Keep the parts already reported as relatively clear: revision and routine operations.

Concentrate redesign effort on **Остатки / assortment browsing**.

The target mental model should be closer to:

`Товар -> Цвет -> Размер -> Остаток / продажи / возвраты / деньги`

with material/length/gender available as relevant characteristics, rather than forcing the user to navigate catalog-internal hierarchy first.

This is a hypothesis from the client requirements and current code, not yet a final UI specification. It should be checked in the Admin/GUI walkthrough before implementation.

## Relationship to the ongoing UX audit

These requirements must be included in the final simplification plan before implementing prices or rebuilding Warehouse.

They reinforce existing audit themes:

- operational truth vs snapshots;
- default/inferred/confirmed values;
- one business process should not be split across multiple modules;
- global explanations should not substitute for contextual UI;
- new features should extend a coherent model rather than become parallel mechanisms.

The final plan should therefore sequence Warehouse/pricing/workshop-payables together enough to avoid implementing product prices twice or building profitability on the wrong cost semantics.
