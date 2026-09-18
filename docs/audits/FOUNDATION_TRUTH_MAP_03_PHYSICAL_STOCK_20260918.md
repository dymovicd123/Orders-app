# Foundation truth map 03 — Physical stock / reservations / lifecycle / stocktake — 2026-09-18

## Scope

Branch2 baseline rechecked before this block: `fb43e8d709b57b67cc080bb9bd64246bb036aede`.

Audit branch before this block: `18cd3dd4727d5a04ba6e8eff096ce7de57c8faaf`.

This is a source-of-truth / workflow audit, not an implementation plan.

No Branch2 or Production D1 data was changed.

Questions for this slice:
- What is authoritative for physical quantity?
- What is authoritative for reserved/promised quantity?
- What is history versus current state?
- Which physical observations supersede older events?
- Why can the current Остатки screen feel strange even when arithmetic is mostly correct?
- How do Return/Exchange and future cost/profitability fit this model?

---

## 1. Physical quantity has a clear current authority

Human Inventory V2 deliberately separates physical stock from promises to orders.

For a canonical source + SKU:

`inventory_stock.quantity`

is the current physical on-hand quantity.

This is the operational current state. It is mutated by:
- arrivals;
- physical handover/shipping;
- transfers;
- Return/Exchange physical lifecycle;
- write-offs/manual corrections;
- quick physical checks;
- completed stocktakes;
- safe reversals/corrections.

`inventory_movements` is not the current quantity authority. It is event/audit history around changes.

This is a good foundation and should be preserved.

### Human read

For ordinary users the primary stock numbers are correctly conceptualized as:

`physical = on hand`

not “movement balance reconstructed by the frontend”.

---

## 2. Reservations have two representations, but only one should be conceptual authority

The durable business obligation is represented by `inventory_reservations`.

A reservation belongs to an order item and has a lifecycle such as:

- `active`;
- `fulfilled`;
- `released`;
- `unresolved`.

That row answers the business question:

> Which order currently claims this SKU, where, and how many?

However, `inventory_stock.reserved_quantity` stores an aggregate copy for fast reads.

Normal write paths generally keep them synchronized atomically:
- reserve order item;
- release order item;
- fulfill reservation;
- Exchange transition;
- correction of mistaken handover.

This is sensible as an optimization.

### Source-of-truth classification

- **authoritative obligation ledger:** active `inventory_reservations`;
- **derived/cache:** `inventory_stock.reserved_quantity`;
- **derived free quantity:** `inventory_stock.quantity - reserved`.

The code does not currently express this hierarchy consistently in reads.

---

## 3. Different warehouse surfaces read different reservation truth

This is a concrete read-model weakness.

### Ordinary Остатки

`listInventory()` reads:

`inventory_stock.reserved_quantity`

and calculates:

`available = quantity - reserved_quantity`.

The main warehouse overview then uses these cached figures for:
- `Свободно`;
- `На месте`;
- `В заказах`;
- product totals;
- filters;
- warning state.

### Reservation detail

Opening the stock detail loads actual active rows from `inventory_reservations`.

### Warehouse attention

Shortage detection explicitly computes:

`SUM(inventory_reservations.quantity WHERE status = active)`

instead of trusting `inventory_stock.reserved_quantity`.

### Consequence

Three surfaces conceptually ask the same question “how much is reserved?”, but:
- summary/browse uses the cache;
- detail list uses ledger rows;
- attention recomputes ledger total.

Normal write code tries hard to keep them equal, but the read contract itself permits a split.

This matches the wider foundation diagnosis: two representations exist, yet no explicit projection layer declares one authoritative and verifies/rebuilds the other.

### Direction for later plan

Do not delete the cache blindly. It may be valuable for D1 read cost.

But it must be treated as a cache:
- recomputable from active reservation rows;
- auditable for drift;
- never a competing source of business truth.

---

## 4. A newer physical count is intentionally stronger than an older operational event

The stock subsystem already contains a strong and important precedence rule.

`inventory_stock_checks` records physical observations, including checks where quantity did not change.

Examples:
- quick count;
- cycle count;
- order/shipping observation;
- completed full/selective stocktake.

Return/Exchange lifecycle cancellation and mistaken-handover correction both inspect later checks before trying to “undo” physical stock.

If a newer physical count exists, older logical reversal is prevented from rewriting that newer physical reality.

