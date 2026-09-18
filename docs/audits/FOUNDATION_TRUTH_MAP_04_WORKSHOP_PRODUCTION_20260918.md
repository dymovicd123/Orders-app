# Foundation truth map 04 — Workshop lifecycle / production boundary — 2026-09-18

## Scope

Branch2 baseline rechecked before this block: `fb43e8d709b57b67cc080bb9bd64246bb036aede`.

Audit branch baseline before this block: `851f1d2871c669ca8d200f3db1186021d84483cd`.

This is a source-of-truth / workflow audit. No Branch2 or Production D1 data was changed.

Questions for this slice:
- What is the real per-item Workshop lifecycle?
- What does `Готово` mean today?
- Does Workshop completion mean physical warehouse receipt?
- Which state actually blocks shipping?
- What is the relationship between `workshop_tasks.status` and `orders.workshop_status`?
- What does the current “Накладная” represent?
- Where should future production cost/payable history attach?

---

## 1. The real Workshop work unit is a task tied to an order item

For a Workshop order line, order creation writes:
- the historical order line into `order_items`;
- `is_workshop = 1`;
- `stock_writeoff_status = 'workshop'`;
- one `workshop_tasks` row linked to that `order_item_id`.

The task stores workflow facts:
- quantity;
- comment;
- urgency;
- due date;
- status;
- created/updated timestamps.

The normal current task states are:
- `active`;
- `ready`;
- `done`;
- `cancelled`.

The order read path derives each Workshop item's visible status from the linked task.

Direct `order_item_id` linkage wins. Legacy unlinked rows use a constrained matching fallback. The matching code explicitly avoids borrowing one linked task's status for another similar-looking order line.

### Conclusion

The strongest existing Workshop workflow truth is **per order item / per Workshop task**, not the coarse order-level Workshop field.

This is a good foundation and should be preserved.

---

## 2. Product/history ownership in Workshop is already separated reasonably well

The current Workshop read path explicitly treats:

- `workshop_tasks` as the workflow/status source;
- linked `order_items` as the product-characteristic/history source.

That is an important distinction.

Workshop tasks do not need to become a second complete copy of current product master data.

For historical order work, the original order line remains the correct descriptive record.

---

## 3. Workshop order creation intentionally resolves only the base product

For a normal warehouse/boutique line, order creation tries to resolve an exact canonical variant.

For a Workshop line, `resolveWorkshopCatalogProductOnly()` only resolves the base product and deliberately returns no exact `variant_id`.

Therefore a Workshop task may legitimately mean:

> make this order-specific item for this customer

without first requiring that an exact sellable warehouse SKU already exists.

This is sensible for made-to-order work.

### Important consequence

Do not force exact SKU creation merely because the line goes to Workshop.

Exact SKU identity becomes mandatory only when a later operation genuinely needs stock identity, for example when a returned Workshop-made item is physically accepted into warehouse stock.

---

## 4. “Готово” currently means only “Workshop work is no longer active”

The main Workshop UI action:

`Готово`

PATCHes the task to `status = 'done'`.

The server then:
- validates/repairs the task ↔ order-item link;
- changes task status;
- repairs Workshop flags on the linked order item if needed;
- refreshes the coarse order Workshop summary.

It does **not**:
- add inventory;
- create an inventory movement;
- create an inventory lifecycle inbound;
- mark a warehouse receipt;
- create a production-cost record;
- create a payable/debt to Workshop;
- create a supplier/production invoice.

### This is not automatically a defect

The current flow allows a made-to-order Workshop item to go from production readiness directly toward customer handover/shipping.

Automatically adding every completed Workshop item into warehouse stock would be wrong for that direct flow and could double-count physical goods.

So the correct invariant is:

> **Production completion is not the same event as warehouse receipt.**

Keep those events separate.

---

## 5. Shipping semantics confirm the direct-to-customer interpretation

