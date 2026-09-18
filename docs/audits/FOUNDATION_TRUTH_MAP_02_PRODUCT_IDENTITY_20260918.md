# Foundation truth map 02 — Product identity / canonical SKU / historical snapshots / assortment state — 2026-09-18

## Scope

Branch2 baseline rechecked before this block: `fb43e8d709b57b67cc080bb9bd64246bb036aede`.

Audit branch before this block: `a9ef11d7762445b4540c731238dc17f692e053fd`.

This is a source-of-truth audit, not an implementation plan.

No Branch2/Production code or D1 data was changed.

Questions for this slice:
- What is authoritative current product/SKU identity?
- What are historical snapshots versus current canonical facts?
- What exactly do aliases and reference values mean?
- What does active/inactive mean operationally?
- Why did resolver correctly link a canonical SKU while Orders still showed the old material/name?
- What constraints must future price/cost work obey?

---

## 1. Current catalog identity has a coherent three-level core

Identity V3 defines:

### Base product
`catalog_products.id`

Human concept: model/base product.

Current metadata includes:
- `name`;
- product-level category/default metadata;
- `gender_scope`;
- `is_active`.

### Execution / stock-position family
`catalog_stock_positions.id`

Canonical identity is:

`product_id + material + length`

Migration 0048 explicitly calls this the execution identity.

### Concrete stock combination / SKU
`catalog_variants.id`

Canonical identity inside an execution is:

`stock_position_id + category + gender + color + size`

This is a substantially better model than the older flat variant identity because material/length define the execution and color/size/gender define concrete stocked combinations.

Stable `product_id` / `variant_id` are the strongest operational identity links throughout orders, reservations, stock, lifecycle events, transfers and Workshop.

### Conclusion

The catalog does **not** need to be redesigned from zero. There is already a usable canonical identity hierarchy.

---

## 2. Aliases are recognition rules, not alternate business identities

There are three distinct learning layers:

### `catalog_product_aliases`
Raw product spelling/name → active `product_id`.

Purpose: “this spelling means that product”.

Aliases only resolve to active products.

### `catalog_value_aliases`
Raw color/material/length/size value → canonical value.

Purpose: normalize known spelling/value variants.

### `catalog_input_aliases`
Full normalized order-input key → `variant_id`.

Purpose: safely remember an exact previously confirmed combination.

Identity V3 does not blindly trust an old full-input alias. It independently derives product/execution/category/gender/color/size and accepts the alias only if the alias points to that exact canonical identity.

### Conclusion

Aliases are a good mechanism to preserve. They should never become user-facing product entities.

They answer recognition, not identity ownership.

---

## 3. Reference values are vocabulary constraints, not SKU truth

`reference_values` and the value aliases regulate allowed material/length/color/size vocabulary.

Resolver/admin creation checks references before creating new reusable master data.

This is also worth preserving.

Important distinction:

- reference value = allowed vocabulary;
- execution/variant = actual product identity;
- snapshot = what was recorded at a moment;
- alias = how raw input is recognized.

Several current UIs blur those layers, but the backend model already distinguishes them.

---

## 4. The system intentionally preserves order snapshots while changing canonical links

This is the direct explanation for the real TEST-BE observation.

`resolveCatalogReviewRows()` changes:

- `order_items.product_id`;
- `order_items.variant_id`;
- reservation identity.

It **does not rewrite ordinary order snapshots**.

The orders read path explicitly says:

> Order history is snapshot-first.

It returns:
- `product_name_snapshot`;
- `gender_snapshot`;
- `color_snapshot`;
- `material_snapshot`;
- `length_snapshot`;
- `size_snapshot`

as the displayed order item, even though the same SQL query has already joined:
- `canonical_product_name`;
- `canonical_gender`;
- `canonical_color`;
- `canonical_material`;
- `canonical_length`;
- `canonical_size`.

Therefore the system already possesses both truths, but deliberately throws away the canonical truth when constructing the ordinary order read model.

### This is a confirmed projection defect

For TEST-BE:

- snapshot/history: noisy TEST name + `СТАНДАРТ`;
- canonical linked SKU: normal product + `КОСТЮМНЫЙ МАТЕРИАЛ`.

Resolver did its job. Stock used the canonical linked SKU. Orders used the historical raw snapshot.

Neither storage fact is inherently wrong.

The defect is that the **working order screen** presents the historical input as though it were still the current operational identity.

### Important distinction

Historical snapshots should remain immutable.

The solution is **not** “rewrite snapshots after resolver”.

The missing concept is a deliberate read projection:
- raw/historical input;
- resolved/current operational identity.

Which one is primary depends on the surface and lifecycle stage.

---

## 5. “Snapshot” currently means different things in different tables

This naming inconsistency is a deeper source of confusion.

### `order_items.*_snapshot`
Semantics: historical/raw order-time wording.

Intentionally preserved through catalog repairs/merges.

### `inventory_movements.*_snapshot`
Semantics: event-time historical description.

Also should remain historical.

### `inventory_stock.*_snapshot`
Semantics are different.

