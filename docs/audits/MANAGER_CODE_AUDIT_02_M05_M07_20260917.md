# Manager code audit 02 — Astra M-05..M-07 — 2026-09-17

## Scope

Read-only code analysis of Branch2 baseline `fb43e8d709b57b67cc080bb9bd64246bb036aede`, following the manager GUI report in `SYSTEM_UX_WALKTHROUGH_ASTRA_MANAGER_20260917.md`.

No Product/Branch2/Production code or D1 data was changed in this block. The audit branch remains documentation-only.

This block intentionally stops after M-05..M-07. The goal is not to patch each visible symptom, but to identify the model/flow mismatch behind it before shared order, inventory and finance semantics are changed.

---

## M-05 — the ordinary order editor exposes a workshop state that does not apply

### What the GUI report observed

A normal order containing only a Warehouse item showed a disabled field:

`ЦЕХ: В работе`

The same editor also displayed a large general explanation above Payments about payment IDs, money history, and exchange-linked extra payments.

The actual comment edit succeeded, so this was not a failed save. The problem is that the editor asks the employee to interpret system-internal state that is irrelevant to the current order/action.

### What the code says

`OrderEditorSection.tsx` renders the `Цех` select for **every** editable order. It is disabled for an ordinary manager, but it is still visible and bound to `editorDraft.workshopStatus`.

The field is not conditional on the order having Workshop items or Workshop tasks. The adjacent `Статус` field is rendered the same way.

`createEditorDraft(order)` copies the coarse order-level value directly:

- `workshopStatus: order.workshop_status`;
- `orderStatus: order.order_status`.

The default new-order draft also starts with:

- `workshopStatus: 'in_workshop'`;
- `orderStatus: 'active'`.

Order creation sends that value to the backend, and `orders-write.ts` normalizes/persists `workshopStatus` as an order column independently of whether any Workshop item exists.

This is important because Workshop truth elsewhere is already more specific. `orders-relations.ts` resolves `workshopTaskStatus` per order item, and the Orders table computes `hasWorkshopItems` before treating an order as waiting for the Workshop. In other words, the main Orders surface already knows that an order-level `workshop_status` is not meaningful by itself.

`refreshOrderWorkshopStatusFromTasks()` in `worker/domains/workshop.ts` also returns without changing anything when an order has zero Workshop tasks. Therefore a stock-only order can legitimately keep the default coarse `in_workshop` value even though no Workshop work exists. The Orders table masks that legacy/coarse value by checking actual items first; the editor does not.

The Payments help text has a similar presentation problem. The section-level paragraph describes several exceptional cases at once, while each existing payment row already renders a contextual note depending on whether the payment is an ordinary payment or exchange-linked extra payment.

### Root cause

This is not primarily a wording defect. It is an **applicability/projection defect**.

The editor projects persisted columns into the form as if every stored field were a business fact relevant to every order. But `workshop_status` is a coarse/legacy aggregate whose meaning depends on the presence and state of actual Workshop tasks/items.

The same generic-form instinct appears in Payments: exceptional rules are explained globally instead of being shown only where the employee can act on them.

### Simplest direction

Do not invent a new Workshop status model just to remove this field.

For the working editor:

- derive whether Workshop state is applicable from actual Workshop items/tasks;
- hide the Workshop control entirely for stock-only orders;
- for Workshop/mixed orders, show the human state derived from the actual Workshop work rather than exposing an irrelevant coarse default;
- keep lifecycle-changing actions as their existing dedicated actions rather than turning the generic editor into a status console.

For Payments, keep the contextual per-payment restriction notes and remove/reduce the broad paragraph that explains cases not present in the current order.

The database column can remain for compatibility until a separate schema-cleanup decision is justified. This audit does **not** recommend a migration merely to fix the editor.

### Preserve

- Ordinary managers must not gain new lifecycle/status editing powers through this cleanup.
- Existing per-item Workshop task truth and the Orders-table `hasWorkshopItems` guard are useful.
- Existing dedicated actions for shipping, Workshop progress and deletion should remain the authoritative mutation paths.
- Existing contextual payment-row restrictions should remain; only duplicated/general explanation is suspect.