The shipping blocker checks:
- whether the order contains Workshop items;
- whether any linked Workshop tasks are still `active`;
- and the coarse order Workshop status as a compatibility/summary signal.

Once Workshop work is no longer active, the Workshop part no longer blocks customer handover.

For a Workshop-only order there may be no warehouse reservations at all. The shipping fulfillment path explicitly supports that case and can still mark the order as sent.

Therefore the existing business interpretation is approximately:

`Workshop task → produced/ready → customer handover`

without an obligatory intermediate:

`Workshop → warehouse stock`.

That behavior should not be accidentally destroyed by future inventory/cost work.

---

## 6. Return/Exchange correctly treats physical receipt as a separate later event

If a Workshop-made item later returns from the customer, Return/Exchange does not assume it already belongs to warehouse stock.

The return flow can record:
- not physically received yet;
- physically received into Warehouse;
- received with no return to sellable stock.

Workshop-returned goods are intentionally not allowed into Boutique.

When a physical stock destination is selected, the system creates an inventory lifecycle inbound event.

If exact canonical identity is known and physical freshness rules allow it, the stock event can be applied.

Otherwise it remains pending for resolution.

### Conclusion

The system already has a strong conceptual separation:

`Workshop completion` ≠ `physical return/receipt into stock`.

Preserve it.

---

## 7. The coarse order-level Workshop status is a second, lossy lifecycle representation

There is also:

`orders.workshop_status`

with states:

- `in_workshop`;
- `ready`;
- `shipped`;
- `cancelled`.

This is separate from task status.

`refreshOrderWorkshopStatusFromTasks()` derives only:

- any active task → `in_workshop`;
- no active task → `ready`.

It does not preserve whether all non-active tasks are:
- `done`;
- `ready`;
- `cancelled`;
- or some mixture.

So several distinct per-item realities collapse into one order-level value.

### Worse: it is not purely derived

The admin order editor exposes `orders.workshop_status` directly as an editable field.

Therefore the field is simultaneously:
- sometimes derived from tasks;
- sometimes independently mutated as order lifecycle data.

This is duplicated ownership.

The shipping blocker is defensive enough that simply setting the coarse field cannot bypass still-active Workshop tasks. That is good.

But contradictory display/state remains possible.

### Direction

Long-term, order-level Workshop state should be a **derived summary/read projection** from task truth wherever possible.

Compatibility migration may still require storing the field temporarily, but it should stop being an independent authority.

---

## 8. Every new order currently starts with coarse Workshop status “in_workshop”

`createEmptyOrderDraft()` defaults:

`workshopStatus = 'in_workshop'`.

That value is submitted and persisted even when the order contains no Workshop lines.

The shipping blocker works around this by requiring actual Workshop item count before the coarse status alone can block shipping.

This is a clear example of legacy field overreach:

> the system stores a Workshop lifecycle state on orders that may have no Workshop work at all.

The defensive blocker prevents a worse operational failure, but the model remains semantically noisy.

---

## 9. Legacy columns suggest an abandoned physical-intake model

The original `orders` schema also contains:

- `ready_at`;
- `warehouse_received_at`.

Current domain code inspected in this audit does not use these fields.

They look like remnants of an older design where order-level Workshop readiness and warehouse receipt were expected to be first-class order states.

Do not revive them just because their names look useful.

Any future production-completion / warehouse-receipt model should be defined from current business events, then migrated deliberately.

---

## 10. The current “Накладная цеха” is not a financial invoice

The current Workshop “Накладная” is generated from **active Workshop tasks**.

It contains:
- product;
- characteristics;
- quantity;
- urgency;
- comment;
- order reference;
- due date.

The UI groups ordinary identical positions and keeps urgent/commented orders separate.

There is no:
- unit production cost;
- amount owed;
- payment status;
- payable document ID;
- accepted/completed quantity;
- accounting posting.

Its effective purpose is:

> **production request / work sheet for what the Workshop should make.**

That is useful.

