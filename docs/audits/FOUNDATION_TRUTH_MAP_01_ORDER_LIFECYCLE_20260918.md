# Foundation truth map 01 — Order lifecycle — 2026-09-18

## Scope

Branch2 baseline: `fb43e8d709b57b67cc080bb9bd64246bb036aede`.

This is an architecture/read-model audit, not an implementation plan.

No Branch2/Production code or D1 data was changed.

The goal is to answer: **what facts does an order actually own, what facts are only projections from adjacent domains, and where does the UI currently collapse those dimensions into misleading whole-order states?**

---

## 1. The order row currently mixes at least six independent state dimensions

The `orders` record contains or exposes:

1. administrative lifecycle: `order_status = active | closed | archived | deleted`;
2. whole-order shipping marker: `shipping_status = not_sent | sent`, plus `shipping_date`;
3. coarse Workshop aggregate: `workshop_status = in_workshop | ready | shipped | cancelled`;
4. sale amount: `total_amount`;
5. cached financial aggregates: `received_amount`, `debt_amount`, `return_amount`;
6. current item composition through `order_items`.

Adjacent tables contain stronger facts:

- `payments`: individual incoming-money facts;
- `returns` / `return_items`: refund operations and physical return facts;
- `exchanges` / `exchange_items`: replacement history;
- `workshop_tasks`: per-item Workshop state;
- `inventory_reservations`: promised / fulfilled / released / unresolved stock obligations;
- `inventory_lifecycle_events`: canonical physical inbound/outbound effects for Return/Exchange.

The core architectural issue is not that these dimensions are separate. They **should** be separate.

The issue is that several UI/read paths treat one of them as if it were the whole order lifecycle.

---

## 2. `order_status` is administrative state, not operational fulfillment state

Initial schema defines:

`active | closed | archived | deleted`.

Current ordinary operational actions do not appear to derive this field from shipping, payment, Workshop or Return completion.

In the working UI:
- ordinary users do not edit `order_status`;
- Admin editor exposes a generic `Статус: Активен / Закрыт / Удалён` select;
- archive accepts only `closed` orders and then changes them to `archived`;
- restore from archive changes `archived` back to `closed`.

The shipping command does not close the order. A Return does not close it. Debt closure does not close it. Workshop task completion does not by itself turn `order_status` into `closed`.

Therefore `order_status` should currently be understood as an **administrative record-state / archive gate**, not the authoritative answer to “what is happening with this customer order?”.

### Risk

Because it is named and rendered simply as `Статус`, the field invites both code and people to treat it as the business lifecycle.

That is stronger semantics than the implementation actually guarantees.

### Audit direction

Do not remove it yet. First stop using it as a universal operational status.

---

## 3. `shipping_status` is a whole-order commercial marker, not complete physical truth

The current human-inventory model permits stock items to be physically issued **before** the whole order is marked sent.

The dedicated handover flow can fulfill specific reservations while the order remains `shipping_status = not_sent`, for example when Workshop items are still pending.

Final `/api/orders/:id/shipping`:
- blocks while Workshop is not ready;
- checks catalog/inventory blockers;
- fulfills remaining reservations;
- then commits `shipping_status = sent`.

Therefore:

- per-item physical handover truth lives in reservation/lifecycle state;
- `shipping_status` describes the whole-order shipping milestone.

This is a good separation, but the read model must preserve it.

### Consequence

A UI should not infer “no item has left us” merely from `not_sent`, nor infer all item-level history from `sent`.

---

## 4. `workshop_status` is a compatibility aggregate; per-item Workshop tasks are stronger truth

The original order schema gives every order a `workshop_status` default of `in_workshop`.

Current Workshop work is represented by `workshop_tasks`, including per-item linkage and statuses `active / ready / done / cancelled`.

Existing code already partly recognizes this:
- Orders table checks whether the order actually has Workshop items/tasks before treating Workshop as pending;
- exchange logic mutates exact Workshop tasks;
- Workshop status can be refreshed from tasks.

But the generic order editor still displays the coarse order-level `workshop_status`, including on orders without applicable Workshop work.

This means `workshop_status` is not safe as a standalone human fact.

### Direction

Treat it as compatibility/cache until proven otherwise; operational read-model should derive Workshop summary from actual tasks/items.

---

## 5. Financial columns are cached aggregates, not a single “payment state”

`readOrderFinancialLedger()` defines:

- `received_amount` = sum of positive payments;
- `return_amount` = sum of active Returns;
- `debt_amount` = max(0, total_amount - received_amount).

That model intentionally preserves gross incoming money and refunds separately.

A full refund can therefore correctly leave:

- `received_amount > 0`;
- `debt_amount = 0`;
- `return_amount = received_amount`.

Finance can derive net cash from these facts.

The Orders table currently renders:
- `Получено = received_amount`;
- payment label `Оплачено` when debt is zero and gross received is positive;
- no adjacent active-refund/net-retained value.

