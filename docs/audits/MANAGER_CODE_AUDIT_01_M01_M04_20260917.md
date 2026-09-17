# Manager code audit 01 — Astra M-01..M-04 — 2026-09-17

## Scope

Read-only analysis of Branch2 baseline `fb43e8d709b57b67cc080bb9bd64246bb036aede`, following the manager GUI report. No Product/Branch2/Production code or data was changed in this block.

The purpose is not to patch four observations independently. For each finding this document identifies the underlying model mismatch and the smallest simplification that removes the class of problem.

## M-01 — deferred stock shortage points to the wrong place

### What the GUI report observed

During order creation a shortage can be deferred with `Сейчас проверить не могу`. The UI then says the shortage will remain visible in `Склад → Внимание`, but the actual `Нужно уточнить` warehouse panel explicitly says shortages and stocktakes are handled elsewhere. The useful visible route was `Остатки → Требуют внимания`.

### What the code says

`useWorkspaceViewModel.renderOrderSourceAvailability()` deliberately supports deferral and renders this exact copy:

`Заказ сохранится. Нехватка останется видна в разделе «Склад → Внимание»...`

However `renderInventoryAttentionPanel()` deliberately defines its visible manager categories as `handover` and `identify`; its introductory text says `Нехватка и ревизии решаются в своих обычных разделах.` Shortages are not included in `clarificationTotal` and there is no shortage tab/card in that panel.

This is not because the backend lost the shortage. `getWarehouseAttentionSummary()` still calculates `counts.shortage`, fetches detailed shortage rows, and returns them as `response.items.shortages`. The frontend attention surface simply does not expose that part of the response. Separately, the stock overview exposes the filter `Требуют внимания`, which is where the manager found the problem.

### Root cause

This is **chronological UI drift**, not a missing backend feature. Earlier logic still thinks `Внимание` is the home for every warehouse issue; later W8 daily-surface work narrowed `Нужно уточнить` to identity/handover questions and moved quantity problems back toward the stock overview. The create-order copy was not updated, and the system now has two different human meanings of “attention”.

The deeper problem is that a deferred issue is described by a **section name**, not by the next action. Once navigation changes, the workflow breaks even though the data remains correct.

### Simplest direction

Do not create another queue and do not re-merge every warehouse problem into one giant attention page.

A deferred shortage should remain attached to the business object that caused it and expose one direct action such as `Проверить остаток` / `Открыть остаток`, leading to the exact SKU/source count UI. A global warehouse filter may still aggregate these issues, but it is secondary navigation, not something a manager must remember.

The copy should not promise a section path like `Склад → Внимание`. The UI should either take the person directly to the exact action or simply state that the order is saved and the shortage remains visible on the order until checked.

### Preserve

- `Сейчас проверить не могу` is useful and matches real work.
- Saving an order despite temporary inability to count stock is useful.
- `На месте / В заказах / Свободно` and visible negative free quantity were clear in the GUI audit.
- Backend shortage calculation already exists; do not rebuild it.

---

## M-02 — the same catalog question has different permissions depending on entry point

### What the GUI report observed

For TEST-D the order resolver lets an ordinary manager answer `Какой здесь пол?`, reach an exact existing SKU and then `Подтвердить товар`. The warehouse `Нужно уточнить → Товар` card for the same class of unresolved order position shows only `Требуется администратор`.

### What the code says

`renderInventoryAttentionPanel()` hard-gates every `items.catalog` card at the **screen/category level**:

- admin: `Разобрать`;
- manager: plain text `Требуется администратор`.

`useInventoryAttentionActions.openAttentionCatalog()` always sends the item to the old/full catalog review path (`catalogAdminMode = 'review'`, `openInventoryPanel('catalog')`, `loadCatalogReview(true)`). `App.loadCatalogReview()` immediately returns `null` for a non-admin. So the warehouse entry point is structurally admin-only because of where it routes, not because each underlying question actually requires admin rights.

