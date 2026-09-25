# Stage03 H8 — ручная приёмка Branch2

Date: 2026-09-25

Environment: **Branch2 only**

Use only Worker `orders-app-branch2` / D1 `orders_db_branch2`.

## Clean baseline

The one-shot reset removes previous Branch2 transactional test residue:
- orders/items/payments/returns/exchanges;
- Workshop tasks and order reservations;
- financial/cash/activity history created by tests;
- critical-operation/idempotency residue;
- stocktake/transfer/inventory-operation audit residue;
- customers derived from old test orders.

It deliberately preserves:
- authentication/users and sessions;
- managers;
- reference dictionaries;
- the real Branch2 Catalog;
- non-test physical stock quantities.

All reservation aggregates are reset to zero because no orders remain.

New H8 acceptance uses only isolated Catalog products with prefix `BR2-H8-`.

## Fixture matrix

| Fixture | Catalog price | Warehouse | Boutique | Purpose |
|---|---:|---:|---:|---|
| BR2-H8-A ОСНОВНОЙ / СТАНДАРТ | 1000 | 10 | 4 | normal Create/edit/source/quantity |
| BR2-H8-A ОСНОВНОЙ / ПРЕМИУМ | 1300 | 6 | 2 | price-key change + re-price |
| BR2-H8-B МАЛЫЙ ОСТАТОК | 1500 | 2 | 0 | shortage flow |
| BR2-H8-C БЕЗ ЦЕНЫ | no Catalog price | 5 | 5 | manual final price / explicit zero |
| BR2-H8-D ЦЕХ | 2000 | 0 | 0 | Workshop source/task |
| BR2-H8-E ДЕТСКИЙ | 700 | 5 | 1 | child itemized path |

## Manual acceptance sequence

### T01 — clean start
Open Orders, Workshop, Clients, Finance/Cash.
Expected: no previous test orders, no previous H8 Workshop tasks, no previous test customers/payments/returns/exchanges. Search Catalog for `BR2-H8-` and confirm the fixtures are visible.

### T02 — ordinary itemized Create
Create one order with `BR2-H8-A ОСНОВНОЙ`, material `СТАНДАРТ`, qty 2, Warehouse.
Expected: Catalog price 1000 per unit, line total 2000, order total 2000. Save succeeds. Warehouse physical remains 10; reservation becomes 2; available becomes 8.

### T03 — partial payment / debt
On a fresh order use the same line qty 2, payment 500.
Expected: total 2000, received 500, debt 1500. No price is reconstructed from payment amount.

### T04 — missing Catalog price
Create `BR2-H8-C БЕЗ ЦЕНЫ`.
Expected: Catalog recommendation is absent, Save is blocked until final sold price is entered. Enter 900 and save.
Repeat on another order with explicit final price 0.
Expected: 0 is accepted as an intentional sold price, not treated as “missing”.

### T05 — H8B metadata correction
Open an itemized order and change only customer/city/comment.
Expected: save succeeds; products, quantities, sources, sold prices and total do not change; reservation does not move.

### T06 — H8C sold-price correction
Open an unpaid or partially paid itemized order and change sold price 1000 → 900.
Expected: explicit confirmation is required. After confirmation, line/order total and debt change; Catalog snapshot stays 1000; reservation/stock do not move.
Then try to lower total below money already received.
Expected: Save is rejected as overpayment.

### T07 — H8E quantity rewrite
Create `BR2-H8-A ОСНОВНОЙ / СТАНДАРТ` qty 2 on Warehouse. Reopen → “Изменить состав” → qty 3.
Expected preview counts the old reservation as releasable rather than double-reserving it. Save succeeds; final active reservation is 3, not 5; old order-item row becomes historical/replaced.

### T08 — H8E source switch
For an A/STANDARD order switch Warehouse → Boutique.
Expected: preview uses Boutique stock 4. After save, Warehouse reservation is released and Boutique receives exactly the new reservation. Physical quantities are not reduced just by editing.

### T09 — H8E Catalog price-key change
On A/STANDARD switch material to `ПРЕМИУМ`.
Expected: Catalog recommendation changes 1000 → 1300 and snapshot becomes 1300.
Then first manually set a sold price (for example 1100), and after that change the price-driving material.
Expected: manual sold price remains visible but requires explicit confirmation before Save.

### T10 — add/remove item
In composition mode add `BR2-H8-E ДЕТСКИЙ`; remove another line.
Expected: cannot remove the final remaining line. Multi-line total is exact sum of line totals; reservations match only the final active composition.

### T11 — shortage
Use `BR2-H8-B МАЛЫЙ ОСТАТОК` from Warehouse with qty 3 while physical stock is 2.
Expected: shortage is shown. “Посчитать сейчас” uses fresh stock. “Сейчас проверить не могу” keeps the unresolved/attention path rather than silently pretending stock exists. There must be no generic 500.

### T12 — Workshop
Create or rewrite a line to `BR2-H8-D ЦЕХ` with source Workshop.
Expected: Warehouse/Boutique stock is irrelevant; a Workshop task is created.
Rewrite away from Workshop.
Expected: replaced old Workshop task is cancelled/retired and the new composition owns only its current tasks.

### T13 — stale two-tab protection
Open the same itemized order in tab A and tab B. In A change composition and save. Without refreshing B, attempt a different composition save.
Expected: B is rejected with a controlled “order/item changed, refresh and retry” conflict. It must not overwrite A.

### T14 — sent/downstream protection
Mark a test order sent through the normal shipping action, then try “Изменить состав”.
Expected: blocked.
For an order with a completed Return/Exchange, composition rewrite must also be blocked. Itemized Exchange itself remains intentionally unavailable until its price policy is approved.

## What to send back after testing

For each test, send only:
- test id (T02, T07, etc.);
- PASS / FAIL;
- screenshot for FAIL;
- exact visible error text if any.

Do not use real Catalog products for this acceptance cycle; use only `BR2-H8-` fixtures so every effect is attributable to the new Stage03 flow.
