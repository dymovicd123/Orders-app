# Finance forensic — 2026-08-24 discrepancy

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`

## Scope

Read-only investigation requested after client videos showed that manually counted 2026-08-24 amounts appeared lower than Finance totals.

No Production D1 write, migration, repair, order edit, payment edit or business mutation was performed.

A temporary forensic branch `forensic-finance-20260825` was used only to execute read-only calls against the existing Production API. The first attempted direct Cloudflare D1 Query API call failed with HTTP 403 / code 7403 because the GitHub Cloudflare token lacks D1 Query permission; no query mutation occurred. The successful forensic used the live read-only API endpoints.

## Proven 2026-08-24 order facts

Production returned exactly 14 active/non-deleted orders dated 2026-08-24.

- Active order total: 1,007,800 KZT.
- All non-deleted order total: 1,007,800 KZT.
- Archived orders dated 2026-08-24: 0.
- Period debt on those orders: 40,000 KZT.
- Therefore received amount belonging to orders dated 2026-08-24 is 967,800 KZT.

The entire 40,000 KZT difference between the client's manual 967,800 KZT and the Finance `Продажи` 1,007,800 KZT is one current-day partially paid order:

- internal order id: 1155
- external id: `ORD-20260824121101-FA3AE6E6`
- order date: 2026-08-24
- total amount: 45,000 KZT
- received amount: 5,000 KZT
- debt amount: 40,000 KZT
- status: active

So there is no hidden/archived 40,000 KZT sale. The client manually arrived at the sum of received amounts (967,800), while `Продажи` intentionally sums full order values including unpaid debt (1,007,800).

## Proven 2026-08-24 payment facts

Finance returned:

- `Оплаты заказов`: 1,057,800 KZT
- `Закрытие долгов`: 22,500 KZT
- total cash received / gross received: 1,080,300 KZT
- payment-method total: 1,080,300 KZT
- consistency difference: 0

The 1,057,800 KZT `Оплаты заказов` consists of:

- 967,800 KZT received on orders whose order_date is 2026-08-24;
- 45,000 KZT payment made on 2026-08-24 for an order dated 2026-08-22 (order id 1152);
- 45,000 KZT payment made on 2026-08-24 for an order dated 2026-08-21 (order id 1148).

Thus:

967,800 + 45,000 + 45,000 = 1,057,800 KZT.

Additionally, one 22,500 KZT `debt_close` payment was made on 2026-08-24 for an order dated 2026-08-16 (order id 1043).

Thus the full money received on the day is:

967,800 + 90,000 + 22,500 = 1,080,300 KZT.

This exactly matches the method breakdown shown in the client video:

- Kaspi Pay: 469,800
- Terminal: 357,500
- Halyk transfer: 168,000
- Kaspi shop: 45,000
- Cash: 40,000
- Total: 1,080,300 KZT

## Root cause of client confusion

No arithmetic corruption was found for this date. The UI places metrics with different time semantics next to one another without enough explanation/drill-down:

- `Продажи` = full values of orders whose `order_date` is in the selected period, including unpaid debt;
- `Оплаты заказов` / `Поступило` = actual payment operations whose `payment_date` is in the selected period, including payments for orders from earlier dates;
- `Закрытие долгов` is separately classified but also contributes to money actually received;
- current debt is a current-state metric, not limited to the selected order-date period.

The key confusing day demonstrates all of these at once: one new order has 40,000 KZT unpaid debt, while 90,000 KZT of ordinary payments and 22,500 KZT of debt closure arrived for older orders.

## Product follow-up

Before changing finance arithmetic, improve transparency/drill-down so every headline amount can be reconciled to concrete orders/payment operations. Candidate presentation:

- `Продажи по заказам даты`: full order value;
- `Из них оплачено по этим заказам`;
- `Осталось долгом по этим заказам`;
- `Оплаты сегодня по заказам прошлых дат`;
- `Закрытие старых долгов`;
- `Всего денег поступило сегодня`.

Do not change financial formulas until a separate UX/product decision is made; the 2026-08-24 forensic proves the existing records reconcile exactly.

## Warehouse resume point

This finance investigation does not change Warehouse state or roadmap. Resume Warehouse from `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md`, current next code/audit task: Phase 1A read-only cross-workflow audit of Workshop-origin client return/exchange disposition.