---

## M-06 — Arrival treats defaults as confirmed physical facts

### What the GUI report observed

In `Склад → Операции → Приход`, the empty form showed zero. After entering only the known product name `ОРАМАЛ`, the footer changed to roughly:

`1 позиций · 1 вариантов · 1 шт. · Склад`

and the primary `Оформить приход` button became active.

The employee had not entered a quantity, size or color. Gender/material/length were partially filled automatically.

### What the code says

#### 1. The draft begins with quantity = 1

`createEmptyArrivalPosition()` creates one size line immediately:

`{ size: '', color: '', quantity: 1 }`

So quantity `1` exists before the employee reports any physical count.

#### 2. Typing/selecting a product is enough to make that default count enter the summary

`inventoryArrivalSummary` counts a line whenever:

- `quantity > 0`; and
- `position.productName.trim()` is non-empty.

It does not require an explicit quantity interaction, an exact variant, a size, or a color.

The movement panel disables the primary button only when `inventoryArrivalSummary.rows === 0`. Therefore entering a product name turns the inherited default `1` into a visually ready operation.

#### 3. Selecting a known product auto-fills some identity but not necessarily the exact SKU

`selectInventoryArrivalProduct()` finds the catalog product and can auto-fill:

- product ID/name;
- category;
- product-gender-scope-derived gender;
- material and length from an active variant.

It does **not** make color/size explicit at that point.

This auto-fill is reasonable as a suggestion, but the current UI does not distinguish suggested identity from confirmed physical identity.

#### 4. Flattening can interpret blank color/size as an exact existing variant

`flattenInventoryArrivalPositions()` searches `inventoryArrivalReadyVariants(position)` for an exact variant using category, gender, color, material, length and size.

Because blank color and blank size are also legitimate canonical values for no-color/no-size variants elsewhere in the system, a blank-looking form can resolve to a real existing variant when such a variant exists. In that case a manager request can carry a positive `variantId` even though the person never explicitly confirmed the blank attributes.

This is the same tri-state collapse identified in M-04: blank can mean either `unknown/not answered` or a legitimate `none` value.

#### 5. If it does not resolve to an existing variant, the failure happens late

Frontend `saveInventoryMovement()` blocks a normal manager when an Arrival line has no `variantId` and says that a new product/characteristic requires Admin mode.

The Worker independently enforces the same boundary: an Arrival is manager-safe only when every item has `variantId > 0`; otherwise `/api/inventory/movements` requires Admin access.

That is a good permission invariant, but it is surfaced too late. An incomplete existing SKU can look like a ready Arrival and only after pressing the main action be described as if the person were trying to create master data.

#### 6. In Admin mode an unresolved Arrival can create reusable catalog facts

For a permitted non-`variantId` Arrival, `inventory-movement.ts` routes missing items through `resolveInventoryCreatableItemsBulk()`.

That resolver can create:

- a missing catalog product;
- a missing stock-position execution (material/length);
- a missing catalog variant.

Therefore this is more than a cosmetic summary bug. In Admin mode, incomplete/suggested form state is allowed to cross the boundary into reusable master data. The backend is doing what the existing Admin workflow asks it to do; the problem is that the UI does not make the transition explicit enough.

### Root cause

Arrival collapses four different states into ordinary field values:

1. untouched default (`quantity = 1`);
2. inferred/suggested product facts;
3. explicitly confirmed physical facts;
4. persisted catalog/stock facts.

It also inherits the M-04 ambiguity where `''` can mean either “не выяснено” or a valid “без цвета/без размера” identity.

As a result, the footer answers the wrong question. It reports what the draft *could currently serialize*, not what the employee has actually confirmed arrived.

### Simplest direction

Do not add another confirmation modal and do not create a separate Arrival wizard.

Converge Arrival on the same explicit state semantics needed by the order editor/resolver:

