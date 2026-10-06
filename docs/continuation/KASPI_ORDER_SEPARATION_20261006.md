# Kaspi order separation — Branch2 checkpoint, 2026-10-06

## Status

Kaspi separation is implemented and deployed to **Branch2 only** for manual acceptance.

- Branch2 runtime HEAD at acceptance checkpoint: `c07fd63439b6cb38e857ce3e6adb849d44f0a5b9`.
- Production/main remains untouched at the pre-Kaspi runtime.
- Branch2 D1 only received migration 0082.

## Business truth

Kaspi is not a parallel order system. It is an ordinary order with a persisted order-level payment identity.

Authoritative classification:

```
order_payment_method == 'КАСПИ МАГАЗИН'
```

Do **not** classify by `delivery_type`. ZAMMLER is only the usual/default delivery for this client and may not be universally Kaspi.

Manager ownership and Kaspi operational ownership are independent:
- the manager on the order is the person who made the sale;
- the employee responsible for Kaspi watches all Kaspi orders and confirms receipt of money regardless of manager.

Payment and shipping are independent:
- before client receipt, the order can have full debt and no factual payment;
- when Kaspi confirms receipt/payment, the operator confirms the remaining debt;
- this creates a normal factual payment with method `КАСПИ МАГАЗИН`;
- it does not mark the order shipped/received and does not mutate shipping status.

Kaspi commission is intentionally out of scope.

## Schema foundation

Migration:
- `migrations/0082_v72_kaspi_order_payment_method.sql`

Adds:
- `orders.order_payment_method TEXT`
- `idx_orders_order_payment_method_status_date`

Historical backfill is conservative:
- only orders with at least one positive factual `КАСПИ МАГАЗИН` payment,
- and no positive payment through another method,
- are automatically marked as Kaspi.
- delivery is never used for recovery.

This means old unpaid Kaspi orders with no positive factual Kaspi payment remain unclassified. That is intentional: a ZAMMLER delivery alone is not sufficient evidence.

Branch2-only migration workflow:
- `.github/workflows/kaspi-order-separation-branch2-migration-0082.yml`
- hard-locks `orders-app-branch2`
- hard-locks `orders_db_branch2` / `40065052-854e-44b8-bcd5-251bdd488301`
- explicitly rejects Production D1 identity
- checks whether the column already exists, making workflow reruns safe
- reconciles the conservative historical backfill and index
- verifies column, index and missing-backfill count.

Evidence:
- PR #295 merged as `a06775de48815fc72e3350fcd7c3960f5ec69ab5`
- migration run `37476926066`: success
- Branch2 safety `37476925892`: success
- Cloudflare monitor `37476925899`: success

## Runtime/UI

Dedicated sidebar workspace: `Kaspi`.

Views:
- `Ожидают оплату`: current Kaspi orders with debt > 0
- `Оплачены`: Kaspi orders with debt <= 0
- `Все Kaspi`

The Kaspi workspace has its own search/date filter state. Its default date range is empty so an unpaid order from a prior month cannot silently fall out of the work queue.

Ordinary Orders is strictly separated server-side with:

```
excludeOrderPaymentMethod=КАСПИ МАГАЗИН
```

This exclusion also applies during ordinary-order search. The ordinary table therefore does not become a mixed Kaspi/non-Kaspi work surface.

Dedicated Kaspi Create:
- reuses the normal Create flow;
- order payment identity = `КАСПИ МАГАЗИН`;
- first payment row is a zero-value non-financial placeholder until real money exists;
- recommended delivery = `ЗАММЛЕР`, still editable.

Ordinary Create:
- can also create a Kaspi order;
- choosing `КАСПИ МАГАЗИН` sets the persisted order payment identity;
- if delivery is still blank, ZAMMLER is suggested/defaulted;
- after save, the UI routes to the Kaspi workspace.

Editor exposes the order-level payment method so a historical or mistakenly classified order can be explicitly corrected without guessing from delivery.

## Payment confirmation

`Оплата получена`:
- uses the current persisted debt amount;
- POSTs through the existing canonical `/api/payments` endpoint;
- method = `КАСПИ МАГАЗИН`;
- payment kind = `debt_close`;
- uses the existing idempotency request mechanism;
- does not call shipping actions and does not alter shipping status.

Finance therefore receives the same factual payment event as ordinary debt closure; there is no second Kaspi money ledger.

## Return / Exchange / cancellation

No parallel Kaspi implementation exists. Existing Return, Exchange and cancellation logic remains authoritative.

This is deliberate:
- item quantities and physical return truth remain in the existing domains;
- payment/refund methods continue to be factual financial events;
- Kaspi classification only decides the operational workspace.

## Regression / release evidence

Feature branch final exact-head Quality:
- `37477447234` — success, cumulative release gate + build.

Feature PR:
- #294
- merged to Branch2 as `c07fd63439b6cb38e857ce3e6adb849d44f0a5b9`

Exact merged SHA:
- Branch2 safety `37477946140` — success
- Cloudflare deploy `37477946304` — success

The feature has explicit regressions for:
- authoritative order payment identity;
- zero-value payment rows remaining non-financial;
- create/edit/read persistence;
- exact include/exclude list filters;
- dedicated/ordinary Create classification;
- ZAMMLER remaining editable and non-authoritative;
- strict ordinary/Kaspi list separation;
- independent Kaspi filters with no monthly default cutoff;
- payment confirmation through canonical idempotent payment path;
- no shipping mutation from payment confirmation;
- lazy-loading / D1 read-budget preservation;
- old Return/Exchange/frontend/Worker preservation layers.

## Manual acceptance checklist

1. Open Branch2 → Kaspi.
2. Create from `+ Новый Kaspi-заказ`.
   - payment identity should already be `КАСПИ МАГАЗИН`;
   - ZAMMLER should be proposed but editable;
   - save with 0 factual payment;
   - order must appear under `Ожидают оплату`.
3. Create a second Kaspi order from ordinary Create by selecting `КАСПИ МАГАЗИН`.
   - it must route into Kaspi after save;
   - it must not remain in ordinary Orders.
4. Search the same order from ordinary Orders.
   - it must remain excluded.
5. In Kaspi, confirm `Оплата получена`.
   - exact remaining debt should be paid through `КАСПИ МАГАЗИН`;
   - order should move to `Оплачены`;
   - shipping status must remain unchanged.
6. Check an old unpaid order from a prior month.
   - the Kaspi waiting queue must not hide it because of a default monthly filter.
7. Check Return and Exchange from a Kaspi order.
   - existing flows should open and preserve existing business semantics.
8. If an old unpaid historical Kaspi order is missing, inspect it in ordinary Orders and explicitly set the order payment method to `КАСПИ МАГАЗИН`; do not infer it from ZAMMLER alone.

## Next step

Do not promote to `main` until manual Branch2 acceptance is complete and the user explicitly authorizes Production promotion.