These fields are repeatedly synchronized from the current canonical variant during migrations/reservations/merges. They act as a **denormalized current display cache**, not an immutable historical snapshot.

The same suffix therefore represents two different contracts:
- immutable event/history;
- mutable current projection cache.

### Foundation implication

This makes it easy for new code to read the wrong “snapshot” expecting the wrong semantics.

A future cleanup does not necessarily require renaming columns immediately, but read/write contracts must explicitly classify them.

---

## 6. Current canonical material/length also exist redundantly in two places

Identity V3 declares execution identity as:

`catalog_stock_positions(product_id, material, length)`.

But `catalog_variants` still stores copied `material` and `length` fields.

Current canonical loader `loadCanonicalVariantSnapshot()` reads:

`catalog_variants.material / length`

rather than joining the execution and reading:

`catalog_stock_positions.material / length`.

The migrations/update paths try to keep these copies synchronized, but structurally there are still two current representations of execution material/length.

### This is a genuine source-of-truth weakness

The execution is the identity owner, so current canonical reads should conceptually come from the execution.

The copied variant columns are compatibility/denormalization, not independent truth.

No immediate migration is recommended in this audit. But future read-model work should stop treating both as equal authorities.

---

## 7. Variant identity mutation is already guarded well

`updateCatalogVariant()` calculates whether identity changed.

If a variant has operational usage in orders, stock, movements, reservations, lifecycle, transfers, checks or stocktakes, the normal rule is:

> do not rewrite its identity/history; create the correct combination separately, then retire the old one.

There are narrow audited exceptions for gender repair/merge.

This is good architecture and should be preserved.

It means `variant_id` can serve as a stable operational identity for historical and current links.

---

## 8. Product rename is much weaker than variant identity mutation

`updateCatalogProduct()` can change `catalog_products.name` directly.

It currently does not:
- preserve the old canonical name as a product alias automatically;
- synchronize existing `inventory_stock.product_name_snapshot` rows immediately;
- create an explicit rename history event.

Because current stock display reads the stock-row snapshot, a product rename can leave:
- Catalog showing the new name;
- current stock showing the old name until another operation later refreshes that stock row;
- old order history intentionally showing the old/raw name.

Also, new manager input using the old canonical name may no longer resolve unless an alias already exists.

### Interpretation

This shows another version of the same foundation issue.

If product name is a mutable **label** on stable `product_id`, then current operational surfaces should join/display the current label and rename should preserve recognition continuity.

If product name is part of immutable business identity, direct rename is too permissive.

Current code behaves halfway between those models.

### Audit direction

Treat `product_id` as stable identity and product name as current canonical label unless later business analysis disproves it.

Then:
- history may keep old/raw label;
- current catalog/stock should use current label;
- old canonical name should normally become an alias after rename.

Do not implement this yet; carry the contract into the consolidated plan.

---

## 9. Active/inactive has useful semantics, but product and variant retirement are asymmetric

### Active product

Recognition/resolver/new selection paths require active product.

Product aliases also resolve only to active products.

Therefore `catalog_products.is_active = 0` means approximately:

> do not use this product for new normal catalog selection/resolution.

Historical references remain.

### Active variant

New exact SKU selection requires active variant + active product.

Manual variant deactivation is much stricter.

`assertCatalogVariantMayDeactivate()` blocks deactivation when there is:
- nonzero physical stock;
- reservation;
- active unsent order;
- unfinished Workshop task;
- pending lifecycle receipt/return;
- active stocktake.

That is strong and sensible for a concrete SKU.

### Current stock visibility

Inventory read intentionally keeps inactive product/variant rows visible when they still have physical or reserved quantity.

An inactive zero-stock/nonreserved linked position falls out of ordinary stock browse.

This is a good history/operations separation.

---

## 10. Product-level retirement currently supports “stop new sales, keep remaining stock visible”

Unlike variant deactivation, product deactivation currently has no stock blocker and does not delete history.

That produces useful behavior:

- product stops appearing as an active new selection/resolver target;
- its existing stock with quantity/reservation remains visible in Inventory;
- existing resolved reservations can still be fulfilled because shipment fulfillment follows the stored `variant_id` and stock row rather than re-resolving against `is_active`.

This is close to one plausible meaning of “remove from assortment”.

### But there are two unresolved business semantics

#### A. Stop new sales immediately

Current product deactivation is broadly compatible with this.

Existing already-resolved orders may still finish.

#### B. Stop replenishment but sell remaining units

Current single `is_active` flag does **not** model this cleanly because inactive products are excluded from normal new selection/resolution.

If the client means “sell through the remainder but do not replenish”, the system needs a distinct assortment state or replenishment policy. Do not overload `is_active`.

### Important risk

Product deactivation has no equivalent blocker for unresolved active order lines.

An unresolved order that only contains the raw snapshot can lose the ability to resolve to that product after it is deactivated.

So even for “stop new sales immediately”, retirement should eventually account for unresolved in-flight work.

---

## 11. Historical client cleanup and current manual retirement are not the same mechanism