- a new quantity line should start blank/zero or otherwise carry an explicit `touched/confirmed` state; inherited `1` must not count as a physical fact;
- the primary action should become ready only for lines whose physical quantity was explicitly confirmed and whose product identity is an exact existing variant for a manager;
- valid no-size/no-color variants must render as explicit `Без размера` / `Без цвета`, not as unanswered blanks;
- auto-filled gender/material/length may remain as suggestions, but the UI must distinguish suggestion from exact selected SKU when ambiguity remains;
- Admin-only creation of a new product/characteristic/variant should be an explicit master-data decision, not an implicit consequence of pressing `Оформить приход` on an incomplete line.

The backend permission rule (`manager => existing variant only`) should be preserved. The frontend should make that invariant obvious before submission rather than relying on the final error.

### Severity after code review

Keep M-06 **HIGH**.

The GUI report was cautious because it did not submit the Arrival. The code review shows two real structural risks:

- an exact blank/no-size variant can turn the untouched default quantity into a valid manager mutation;
- Admin mode can turn unresolved draft state into newly created reusable catalog facts.

No live write was performed in this audit, so this remains a code-path conclusion, not a claim that the specific `ОРАМАЛ` GUI draft actually mutated Branch2.

### Preserve

- Existing manager-safe Arrival of known `variantId` rows.
- Admin boundary for catalog creation.
- Product/gender-scope autocomplete when it is genuinely unambiguous.
- Existing bulk backend resolver and idempotent inventory operation machinery; this finding does not require replacing them.
- Multi-size Arrival UX can remain; the defect is readiness/provenance, not the list layout itself.

---

## M-07 — Return eligibility is discovered only after filling the form

### What the GUI report observed

An unpaid, unsent test order showed the normal `Возврат` action.

The Return form opened and displayed `Доступно 0`. The employee could still choose one item and `Ещё не пришёл`, while the primary `Оформить возврат` button remained active. Submission with amount `0` then failed with:

`Укажите сумму возврата больше нуля.`

The GUI audit deliberately did not decide whether an unpaid order should be cancelled, edited, deleted or support a stock-only return. That business decision remains outside this finding.

### What the code says

#### 1. The draft already knows there are no refundable funds

`createReturnDraft(order)` calculates:

`refundableAmount = max(0, received_amount - return_amount)`

and initializes `amount` with that value.

So for the audited unpaid order the form knows immediately that the refundable amount is zero.

#### 2. The primary button ignores that eligibility

`OrderReturnsSection.tsx` renders:

`Оформить возврат`

with `disabled={returnBusy}` only.

It is not disabled when:

- refundable amount is zero;
- amount is zero;
- payment method is absent.

Those rules are deferred to submit-time validation.

#### 3. The frontend and backend both define this operation as a monetary refund

`saveReturn()` rejects `amount <= 0` before calling the API.

`createReturn()` repeats the invariant on the server:

- amount must be greater than zero;
- payment method is required;
- amount cannot exceed received funds still available for refund.

The server code explicitly notes that **money-only returns are valid** and may have no `return_items` at all. That is useful evidence about the domain meaning of this operation: `/api/returns` is fundamentally a financial refund operation that may also track returned physical items, not a generic “undo/cancel an order” command.

The physical-item subsystem is comparatively explicit (`pending`, `warehouse`, `boutique`, `no_stock`) and has safeguards against restocking a stock item that was never physically issued. The late error in M-07 is therefore not caused by missing return-domain validation. It is caused by the UI offering the operation before its financial precondition is met.

### Root cause

The application separates **action discovery** from **action eligibility**.

The table offers `Возврат` as a broad order action, the form then lets the employee fill physical details, and only submission answers the first business question: “Is a monetary return possible for this order at all?”

This is the same pattern as M-06 in another domain: the main action looks available before the system has exposed whether the draft is actionable.

### Simplest direction

Do not weaken the `amount > 0` invariant and do not add a special zero-ruble return merely to make the current button work.

Instead, compute the already-known eligibility before the employee enters the form/workflow:

- when refundable funds are zero, do not present the standard Return form as if it can be completed;
- state the concrete reason (`Получено 0 — возвращать деньги нечего` or equivalent business wording);
- expose the existing relevant order actions separately rather than sending the employee through a refund form to discover that it is not the right operation.

Which non-refund action is correct for an unpaid unsent order is a product/business rule and should not be invented by this audit. In particular, do not silently redirect to deletion/cancellation until that workflow is explicitly accepted and its safety is verified.

If refundable funds are positive, the form can continue to support money-only return or money + physical items exactly as the backend does today.

### Preserve

- Server-side `amount > 0` and `amount <= available received funds` checks.
- Required refund payment method.
- Money-only returns when they are financially valid.
- Explicit physical states for returned items.
- Safeguard that prevents restocking a stock item that was never physically issued.
- Existing idempotent critical-operation handling.

---

## Cross-cutting conclusions from M-05..M-07

### 1. “Stored” is not the same as “applicable”

M-05 shows a persisted `workshop_status` that is meaningful only when Workshop work exists. Rendering every stored field in a generic editor leaks legacy/coarse implementation state into ordinary work.

**Direction:** derive applicability from the current business object and action before rendering controls.

### 2. “Has a value” is not the same as “confirmed”

M-06 is the strongest example so far. `quantity = 1`, inferred gender/material/length, and blank color/size are all ordinary values in the draft, but they have different provenance. The summary treats them uniformly as ready facts.

This directly reinforces M-03/M-04 from the previous block.

**Direction:** important workflow values need provenance at the UI boundary: untouched/default, inferred, explicitly selected, explicitly none, persisted.

### 3. “Visible action” is being confused with “eligible action”

M-07 lets a person enter a flow whose first immutable rule (`refund amount > 0`) is already known to be false.

M-06 similarly enables the main submit control from draft shape rather than confirmed readiness.

**Direction:** primary actions should communicate eligibility before submission. Server validation remains mandatory, but it should be a safety net rather than the first explanation of a normal business rule.

### 4. Admin mode should mark a deliberate boundary, not absorb ambiguity

M-06 currently converts an unresolved Arrival into “Admin required”, and Admin mode can then create catalog facts. That is technically consistent but humanly dangerous: incomplete input and intentional master-data creation are not the same intent.

This reinforces M-02’s earlier conclusion.

**Direction:** Admin mode gates a deliberate reusable-data mutation. It should not be the generic destination for a form that merely lacks enough information.

### 5. Do not fix these findings by adding more explanatory paragraphs

The GUI audit already showed that explanation text is becoming part of the burden (M-05, M-07). M-06 cannot be made safe by another sentence under the form while the button and summary still say “ready”.

The simplest converging target remains structural:

- show only applicable state;
- distinguish inferred/default/local/persisted facts;
- require explicit physical quantity confirmation;
- expose exact existing SKU selection to managers;
- make Admin master-data creation explicit;
- compute action eligibility before the primary action.

---

## Implications for the eventual fix plan

Do not implement M-05, M-06 and M-07 as three unrelated text/UI patches.

A small shared concept is emerging across M-03/M-04/M-06: **fact provenance / explicit absence**. It does not necessarily require a database migration. A lightweight frontend draft representation can distinguish:

- `unknown`;
- `none` (for no size/no color where valid);
- `inferred`;
- `confirmed value`.

Arrival additionally needs explicit quantity confirmation/readiness.

Separately, applicability/eligibility should be computed from domain data:

- Workshop control only when Workshop work exists;
- Return flow only when monetary refund is eligible;
- Arrival submit only when physical rows are ready.

These are candidates for shared helpers/selectors, not for another broad rewrite of the application.

Before any implementation, M-08 (Reports date contradiction) and the Admin-mode walkthrough should still be audited because they may expose additional instances of the same “generic global explanation vs contextual truth” problem.

---

## Stop point

Block 02 complete. No fixes applied.

Next audit block should inspect M-08 and then the Admin-mode path, while preserving the conclusions from Blocks 01–02. After that, build one consolidated fix plan grouped by root cause rather than by screenshot/finding ID.