The newer order-scoped resolver has a different permission model. Its GET review/context routes are available to the ordinary mode, and `/api/orders/:orderId/catalog-review/:itemId/resolve-existing` has no admin guard. Only `/api/catalog/review/:itemId/resolve-facts` — the path that can create/correct master-data facts — requires admin access.

This distinction is intentional: `scripts/test-contextual-catalog-resolution-r1.mjs` explicitly asserts that a “Manager-safe existing-variant resolver must exist”.

### Root cause

There are two catalog-resolution products layered on top of each other:

1. old/global catalog review, whose whole screen is treated as admin work;
2. newer contextual order resolver, which correctly gates the **mutation**, not the whole problem.

Warehouse Attention still routes to #1. Orders route to #2. Therefore permission depends on navigation history rather than on what the person is actually trying to do.

### Simplest direction

Do not teach Warehouse Attention its own resolver rules.

For an unresolved **order item**, the manager-facing warehouse card should route back into the same order/contextual resolver path (or, even more simply, open the exact order and let the existing order action continue the resolver). The simple Admin mode should be requested only when the current resolution step would change reusable catalog/master data.

That gives one rule everywhere:

- choosing/confirming an already existing exact product/SKU is ordinary work;
- creating or changing reusable catalog facts is Admin-mode work.

No new role, proposal system, notification system or approval queue is needed.

### Preserve

- The narrow manager-safe `resolve-existing` API.
- The resolver’s simple one-question flow for TEST-D; Astra explicitly found this part clear.
- The simple ordinary/Admin mode requested by the customer.

---

## M-03 — a green check means “local answer”, not “saved”

### What the GUI report observed

In TEST-D the manager picked `Мужской`, saw `Пол: Мужской ✓` and `Всё необходимое уточнено`, then closed the modal without pressing the final `Подтвердить товар`. Reopening asked for gender again.

### What the code says

This is not a failed database write. No write is attempted at the answer step.

`answerField()` immediately performs:

- `setNotice(... ✓)`;
- `setConfirmed(... true)`;
- then an async preview/read to see what the answer implies.

The actual mutation happens only later in `finish()`. Closing the modal calls the parent `onClose`; reopening creates a fresh resolution session and reloads from persisted order state. The local answer is therefore intentionally ephemeral.

More importantly, this misleading presentation is protected by a regression test. `test-contextual-catalog-resolution-r1.mjs` explicitly checks that `setNotice(... ✓)` exists and describes it as “immediate visible confirmation”. The test verifies an implementation/text pattern, not whether a human interprets the mark correctly.

### Root cause

The UI has only two visual states for a fact: absent vs green-success. It lacks the normal middle state **selected locally / not saved yet**.

This is the same semantic confusion already seen in the earlier resolver screenshots where `✓` meant several different things: selected, approved for creation, or actually persisted.

### Simplest direction

Keep the two-step interaction that Astra found understandable: answer the question, then confirm the product. Do **not** auto-save every answer just to make the checkmark truthful.

Instead:

- local answers should look selected, not “successfully saved”;
- reserve `✓` / success treatment for the successful final mutation;
- if the modal contains unsaved local decisions and the user closes it, either give a very short discard confirmation or deliberately persist a draft only if later analysis proves cross-session handoff is truly needed.

For the simple existing-SKU manager path, a server-side draft system would be unnecessary complexity. The immediate fix is state semantics, not a new workflow engine.

The regression test should be rewritten around user-visible state transitions rather than requiring the literal premature `✓` implementation.

### Preserve

- One question at a time.
- Preview/recheck before mutation.
- Separate final `Подтвердить товар` for an exact existing SKU.
- Duplicate-write/recheck safety already present in the resolution session.

---

## M-04 — empty size means both “unknown” and “this product has no size”

### What the GUI report observed

A known `ОРАМАЛ` line can be saved with the size control still displaying `Выберите размер`. The editor reopens the same way. There is no explicit `Без размера` choice even though dimensionless catalog variants exist.

### What the code says

The size `<select>` uses the empty string as its placeholder value and renders it as `Выберите размер` / `Выберите возраст`.

At the same time, the catalog model intentionally canonicalizes all of these to the same no-size identity:

- empty string;
- `БЕЗ РАЗМЕРА`;
- `БЕЗРАЗМЕРА`;
- `Б/Р`.

`normalizeCatalogCombinationSize()` turns all of them into `''`. Order validation does not require a size; `normalizeOrderItems()` preserves an empty size. Product autocomplete can also select an existing catalog variant whose `sizeLabel` is empty and set the editor draft’s `size` to `''` — which makes a *known valid dimensionless SKU* render as the *unanswered placeholder*.

This is not limited to size. The frontend canonical color helper maps a blank color to `БЕЗ ЦВЕТА`, while later server code had to add the Step 192A2 guard specifically to stop an omitted manager color from silently selecting a no-color SKU when colored siblings exist. That guard is evidence of the same underlying tri-state problem being repaired downstream.

### Root cause

The form/data boundary collapses three human states too early:

1. not answered / unknown;
2. explicitly “does not apply” (`Без размера`, `Без цвета`);
3. concrete value.

The database canonical representation may legitimately use an empty size for a dimensionless SKU, but the **editor draft cannot use the same empty string for both “unknown” and “known none”** and still be self-explanatory.

### Simplest direction

Keep the existing canonical database identity. Do not force every product to have a numeric size and do not create fake reference rows merely to satisfy the UI.

At the UI/draft level, represent attribute knowledge explicitly: `unknown | none | value` (this may be implemented with a lightweight UI sentinel rather than a database migration). Render `Без размера` / `Без цвета` as real choices when appropriate. Translate `none` to the existing canonical storage representation only at the API/domain boundary.

This removes an entire class of “blank but valid vs blank because forgotten” bugs and makes resolver/order/arrival semantics converge instead of adding another product-specific guard.

### Preserve

- Existing dimensionless SKU representation and catalog matching.
- Existing no-size/no-color canonical normalization.
- The ability to leave a truly unknown fact unresolved for the resolver rather than guessing it.

---

## Cross-cutting conclusions from M-01..M-04

These four GUI findings are not four independent bugs.

### 1. Navigation has become part of business logic

M-01 and M-02 fail because the application encodes “where to go” in several UI layers instead of exposing one action for the current business issue. When a newer screen is added, old entry points and copy drift.

**Direction:** business issue -> one shared action/process. Sections are merely places that can open it.

### 2. Permissions are applied too early

M-02 blocks the entire old review surface for managers even when the actual operation (link to an existing exact SKU) is intentionally manager-safe.

**Direction:** simple Admin mode gates dangerous/reusable mutations, not broad pages/categories of questions.

### 3. UI state lacks provenance

M-03 confuses local selection with persisted success. M-04 confuses unknown with intentional absence.

**Direction:** each important value needs a human-readable state before normalization: unknown, locally selected, persisted, or explicitly not applicable. Do not use green success or empty strings as overloaded state machines.

### 4. Regression tests can fossilize bad UX

The resolver regression test explicitly requires the premature `✓`. Other tests correctly protect important safety invariants, but tests that assert literal text/implementation patterns can turn a temporary UX choice into an architectural constraint.

**Direction:** retain safety regression coverage, but prefer assertions about allowed actions, persisted results and invariants over exact presentation details unless the wording itself is a contractual safety requirement.

## Proposed architectural target from this block

No broad rewrite is justified yet. The smallest converging target is:

1. one contextual catalog-resolution process for unresolved order items, regardless of entry point;
2. one direct physical-count action for a deferred shortage, regardless of where it is surfaced;
3. explicit UI states for `unknown` vs `none` vs concrete attribute value;
4. success visuals only after persistence; local choices are visibly local choices;
5. Admin mode checked at the mutation that changes master data, not at the page that happens to contain the problem.

This is a simplification target, not an implementation plan. Arrival, returns/exchanges, finance and reports must be audited before changing shared models because they may reveal the same state/provenance problem in additional places.

## Stop point

Block 01 complete. No fixes applied. Next audit block should inspect Astra M-05..M-07, with priority on M-06 Arrival because it appears to reuse the same `unknown / default / confirmed` ambiguity found in M-04.