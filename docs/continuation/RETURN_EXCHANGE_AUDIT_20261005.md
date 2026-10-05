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

## Next safe action

Merge this follow-up into **branch2**, validate the exact merged SHA with the Branch2 safety workflow and Cloudflare deploy monitor, then continue the broader Return/Exchange UX review from the deployed Branch2 baseline. Do not merge to main yet.

## STOP CHECKPOINT — 2026-10-06

User asked to stop here and preserve context.

Current work branch: `w-return-exchange-ux-audit-20261005`  
Current branch HEAD: `fc14165a4fbc44095858621384a61af829658d9d`  
Latest Quality run on this exact HEAD: **37356472772 — success**.

Current Branch2 HEAD: `3bf3a5ef0f50872541b7bdcee6f5a9af370d14f2`.

Important branch topology at stop:
- audit branch is **ahead 32 / behind 5** relative to current Branch2;
- status is **diverged**;
- therefore **do not merge this audit branch directly into Branch2**.

The Return audit changes themselves are green, but before any merge they must be reconciled onto a fresh candidate from the current Branch2 head. Prefer a fresh Branch2-based candidate and intentional transfer of only the Return-audit delta rather than a wholesale merge/rebase that could drag stale branch history.

### Return-audit changes already implemented and green

- Return draft carries per-item `issuedToClient` truth.
- Never-issued goods cannot be submitted as physical Return rows, including pending/no-stock loopholes.
- UI explicitly marks never-issued goods as staying on site and directs pre-handover cancellation to **Edit order**.
- Money-only refund remains valid with item quantities left at 0.
- Workshop-origin delayed Return intake defaults to **no_stock** from both top queue and history.
- Return cancellation freezes Workshop restore targets before mutation and uses compare-and-swap style guards so retry/lost-response cannot restore quantity twice.
- Missing/concurrently changed Workshop dependencies are checked before stock lifecycle reversal.
- Already-cancelled retry repairs derived financial/workshop state before returning success.
- Direct regression: `scripts/test-return-unissued-physical-safety-r2.mjs`.
- Runtime-delta preservation is layered through `scripts/return-ux-audit-20261005-runtime-manifest.json` and predecessor fixtures.

### Exact next action after resuming

1. Open GitHub and verify current `branch2` HEAD again.
2. Create a **fresh branch from current Branch2**, not from this diverged audit branch.
3. Reconcile only the Return-audit runtime/test/doc changes from this checkpoint.
4. Run cumulative Quality on the fresh candidate.
5. Only after green Quality, open a Branch2-only PR.
6. Verify exact merged-SHA Branch2 safety/deploy.
7. Then do the manual Return acceptance scenarios listed below.
8. Do not touch main / Production unless separately requested.

Do not continue coding from `fc14165...` without first reconciling against the newer Branch2 head.