This is not a ledger corruption. It is an incomplete order read-model.

---

## 6. `return_amount > 0` is incorrectly promoted to whole-order lifecycle state

Current frontend helper:

`isReturnedOrderRecord(order) = return_amount > 0`.

The same condition drives:
- row styling;
- lifecycle label `Возвращён`;
- hiding Return / Exchange / Edit and other ordinary actions;
- filter semantics for “returned”.

But `return_amount` means only: **there is at least some active refunded amount**.

It does not say:
- whether the refund is full or partial;
- whether all order items were returned;
- whether any returned item physically arrived;
- whether it was restocked;
- whether some item remains with the customer;
- whether another remaining quantity is still eligible for Return/Exchange.

The Return backend itself explicitly tracks remaining item quantity and supports multiple operations.

### This is a confirmed foundation defect

A monetary aggregate is being used as a whole-order lifecycle/completion predicate.

That is exactly the “local fact promoted into human global state” failure we are testing for.

### Important implication

Fixing only the text `Возвращён` would be insufficient, because the same predicate also gates actions.

---

## 7. `order_items` is current composition, not a pure immutable purchase snapshot

Order-item fields include historical-looking snapshots and unit price, but Exchange mutates the active order composition:

- old `order_items.quantity` is reduced;
- its `line_total` is recalculated;
- new replacement item is inserted;
- `exchange_items` retains operation snapshots/history.

Therefore one table currently serves two related roles:

- historical sale-line data;
- current post-exchange active composition.

The system compensates by preserving exchange history separately.

This is not necessarily wrong, but future pricing/cost/profitability code must not assume that current `order_items` alone equals “what was originally sold”.

### Future constraint

Any profitability/history design needs explicit distinction between:
- original/historical commercial event;
- current active order composition;
- Return/Exchange deltas.

Do not compute lifetime product history only from current `order_items`.

---

## 8. Archive state is relatively well bounded but depends on a weak “closed” gate

Archive is explicitly read-only historical mode and keeps rows for reports/history.

Eligibility checks:
- `order_status = closed`;
- no debt;
- no active/ready Workshop tasks;
- normally sent.

This is safer than using archive as deletion.

However, because `closed` itself is not clearly derived from an operational lifecycle, archive depends on an administrative prerequisite whose meaning is not strongly defined.

This does not make archive unsafe by itself, but it means “closed” should be clarified before relying on it for more business rules.

---

## 9. Strong mechanisms to preserve

The audit does **not** support rewriting the Order backend wholesale.

Preserve:

- item-level reservations separate from physical quantity;
- early item handover without falsely marking whole order sent;
- dedicated final shipping command;
- safe correction of mistaken shipping;
- idempotent critical operations;
- separate payments / refunds;
- explicit Return/Exchange history;
- physical Return receipt separate from financial refund;
- archive as logical history rather than hard deletion;
- safety blocks around editing/deleting orders with active Return/Exchange operations.

These mechanisms are stronger than the current UI projection around them.

---

## 10. Proposed conceptual order read-model — for analysis, not implementation yet

The current Orders table should eventually consume a deliberate projection rather than infer meaning ad hoc from raw columns.

A candidate projection should answer independent human questions, for example:

### Commercial record
- active / administratively closed / archived / deleted.

### Fulfillment
- nothing issued;
- partially issued;
- fully sent/handed over;
- physical correction required.

### Workshop
- not applicable;
- waiting;
- ready;
- done.

### Money
- sale total;
- gross received;
- refunded;
- net retained;
- still owed.

### Returns / exchanges
- no active operation;
- partial refund/return;
- return item still expected physically;
- physically received and restocked;
- received without restock;
- exchange in progress/current replacement.

### Inventory identity
- all lines resolved;
- one or more lines need product/SKU clarification.

The exact labels are not approved. The point is structural: **these dimensions should be composed once and reused**, rather than each screen inventing its own lifecycle predicate.

---

## 11. Strongest conclusion from Order slice

The foundation hypothesis is now more specific:

> The main technical weakness is not that the system lacks state. It often has enough state. The weakness is the lack of an explicit domain projection layer that turns independent authoritative facts into one reusable operational read-model.

For Orders, this is directly evidenced by:

- `return_amount > 0` becoming whole-order “returned” state;
- `received_amount/debt_amount` becoming “paid” without refund context;
- `workshop_status` surviving beside stronger per-task truth;
- `shipping_status` being meaningful only as a whole-order milestone while item handover has its own truth.

This explains why different screens can each be technically correct and still feel inconsistent.

---

## 12. Next slice

Next: **Product identity / canonical SKU / historical snapshots / assortment state**.

Questions:
- what is authoritative current product identity?
- what is intentionally immutable historical wording?
- when may resolver update linkage versus snapshots?
- which screens should show historical input, canonical current identity, or both?
- how should active/retired assortment behave without deleting history?
- where will future default sale price/cost belong without corrupting order history?

Stop before Stock/Reservations if Product Identity becomes a large block.
