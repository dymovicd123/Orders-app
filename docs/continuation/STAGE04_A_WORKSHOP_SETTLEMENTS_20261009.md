# Stage04-A — расчёты с Цехом: основа

Date: 2026-10-09. Branch: `branch2`. Source of truth: current GitHub branch.

## Confirmed client contract

Stage04 is simple payments for completed Workshop work, not a separate debt-accounting product.
A position marked "Готово в цехе" is normally physically present the same business day;
its charge belongs to that transition, not to a second manual invoice acceptance.
Each product is priced individually. Prices rarely change; editing individual prices is deferred.
All ordinary and Kaspi Workshop work is paid to the same Workshop, so there will be one separate
"Расчёты с Цехом" tab beside those two order channels.

A business debt exists only when actual payments do not cover completed work. Partial payments,
unpaid residue, and overpayments/advances need to remain legible without extra accounting UI.

## 04-A implemented scope

- `migrations/0083_v72_workshop_settlement_foundation.sql` is an additive, empty, append-only event table.
- One immutable event journal can hold completion amount snapshots, payments, opening balance,
  reversals and a future price adjustment. A missing price is NULL, not 0.
- `event_key` is unique; a second reversal of the same event is also rejected.
- Frozen item/title/quantity/unit cost fields can be attached when a completion is posted.
- No existing Workhop/Order/Payment rows are backfilled, recalculated or modified.
- Schema test executes migration twice in in-memory SQLite, proves constraints and old row integrity,
  and is executed by Branch2 safety workflow.

**04-A has no runtime/UI changes.** Applying the empty schema is handled by a single-purpose
Branch2-only workflow triggered when its own workflow file is first committed. It verifies
Branch2 identity, snapshots existing orders/payments/workshop metrics, applies 0083 if absent,
checks zero backfill and immutability triggers, and compares existing business data before/after.
If the workflow fails, 04-A must be treated as not activated until its logs are inspected.
Do not activate automatic charging until the Workshop price source/cutover procedure is confirmed.

## Next slice: 04-B

Connect the single and bulk `active -> done` paths to a single server-owned, atomic
completion + financial event operation. Return-to-work must write compensating events.
Never insert a zero-cost charge just because Catalog cost is unavailable. If the price
is unresolved, create a visibly pending-price completion fact; do not block operations
or invent money. Record source events with deterministic keys; do not trust UI-only dedupe.
Only after this can 04-C payments and 04-D the shared Workshop finance tab be activated.

No changes to `main`, `orders-app`, `orders_db_prod`, production migrations, or
historical row data are permitted without separate explicit approval.

## Stage04-B: server-owned Workshop completion capture

- Migration 0084 adds SQL status-transition hooks for both individual and bulk Workshop status updates.
- Captures only transitions into ready/done, never repeated writes or ready-to-done conversions.
- A subsequent active/cancelled transition produces an immutable compensating reversal linked to the completion event.
- Completion records freeze product, characteristics and quantity; cost and amount remain NULL pending a confirmed price. Null is never counted as zero-cost work.
- Kazakhstan business date uses the current UTC+05 day; technical timestamps remain UTC.
- Crucially, **capture is disabled by default**, even after deployment. A future deliberate cutover must explicitly activate it only after the price flow and user-visible UI are ready.
- Existing historical workshop statuses are not backfilled, and customer order/payments/inventory fields are not changed.
- 0084 applies only to isolated Branch2 D1 through a guarded workflow and read-only business fingerprints.
