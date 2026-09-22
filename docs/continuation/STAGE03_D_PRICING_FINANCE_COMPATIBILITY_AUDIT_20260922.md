# Stage03-D — pricing / payments / reports compatibility audit

Date: 2026-09-22
Baseline: branch2 `3831c51e388e525323eff7fe5de040e7f6eb5153`

Status: **READ-ONLY DESIGN/AUDIT ONLY**. No business code, UI, migration or D1 mutation in this step.

## User proposal being evaluated

Target flow proposed by the user:

1. Catalog stores the current sale price for the commercial execution.
2. In a new order, each product card shows its price.
3. The system prefills each line from Catalog when the price key is known.
4. A manager may discount or manually change the final price of each line.
5. Order price is calculated from all item line prices.
6. Payments remain separate manual money facts: manager chooses one or several payment methods and amounts.
7. Debt is whatever part of the final order price is not covered by payments.

This direction is coherent, but the current codebase still contains a legacy order-total model and several cross-workflow assumptions that must be protected before implementation.

## Current financial truth in the repository

The existing schema already separates:

- `orders.total_amount` — commercial total of the order;
- `payments` — actual money operations with date, method, amount and semantic kind;
- `orders.received_amount` — current received total;
- `orders.debt_amount` — current unpaid remainder;
- `order_items.unit_price` and `order_items.line_total` — line-level fields that already exist but are not used by the current create UI.

Server `calculateTotals()` already knows how to calculate `quantity * unitPrice`, but a positive explicit `orderTotal` overrides that sum.

Frontend `calculateTotals()` intentionally follows the old Step08 rule: item prices are ignored and `orderTotal` is the only order-price source.

Current create flow explicitly sends every item as `unitPrice: 0` and sends the manually entered `orderTotal`.

The editor preserves stored hidden `unitPrice`, but still keeps `orderTotal` as the visible commercial total.

Therefore the repository currently has **two latent price models**:
- legacy/manual order total — active in the UI;
- item-level unit price — supported by schema/server but not active for normal creation.

They must not be mixed implicitly.

## Core conclusion

The proposed model should separate four concepts:

1. **Catalog price** — current recommendation for this commercial execution.
2. **Final sold line price** — actual unit price agreed with the customer after any discount/override.
3. **Payment** — actual money received/refunded by a concrete method and date.
4. **Debt** — final order total minus actual received money.

Catalog price must never become a payment amount automatically.

Example:

- item final total: 50,000;
- cash payment: 30,000;
- Kaspi payment: 15,000;
- received: 45,000;
- debt: 5,000.

A later discount changes the commercial total, not the historical meaning of payment methods.

## Old orders — required compatibility

Existing orders must never be recalculated from today's Catalog price.

Many historical orders were created with:
- meaningful `orders.total_amount`;
- item `unit_price = 0`.

Therefore globally switching all orders to `SUM(order_items.line_total)` would destroy historical totals when an old order is edited.

A safe rollout needs an explicit pricing generation/mode on the order. Provisional recommendation:

- old rows: `legacy_manual_total`;
- new item-priced rows: `itemized_v1`.

For `legacy_manual_total`:
- `orders.total_amount` remains authoritative;
- old editor behavior remains compatible;
- no automatic Catalog repricing;
- no forced historical backfill.

For `itemized_v1`:
- final `orders.total_amount` is the sum of active item line totals;
- server recalculates this sum and does not trust a manual order-level override;
- payments/debt continue using the same existing ledgers.

Do not infer mode from `unit_price = 0`: zero can be a real free price and old data is ambiguous.

## Recommended line-level commercial snapshot

For new itemized orders, `unit_price` can remain the **actual sold unit price**.

However, if managers are expected to “only change something when there is a discount”, saving only final `unit_price` loses the original Catalog recommendation.

Provisional recommendation: add a nullable line-level `catalog_price_snapshot` (exact final name to be decided later).

New line meaning:

- `catalog_price_snapshot` — Catalog sale price at the moment the line price was established;
- `unit_price` — actual sold price after manager override/discount;
- `line_total = quantity * unit_price`.

Then discount can be derived:
- per-unit difference = catalog snapshot - final unit price;
- line discount = difference * quantity.

The discount itself does not need to become a third independent source of truth unless the client specifically needs a separate discount contract. UI may offer a discount calculator, but persistence should prefer base snapshot + final price.

Historical rows can keep snapshot NULL.

## Payments and debt — no conflict with item pricing

Current payment architecture already supports split payments.

Payments are independent rows. Example:
- НАЛИЧКА 30,000;
- KASPI PAY 10,000;
- final order total 45,000;
- debt 5,000.

Payment-method reports use `payments.method + payments.amount`, so item price autofill does not need to alter reporting by payment method.

Current backend already rejects `received > total`. This remains a useful safety rule.

Important future UX rule:
- changing a product price must **not silently rewrite payment rows**;
- if a discount makes existing payments greater than the new order total, saving must remain blocked until the manager fixes the payment facts;
- if payments become lower than the new total, debt should increase automatically.

## Reports — what is safe today