But it is a different business object from the client's future request:

> how much do we owe the Workshop for goods produced / accepted?

### Naming warning

Even if employees naturally call the current sheet “накладная”, the domain must distinguish:

1. production instruction/work sheet;
2. production completion/acceptance;
3. financial payable/invoice.

Otherwise future finance code will infer money from a document that describes requested work rather than completed work.

---

## 11. Production completion currently has no immutable domain event

`workshop_tasks` has:
- `created_at`;
- `updated_at`.

It has no dedicated:
- `done_at`;
- completion event ID;
- completed quantity history;
- cost snapshot;
- reversal link.

If a task is:

`active → done → active → done`

the mutable task row ends in `done` and `updated_at` points to the latest mutation.

Activity Log records status changes, but it is a generic audit log, not the canonical production ledger.

### This becomes a real blocker for future cost/payable accounting

We cannot safely interpret:

`workshop_tasks.updated_at`

as:

> this quantity was produced at this time and carried this cost.

A future accounting model needs a durable production-completion fact.

---

## 12. “Вернуть” must not erase completed production history once cost/payable exists

Today, `Вернуть` simply changes the task back to `active`.

For current workflow status that is acceptable.

Once production completion creates cost/payable history, reopening cannot mean “pretend the previous completion never happened.”

The future event model must support explicit reversal/supersession.

For example conceptually:

`production_completed`

then if the completion was mistaken:

`production_completion_reversed`

rather than deleting the original historical fact.

Exact schema is intentionally not chosen in this audit.

---

## 13. The correct future boundaries are four separate facts

The audit now gives a clean separation.

### A. Work instruction

“What should Workshop make?”

Current `workshop_tasks` + current production sheet already serve this reasonably well.

### B. Production completion

“What quantity did Workshop actually finish, and when?”

Current mutable status is too weak for future accounting history.

Needs a durable event/snapshot if cost/payable reporting is added.

### C. Physical stock receipt

“Did this produced item physically enter sellable warehouse stock?”

Must remain a separate event.

For direct customer orders the answer can legitimately be **no**.

### D. Financial liability/payable

“When and for what amount do we owe Workshop?”

This is an accounting rule.

The code cannot determine whether the client considers the liability created:
- when Workshop marks work complete;
- when someone accepts it;
- when a grouped document is issued;
- on some other agreed business boundary.

That business rule must be confirmed before implementation.

---

## 14. Cost should be snapshotted at the production/accounting boundary, not inferred later

Future product master data may provide a default Workshop cost.

That default can help create new production facts.

But historical profitability must not later be recalculated from a mutable current cost.

If cost changes from 5,000 to 5,500 next month, an item produced today must retain the cost that applied to its production/accounting event.

So eventual architecture should distinguish:

- current/default production cost on master data;
- historical cost snapshot on the actual production/completion/payable event.

This follows the same snapshot-vs-current principle already identified for prices.

---

## 15. Exact SKU and cost granularity must not be conflated

Workshop items intentionally may not have `variant_id` at order creation.

The future business decision is therefore:

> At what level does Workshop production cost vary?

Possible real-world answers include:
- base product only;
- product + material/length execution;
- exact size/color SKU;
- custom/exception cost.

The current code does not answer that business question.

Do not solve finance by forcing arbitrary exact variant identity onto every Workshop line.

Cost ownership should reflect the client's actual pricing rule.

---

## 16. Workshop Return/Exchange safety should be preserved

Existing Workshop-aware Return/Exchange code already handles difficult cases:

- returned Workshop goods cannot silently become Boutique stock;
- physical receipt can remain pending;
- exact SKU can be resolved later;
- later physical counts can supersede stale inbound assumptions;
- return can reduce/cancel an active Workshop task;
- cancelling a return restores Workshop task quantity/status from saved reversal snapshots;
- exchange replacement can create/reuse the exact Workshop task for the replacement order item.

