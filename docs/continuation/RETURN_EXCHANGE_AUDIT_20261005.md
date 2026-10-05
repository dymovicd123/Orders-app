# Return / Exchange audit follow-up — 2026-10-05

Environment: **Branch2 only**. Production/main and Production D1 are out of scope.

## Baseline

Exchange Set V2 was already merged and deployed to Branch2 before this follow-up. This pass focused on the adjacent ordinary Return flow and on making its semantics match the newer human inventory model.

## Business decisions kept

- Ordinary Return keeps **physical goods** and **money refund** as separate facts.
- Selecting a returned item does not automatically calculate refund money.
- Refund amount remains an explicit factual amount entered by the manager.
- Current Catalog price never reprices a historical Return.
- A money-only refund remains valid.
- A zero-money physical Return remains valid.
- Workshop-origin returns still default to **do not add to stock**, while Warehouse/Boutique remain explicit choices when the item really arrives.
- Exchange Set V2 remains the automatic commercial replacement flow; this Return pass does not reintroduce pair-based Exchange behavior.

## Problems found and fixed

### 1. Never-issued goods could be described as a physical Return

The old Return draft treated every remaining order line as a selectable returned item. On an order that had not handed a concrete line to the client, a manager could choose pending/no-stock and create a false physical history even though there was nothing to receive back.

Now:

- Return drafts derive a per-line `issuedToClient` fact from the actual stock handover/writeoff state;
- order-level `shipping_status = sent` is only a compatibility fallback for Workshop or historical rows without a line status;
- never-issued lines are visibly blocked in the Return form;
- the UI explains that pre-handover cancellation belongs in **Edit order**, not in Return;
- the server independently rejects any selected physical Return line that was never issued, including pending and no-stock payloads;
- money-only refunds remain available without selecting a physical line.

### 2. Workshop Return cancellation was not replay-safe

The previous cancellation path restored Workshop quantity by adding the returned quantity to the task's current quantity. A lost response / retry after the task had already been restored could add the same quantity twice.

Now:

- cancellation freezes Workshop baseline and target state in the critical-operation context before mutation;
- retry recognizes a task already at the frozen target as success/no-op;
- any state that is neither the frozen baseline nor target fails closed;
- the task update uses quantity+status compare-and-swap conditions;
- missing or concurrently changed Workshop dependencies are detected **before** stock lifecycle reversal;
- already-cancelled retry repairs derived order financial/workshop state before completing the recovery response.

### 3. Workshop delayed-intake default differed between the queue and history

Top-level pending Return intake already defaulted Workshop to no-stock, but the history action could default to Warehouse.

Both surfaces now use the same default: Workshop -> no-stock unless the operator explicitly chooses Warehouse or Boutique.

## Regression coverage

Added `scripts/test-return-unissued-physical-safety-r2.mjs` and wired it into the cumulative release gate.

The Return audit is also layered into the Branch2/main runtime-sync preservation test through:

- `scripts/return-ux-audit-20261005-runtime-manifest.json`
- `scripts/fixtures/return-ux-audit-20261005/**`

This allows the existing exact-main baseline test to normalize the Return delta first, then normalize Exchange Set V2, without weakening either comparison.

Current green candidate before this docs checkpoint: `96e98a2637f953b7c83b706d67a25d50d7c7a2ea`.

Quality run **37354722045 — success**:
- cumulative regression gate: success;
- application build: success.

## Manual acceptance after merge

1. Open a not-yet-issued order and press Return. Never-issued goods must be marked as staying on site and must not be selectable as physical returns.
2. On the same order, enter only a monetary refund with item quantities left at 0. It must remain allowed.
3. Use Edit order for a pre-handover cancelled item; Return must not duplicate stock.
4. Open a genuinely issued order. Returned quantity controls and pending/Warehouse/Boutique/no-stock disposition must remain available.
5. For Workshop-origin item arrival, both the top intake queue and history must default to no-stock.
6. Cancel a Return containing a Workshop item; retrying the same cancellation must not restore Workshop quantity twice.

## Smart Return UX follow-up

The safety model above is now reflected in a less technical operator interface.

The old Return item table has been replaced with responsive selectable cards:

- a manager clicks the item card instead of editing a technical quantity row;
- the card shows the current **available-to-return** quantity from backend-derived operation truth;
- quantity > 1 gets bounded +/- controls and a one-click “all” action;
- never-issued goods are visibly disabled and say that the item remains on site;
- a selected physical return asks one simple question: **“Где товар сейчас?”**;
- “Ещё едет обратно” preserves the existing delayed-intake queue;
- “Уже вернули” reveals the per-item Warehouse / Boutique / no-stock destination;
- Workshop-origin goods still default to no-stock and require an explicit Warehouse/Boutique choice to create stock;
- the form shows selected line/quantity summary while keeping refund money explicitly independent.

New regression: `scripts/test-return-smart-ux-r3.mjs`.

The exact frontend delta is layered over the existing Return audit and Exchange Set V2 structural baselines through `scripts/return-smart-ux-20261005-frontend-manifest.json`; predecessor fixtures are stored under `scripts/fixtures/return-smart-ux-20261005/`.

Green runtime candidate before this docs checkpoint: `efdacc6719fedfc19b3966d906c3048edbce9535`.

Quality run **37358759928 — success**:
- cumulative release gate: success;
- Return physical-receipt / availability / Workshop stock-truth regressions: success;
- TypeScript: success;
- clean application build: success;
- Wrangler Branch2 dry-run: success.

## Manual acceptance after smart UX merge

1. Open an issued order with one returnable item: one click should select it; the physical-state choice should be immediately understandable.
2. Open an issued order with quantity > 1: +/- and “all” must stay within the available remaining quantity.
3. Select “Ещё едет обратно”, save, and verify the item appears in the top pending-intake queue.
4. Select “Уже вернули” and verify Warehouse / Boutique / no-stock is chosen per item.
5. Open a never-issued order: the item card must be visibly disabled and direct the operator to Edit order.
6. Verify money-only refund and zero-money physical Return remain valid and independent.

## Next safe action

Merge the Smart Return UX follow-up into **branch2**, validate/deploy the exact merged Branch2 SHA, then manually test Exchange Set V2 and Return together in the real Branch2 UI. Production/main remains out of scope.