The main Finance reports derive:
- sales from `orders.total_amount`;
- received money and payment-method breakdown from `payments` / `orders.received_amount`;
- debt from `orders.debt_amount`;
- refunds from `returns.amount`.

If new itemized orders still persist a correct `orders.total_amount` snapshot, these headline reports can remain unchanged and old history stays stable.

Catalog current price must never be joined into historical Finance totals.

### Existing product-report problem discovered

Current aggregate product report joins `order_items` to `orders` and uses `SUM(o.total_amount)` as `order_sales` grouped by product.

For multi-product orders this is not true product revenue and may duplicate the whole order total across multiple product groups.

This defect predates Stage03. Stage03 must not silently reuse it for future profitability.

For itemized orders, true product revenue can later use `order_items.line_total`.

For legacy orders there is no safe general allocation of order total across products. Do not invent one. Historical product revenue should remain explicitly legacy/unallocated where exact line revenue is unavailable.

## Existing order editor — major implementation hazard

`sameOrderItemForEdit()` currently treats `unitPrice` as part of item identity/equality.

Therefore changing only a line price can currently trigger the full “rewrite items” path:
- reverse old stock/reservation effects;
- retire old order_item rows;
- insert new item rows;
- reserve/write stock again.

That is unacceptable for a pure commercial correction.

Before exposing editable item prices in the existing-order editor, price-only correction must be separated from physical item identity changes.

A future safe design should either:
- preserve order_item id in editor drafts and update commercial fields in place with optimistic/snapshot checks; or
- use a dedicated price-correction endpoint/operation.

Price corrections must not churn inventory.

## Returns — current dependency

Current return UI asks for the refund amount manually.

The selected return items do not currently provide their price as the refund authority; normal return creation sends item quantities/physical disposition but not per-item monetary amounts from the UI.

That means Stage03 can introduce item prices without immediately changing return behavior.

Later, itemized sold prices could provide a safe default refund amount for new itemized orders, but:
- legacy orders cannot safely derive exact item refund values;
- refund policy may differ from sold line price;
- client rules are required before automation.

Do not auto-convert returns as part of basic order-price rollout.

## Exchanges — major future compatibility point

Current exchange flow explicitly says separate product prices were removed.

Exchange money is entered manually as one visit-level:
- no money change;
- customer extra payment;
- refund.

Backend then:
- inserts the new replacement order item with `unitPrice: 0`;
- changes `orders.total_amount` by the manually entered exchange financial difference;
- creates payment/refund money facts separately.

This is compatible with the legacy manual-total model, but not with a strict itemized order model where total must equal the sum of active line totals.

Therefore exchange semantics must be designed before itemized pricing becomes universal.

Potential future itemized behavior (not approved yet):
- old returned quantity reduces the commercial contribution of the old line;
- new replacement line receives its own final sold unit price;
- order total derives from active item lines;
- actual extra payment/refund remains a separate money operation.

Client policy is still required: an exchange may intentionally have no price difference even if catalog prices differ.

## Catalog price key — known and unknown dimensions

Current Stage03 price key is:
- product;
- material;
- length;
- adult/child.

This matches the user's confirmed knowledge.

Still unresolved by the client:
- gender;
- color;
- exact size/age.

Therefore order-price autofill must not be implemented as a final production rule until this ambiguity is resolved, or it must be explicitly treated as provisional base pricing.

## Additional product-design questions to resolve after this audit

The following should be answered before final implementation, but this audit does not invent answers:

- Does delivery have a separate price or is it included in item prices?
- If Catalog has no price, may a manager enter a fully manual line price and save?
- If a manager manually overrides a line and then changes product/material/length/category, should the override be preserved, cleared, or require confirmation?
- Should the UI expose direct final price only, discount amount, discount percent, or a calculator over the final price?
- Are zero-price/free items allowed?
- For quantity > 1, is discount normally per unit or per whole line?
- How should return refund defaults work for new itemized orders?
- How should exchange price differences work under client policy?
- Do managers need a reason/audit note for price override?
- Does the client need explicit discount reporting?

## Recommended implementation order after decisions

Do not implement all at once.

1. Keep current Stage03 Catalog-price feature stable.
2. Decide explicit order pricing mode/version and line snapshot fields.
3. Add schema/backend compatibility foundation with old orders untouched.
4. Add item price UI for **new order create only** first.
5. Keep payments manual and independent.
6. Add server-side itemized total calculation and debt validation.
7. Acceptance-test split payments, debt and discounts.
8. Only after that design existing-order price corrections without inventory churn.
9. Handle returns/exchanges compatibility separately.
10. Update product/profit reports only when historical semantics are explicit.

## Safety conclusion

The user's proposed flow is a good target architecture **if** item price, order total, payment and debt remain separate layers.

The main blockers are not payment-method reporting. They are:
- legacy-order compatibility;
- explicit pricing mode/version;
- preserving Catalog price snapshot vs actual sold price;
- preventing price-only edits from rewriting inventory;
- exchange semantics;
- product-level report semantics.

No implementation should proceed past Catalog-only Stage03 until these contracts are fixed.