This is the correct direction:

> later direct physical observation outranks an inferred reverse of an older business event.

Preserve this invariant.

---

## 5. Full stocktake is one of the strongest write-side mechanisms in the project

A stocktake session preserves:
- opening quantity;
- opening reserved quantity;
- accepted baseline;
- human counted quantity;
- conflict/recount state;
- applied quantity.

If stock changes after the baseline:
- the row is not silently overwritten;
- it becomes `recount_required`;
- baseline is refreshed;
- user recounts only the affected position.

Completion uses a transaction-level consistency guard.

Only when all accepted baselines still match does the batch:
- set physical stock to counted values;
- append movement history for changed quantities;
- record `inventory_stock_checks` for counted canonical rows;
- mark stocktake items applied;
- resolve/supersede certain stale inbound lifecycle tasks;
- mark the session completed.

If the lock cannot be acquired, the revision is not half-applied.

### Conclusion

Do not redesign Revision from scratch.

The user's earlier feeling that “Ревизия норм” is supported by the code architecture.

---

## 6. Pending inbound lifecycle correctly respects physical truth

Return/Exchange/Workshop inbound can exist as a pending `inventory_lifecycle_event`.

For deferred inbound, the system checks:
1. whether a later exact physical check already exists;
2. whether a trusted completed full stocktake provides a physical boundary;
3. whether an active/full stocktake overlaps the event.

Possible outcomes:
- apply the inbound;
- supersede it without adding stock again;
- hold it for human resolution.

This avoids the dangerous pattern:

> old pending Return + later physical count → later resolver blindly adds the Return one more time.

This is strong architecture and should be preserved.

---

## 7. Physical existence is allowed to be true before catalog identity is known

The warehouse can hold an unresolved positive physical row with no `variant_id`, for example goods found during stocktake.

Warehouse attention exposes those rows for later reconciliation.

This is conceptually important.

The system does not force:

> “if the catalog does not know what it is, the physical item cannot exist”.

Instead it can represent:

> “we physically have this; exact canonical identity still needs resolution”.

This is the correct separation of physical truth from catalog truth.

---

## 8. Confirmed contradiction: retired stock remains visible but can disappear from a “full” stocktake

Ordinary `listInventory()` deliberately includes an inactive product/variant when it still has:
- nonzero physical quantity; or
- nonzero reserved quantity.

That means retirement does not erase a real physical holding.

However, `createInventoryStocktakeSession()` includes canonical rows only when:
- variant is active; and
- product is active,

even if the inactive row has physical/reserved quantity.

Therefore the same retired SKU can be:

- visible in Остатки because it physically exists;
- excluded from a newly created full stocktake because the catalog entity is inactive.

### This is a genuine cross-domain truth defect

A full physical count cannot equate:

`inactive catalog` = `physically irrelevant`.

This becomes especially important with the client's request to remove stale assortment while preserving history.

If a retired product still physically exists, the system must continue to count/reconcile it until the physical quantity is dispositioned.

### Implication for assortment retirement

Retirement policy and physical-stock policy must be independent dimensions.

This is also evidence that one Boolean `is_active` is being asked to carry too much meaning.

---

## 9. Confirmed ownership weakness: Arrival can create catalog master data through a separate implementation

Unknown/new physical arrival goes through `resolveInventoryCreatableItemsBulk()`.

That function can directly create:
- `catalog_products`;
- `catalog_stock_positions`;
- `catalog_variants`.

This is not merely “record the received quantity”; it can create canonical master data.

The Catalog/Resolver path has its own stricter vocabulary/reference/alias validation logic.

The Arrival creation path is a separate implementation and does not use the same complete reference-value validation contract.

### Why this matters

The system currently has more than one writer for canonical catalog identity:

1. Catalog / Resolver master-data path;
2. Warehouse Arrival master-data path.

Even if both usually produce valid rows, duplicated master-data creation authority is exactly the kind of structure that creates future divergence.

For example:
- spelling/value normalization may differ;
- reference dictionaries can be bypassed;
- future price/cost onboarding could be implemented in one path but omitted in the other;
- retirement/reactivation behavior can differ.

### Root-level conclusion

Canonical catalog creation needs one shared domain command/contract, with multiple UI entry points allowed.

Do **not** solve this by forcing warehouse users to visit another screen. The warehouse can still create a new item during Arrival; the backend master-data mutation should simply be shared.