These mechanics are valuable and should not be replaced by a simpler but lossy “whole order Workshop status” model.

---

## 17. Confirmed root defects / weaknesses from this slice

### W-ROOT-01 — task truth and order-level Workshop status both own lifecycle

Per-item task status is the stronger operational truth, while `orders.workshop_status` is also independently editable and only partially derived.

### W-ROOT-02 — all orders default to coarse “in_workshop”

Orders with no Workshop items can still carry an `in_workshop` status. Other code has to compensate for that ambiguity.

### W-ROOT-03 — order-level summary collapses distinct task outcomes

Any state with no active tasks becomes `ready`, including mixtures that may contain done/ready/cancelled tasks.

### W-ROOT-04 — no immutable production-completion fact

Mutable task status + `updated_at` is insufficient for trustworthy future cost, payable and production-history reporting.

### W-ROOT-05 — current “Накладная” and future financial invoice are different business objects

The current document describes active requested work, not completed financial liability.

### W-ROOT-06 — dead/legacy order-level physical fields remain in schema

`ready_at` and `warehouse_received_at` exist but are not current domain truth.

### W-ROOT-07 — Workshop lifecycle is partly exposed through old order-level controls

The admin order editor can mutate coarse Workshop status independently of task rows, increasing the chance of contradictory presentation.

---

## 18. What is NOT a defect

These distinctions matter because a careless simplification could break good behavior.

Not defects:
- Workshop item may have no exact variant at order creation.
- `Готово` does not automatically increase warehouse stock.
- Workshop-only customer handover may have no warehouse reservation.
- returned Workshop goods require a separate physical decision.
- task state is per order item rather than one status for the whole order.
- production sheet can group ordinary active tasks for convenience.

Those are useful domain behaviors.

---

## 19. Suggested target contract for later implementation planning

Not a schema commitment; this is the conceptual boundary.

```
order_item
  └─ workshop_task              // current work request/state
       ├─ production completion event(s)  // immutable historical fact
       └─ optional completion reversal

production completion
  ├─ historical quantity
  ├─ completed_at
  ├─ cost snapshot / cost basis when business rule is defined
  └─ payable linkage when/if liability is created

physical stock receipt
  └─ separate inventory lifecycle event only when goods actually enter stock

Workshop payable/invoice
  └─ separate financial document/ledger built from the agreed completed/accepted facts
```

The order-level Workshop summary should eventually be derived from task state rather than remain an independent business command.

---

## 20. Strongest conclusion after Order + Product + Stock + Workshop

The same systemic pattern now repeats again.

The project often has the correct low-level facts:
- order item;
- Workshop task;
- inventory lifecycle;
- physical check;
- reservation;
- money event.

But an older broad field or UI surface then overlays them:
- `orders.return_amount` used as lifecycle;
- snapshots used as current product identity;
- reserved cache used beside reservation ledger;
- `orders.workshop_status` used beside per-item Workshop tasks;
- “Накладная” label spanning a work document while future requirements call for a financial document.

So the main repair direction remains:

> **Keep the strong event/detail machinery, remove competing ownership, and build one explicit operational projection per human question.**

That is much smaller and safer than a total rewrite.

---

## 21. Next slice

Next: **Money / Finance source of truth**.

Questions:
- Which table/event is authoritative for received money, refunds and net cash?
- Which order totals are historical facts versus recomputable aggregates/cache?
- Where do payment rows and `financial_events` overlap?
- What should “выручка”, “получено”, “долг”, “возврат”, “чистые деньги” and future “прибыль” each mean?
- Can current per-item revenue support product profitability, or is revenue only reliable at order level?
- Where should default selling price and auto-pricing attach?
- How should historical price snapshots behave?
- How should future Workshop production cost/payable events enter Finance without corrupting order revenue?
- Which current reports use incompatible interpretations of the same money?

After the Money/Finance slice, stop, save the audit document, update continuation context and report before moving to report/UI redesign.