Migration 0056 performed a one-time client-approved cleanup and explicitly recorded retirement baselines/history before deactivating known bad products/variants.

Current variant admin deactivation is now guarded more strictly.

Do not use the historical migration behavior as the model for everyday assortment retirement.

The modern everyday model should use current business rules, not one-time cleanup SQL.

---

## 12. Resolver has two different jobs and the UI should keep them conceptually separate

Resolver currently does both:

1. identify/link an order line to existing canonical product/SKU;
2. in Admin mode, create reusable master data when the product/execution/combination/reference truly does not exist.

That technical distinction is healthy.

The problematic part is when the same UI makes local draft facts look saved or when historical snapshot display later hides the canonical result.

### Preserve

- manager-safe link to an existing exact SKU;
- Admin boundary for creating reusable master data;
- alias learning only after validated canonical target exists;
- no mutation of historical order snapshots merely to make the order screen “look fixed”.

### Change later at projection/workflow level

After resolution, operational screens need to consume the canonical link rather than pretending the raw snapshot is still current truth.

---

## 13. Product identity read-model should distinguish three human questions

A future shared projection should be able to answer:

### “Что менеджер записал?”
Historical/raw order snapshot.

### “Что это за товар в системе сейчас?”
Canonical `product_id / variant_id` joined through current catalog identity.

### “Как это называлось/выглядело в момент конкретной операции?”
Event snapshot (payment has no SKU; inventory movement / Return / Exchange may have operation-time snapshots).

These are different questions.

Current screens often answer one while the user expects another.

This is one of the strongest root-level explanations found so far.

---

## 14. Implications for future price and cost

Do **not** add price/cost blindly to the first convenient table yet.

The identity map now gives three possible ownership levels:

- base product;
- execution (product + material + length);
- concrete SKU.

Client wording says “әр товарға” / per product, but material/execution may potentially change production cost or sale price.

That business rule still needs confirmation.

### Invariants already clear

Regardless of ownership level:

- current/default sale price is master data, not historical order truth;
- actual sold `unit_price` remains an immutable commercial snapshot;
- default price changes must not rewrite old orders;
- cost used for profitability must be captured at the relevant receipt/production event, not recalculated from today’s default cost;
- reports should group by stable canonical IDs, not raw names;
- product rename must not split one product into two report identities.

### New caution

Earlier discussion leaned toward product-level default price. That remains plausible, but this audit does **not** approve it until we confirm whether material/length executions can have different cost/sale price.

---

## 15. Strong mechanisms to preserve

- stable product/variant IDs;
- Identity V3 hierarchy;
- execution = product + material + length;
- concrete combination = execution + category + gender + color + size;
- immutable order/history snapshots;
- protected variant identity mutation after operational use;
- alias conflict guards;
- active-only recognition for new work;
- inventory visibility of retired stock while quantity/reserve remains;
- resolver linking without rewriting historical text.

---

## 16. Confirmed defects / weaknesses from this slice

### P-ROOT-01 — no shared historical-vs-canonical read projection

Orders intentionally ignore already-joined canonical fields and remain snapshot-first even for active working orders.

This directly caused the visible STANDART vs canonical material mismatch.

### P-ROOT-02 — execution truth duplicated into variant material/length

Identity owner and canonical loader disagree structurally about where current material/length live.

### P-ROOT-03 — product rename contract is incomplete

Stable product identity exists, but rename neither preserves old name as alias nor guarantees current stock display refresh.

### P-ROOT-04 — `is_active` conflates “not sellable now” with broader assortment-retirement policy

It supports immediate stop-new-sale semantics reasonably well, but cannot represent “sell remaining stock, do not replenish”.

### P-ROOT-05 — product retirement can strand unresolved in-flight order input

Resolved reservations can finish; unresolved raw lines can no longer choose an inactive target.

---

## 17. Strongest conclusion after Order + Product slices

The foundation hypothesis is now supported in two independent domains.

The recurring failure is:

> stable domain facts exist, but the application does not explicitly classify current canonical truth, historical snapshots, mutable caches and derived operational projections.

As a result:
- historical input is displayed as current identity;
- mutable stock cache is named like immutable history;
- current execution facts are duplicated;
- one active flag is asked to represent several business meanings.

This is deeper than a resolver UI bug but much smaller than “rewrite the ERP”.

The likely architectural remedy is a disciplined **truth contract + shared read-model layer**, preserving most write-side mechanisms.

---

## 18. Next slice

Next: **Physical stock / reservations / lifecycle / stocktake truth**.

Questions:
- What exactly is authoritative for physical quantity?
- What is authoritative for reserved quantity?
- Which movements are immutable history versus current count?
- How do stock checks/stocktakes supersede older lifecycle events?
- Why does “Остатки” feel technically dense even when numbers are correct?
- Can one operational stock projection answer product → color → size → physical/reserved/free without exposing internal accounting machinery?
- How must Return/Exchange physical receipt feed that projection?
- What future cost-value calculation can safely attach to physical inventory without confusing financial refund with restored stock value?

After that slice, stop and update the durable continuation context before Workshop/Money.