---

## 10. Manual/physical operations have useful safety properties

`applyInventoryMovement()` contains several good guards:

- idempotent request fingerprint for manual operations;
- duplicate canonical rows in one request are collapsed before write;
- manual-set/writeoff use existing identity and compare expected current quantity;
- physical observation can be supplied explicitly;
- concurrent/stale UI quantity is rejected;
- one bulk operation is applied through bounded transactional batches.

Shipping has similar strong behavior:
- unresolved reservation prevents partial fulfillment;
- canonical variant identity is reloaded;
- optional physical observation is checked against current quantity;
- shipping never invents negative physical quantity;
- the observation is written into physical-check history.

These should survive any warehouse UI simplification.

---

## 11. Negative “free” stock and negative physical stock mean different things

Current system can expose:

- physical < 0 — an invalid/legacy/integrity condition requiring a count;
- free < 0 while physical >= 0 — active reservations exceed physical stock.

The warehouse UI partly distinguishes them:
- physical negative → “Нужна сверка”;
- free negative → “Не хватает ... для принятых заказов”.

That distinction is correct.

A future read-model should preserve it rather than collapse both into “нет товара”.

---

## 12. Why the current Остатки screen can feel strange even though the numbers are meaningful

The feeling is not explained by one obvious bad button.

The screen currently combines **three different jobs**.

### A. Browse / assortment question

User wants answers like:
- what products are here?
- what colors?
- what sizes?
- how many are free?

### B. Order-allocation explanation

It also explains:
- physical;
- reserved;
- free;
- which orders hold the reservations.

### C. Inventory-control workbench

The same surface also exposes:
- quick physical count;
- routine cycle-count prompt;
- discrepancy warnings;
- history;
- pathways into integrity correction.

Each capability is defensible individually.

Together they make “посмотреть остатки” feel like an accounting/control console rather than a calm merchandise browser.

This is a projection problem, not evidence that the inventory engine is bad.

---

## 13. The hierarchy still exposes catalog implementation before the owner's business dimensions

For a multi-variant product the current hierarchy is approximately:

`Product → Исполнение(material + length) → Color → Category/Gender → Size`.

This mirrors canonical identity structure.

But the client explicitly thinks in terms such as:

`Product → Color → Size → quantity / sales / returns`.

The word and level `Исполнение` is especially telling: it is useful internally for canonical identity, but it is not obviously a first-order stock-browsing concept for the client.

### Important distinction

Execution should remain in the domain model.

It does **not** follow that execution must be the first navigation level in the ordinary warehouse read-model.

If one product really has materially different executions that must never be combined, the UI can still surface material/length context where needed without making the user navigate the catalog implementation tree first.

---

## 14. Current grouping also carries a legacy identity workaround

`buildInventoryStockGroups()` groups visible stock partly by a normalized product-name identity rather than only `product_id`, because old imports may contain duplicate product IDs for spelling/hyphen variants.

This was a pragmatic compatibility fix.

But it also means the frontend is still repairing identity presentation locally.

After canonical product cleanup/read-model work, ordinary warehouse grouping should ideally consume a server/domain projection keyed by stable canonical identity, not reinvent catalog identity in React.

This is another small example of business projection living in the UI.

---

## 15. What a future operational stock read-model should answer

This is not the final redesign, only the contract suggested by the audit.

At minimum, for a canonical SKU and location it should expose one coherent answer:

- current canonical product/SKU identity;
- physical on-hand;
- active reserved quantity derived/verified from obligations;
- free quantity;
- catalog/assortment state;
- whether physical truth needs attention;
- optional compact reason behind reservation/shortage.

For product-level browse it should aggregate those SKU rows into the owner's useful hierarchy, probably emphasizing color/size.

The read-model should hide:
- lifecycle event IDs;
- reservation implementation;
- stocktake baselines;
- canonical execution terminology,

unless the user enters a correction/history workflow.

---

## 16. Return/Exchange consequences for future inventory value

The Return audit and this Stock audit line up cleanly.

A financial refund does not imply physical stock has returned.

Future inventory valuation must therefore change only when the physical disposition changes.

Examples:

### Refund completed, item still travelling

- financial net decreases;
- physical quantity does not increase;
- inventory value must not increase.

### Item arrives and is restocked

- physical quantity increases;
- inventory value may return, according to the historical cost of that unit/batch.

### Item arrives but `no_stock`

- physical receipt fact is recorded;
- sellable physical stock does not increase;
- inventory value should not be restored as sellable stock.

This must remain separate from Return money calculations.

---

## 17. Future cost/value introduces a fact the current flat stock row cannot fully answer by itself

Current `inventory_stock` knows quantity, not cost layers.

If every unit of a canonical product/execution always has one stable cost, product/execution default cost may be enough for a simple current valuation.

But if cost changes by production batch/time, a current quantity of 10 units does not tell us which historical costs those 10 units carry.

Therefore client requirements such as:

> “сколько тенге заморожено в товаре”

cannot safely be implemented by:

`current quantity × today's cost`

unless the business explicitly accepts that approximation.

The future model needs the business rule first:
- stable standard cost;
- weighted average;
- FIFO/lot tracking;
- another agreed method.

Do not choose one silently.

### However, one invariant is already clear

When Workshop/Arrival creates physical goods, the cost used for historical profitability/payables must be captured at that production/receipt event rather than inferred later from a mutable current default.

---

## 18. Strong mechanisms to preserve

- `inventory_stock.quantity` as current physical count;
- durable per-order-item reservations;
- separation of physical and reserved quantity;
- idempotent manual inventory operations;
- stale expected-quantity checks;
- explicit physical-check history;
- stocktake baseline/recount conflict handling;
- transaction-safe stocktake completion;
- later physical observation outranking older lifecycle reversal;
- pending lifecycle rather than guessed stock mutation;
- unresolved physically-found stock;
- Return/Exchange physical disposition separate from money;
- safe correction of mistaken handover.

These are not the source of the “black hole” feeling.

---

## 19. Confirmed defects / weaknesses from this slice

### S-ROOT-01 — reservation ledger and reservation cache are both consumed as truth

Business authority is active reservation rows, but ordinary browse reads the cached aggregate while attention/detail use ledger rows.

### S-ROOT-02 — full stocktake excludes retired canonical rows with real physical stock

Catalog activity incorrectly leaks into the scope of physical truth.

### S-ROOT-03 — Arrival is a second canonical master-data writer

Warehouse arrival can create product/execution/SKU through a separate validation path from Catalog/Resolver.

### S-ROOT-04 — ordinary Остатки mixes browse, allocation explanation and physical-integrity work

The screen is overloaded with multiple mental jobs.

### S-ROOT-05 — browse hierarchy mirrors technical canonical execution before client-relevant color/size structure

Domain identity is leaking into navigation.

### S-ROOT-06 — stock browse grouping still repairs legacy product identity in frontend code

This is another sign that the shared operational projection is incomplete.

---

## 20. Strongest conclusion after Order + Product + Stock slices

The same pattern now appears in three independent areas.

The system does **not** primarily suffer from missing safety machinery.

In several critical write paths it has more safety machinery than the UI suggests.

The deeper problem is:

> **Business facts have been made increasingly correct, but their ownership and projection into ordinary work have not been centralized.**

So complexity accumulates at the boundaries:
- one aggregate is treated like a lifecycle;
- historical text is treated like current product identity;
- cache and ledger are both read as current reservation truth;
- catalog activity changes what a “full physical count” sees;
- a warehouse entry point implements its own canonical master-data writer;
- UI reproduces identity/grouping logic instead of consuming one business projection.

This is now strong evidence that the user's “something is fundamentally strange” feeling has a real technical basis.

It still does **not** justify rewriting the entire system.

The likely repair level is:
1. define truth ownership/precedence;
2. consolidate domain write commands where ownership is duplicated;
3. create shared operational projections/read-models;
4. simplify UI around real employee questions;
5. remove legacy shortcuts only after consumers move to the shared contracts.

---

## 21. Next slice

Next: **Workshop lifecycle / finished-goods intake / production boundary**.

Questions:
- What is the true per-item Workshop lifecycle?
- What does `Готово` mean physically today?
- When does a finished Workshop item become stock, if at all?
- How are Workshop-produced goods linked to product identity/SKU?
- Which old `orders.workshop_status` behavior conflicts with task truth?
- What should be the future boundary where production cost is captured?
- What is the right business event for the client's production invoice/payable request?
- Does one click `Готово` represent production completion, physical receipt, both, or neither?

After the Workshop slice, stop, save the audit document and update the continuation context before Money/Finance.
