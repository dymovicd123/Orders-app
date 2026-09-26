# Stage02 Phase2 — Stock Truth Model

> **STATUS UPDATE — 2026-09-26:** Phase2A–2E are complete. The reviewed Stage02 state plus post-review fixes were promoted to Production through PR #145. This file remains the canonical **stock-truth semantics** document, but old execution checkpoints that describe Phase2C/2D/2E as upcoming/current are historical and must not be treated as the present roadmap. Current project status lives in `PROJECT_CONTINUATION.md`.


Date: 2026-09-19


## Execution checkpoint — 2026-09-19

- Phase2A truth primitives + `inventory_operation_evidence` are complete in both `branch2` and Production.
- Phase2B final-shipping possession resolver is complete in both `branch2` and Production.
- Phase2C is the current implementation step on `w-stage02-phase2c-early-handover-20260919`: reuse the same `stock_resolution_required` contract for `issue_now`, keep `still_here / issued_before_checkpoint` lineage separate, bound source Physical at zero, and record shortage evidence as `operation_type='handover'`.
- After Phase2C, continue in `branch2` with Phase2D transfer/writeoff and Phase2E Attention-dependency removal + Stage02 acceptance.
- **User review gate:** finish the remaining Stage02 work in `branch2` first. The user will inspect all Stage02 updates there and report product/UI objections before any further Production promotion of Phase2C+.
- Continuation protocol: after every meaningful Stage02 implementation/CI/merge/deploy finding, update this document plus `WAREHOUSE_CURRENT_CONTEXT.md` and the root `PROJECT_CONTINUATION.md`.


## Why Phase2 changed

The previous idea treated frequent small stock checks as the main way to keep Warehouse/Boutique truth healthy. That assumes employees will actually count a complete SKU position and report the total honestly while doing unrelated work.

We no longer assume that.

A user who only needs one or two units to finish an operation has a strong incentive to enter the number required by that operation instead of performing a real count. Therefore an operational resolver must never convert such an answer into an absolute physical stock count.

Phase2 is redesigned around **truth classes** and **bounded operational evidence**.

## Truth hierarchy

### A. Exact physical count — may replace Physical

Only an explicit counting workflow may authoritatively set the absolute physical quantity for a SKU/source:

- full stocktake;
- selective stocktake;
- quick/exact stock check where the employee was explicitly asked to count the whole SKU position;
- explicit admin physical correction that is itself presented as a count/correction workflow.

These actions may write an absolute `inventory_stock.quantity` because the user task is specifically to determine the total physical quantity.

### B. Exact transaction delta — may change Physical by the proven delta

When the employee's direct job is itself the physical movement, that movement is reliable evidence of the delta:

- explicit return intake into Warehouse/Boutique => known inbound +Q;
- transfer => known outbound Q from source and known inbound +Q to target;
- customer issue/shipping => known outbound Q;
- writeoff => known outbound Q.

The system may apply the proven movement, but it must not infer an unknown starting total from it.

### C. Operational possession evidence — may unblock the operation, but may NOT replace Physical

If the system believes there are fewer units than the operation requires, the only safe contextual question is about the units being handled now, for example:

> Для операции нужно 2 шт. Эти 2 вещи сейчас физически у вас?

A positive answer proves only that at least those units exist and are being handled. It does **not** prove how many total units were on the shelf.

Therefore this answer must never be stored as `counted_quantity` in `inventory_stock_checks` and must never set an absolute stock quantity.

For an outbound operation with current system Physical=P and confirmed operation quantity=Q:

- apply only the known outbound against tracked stock, never below zero;
- track the portion that could not be explained by the tracked Physical as operation evidence/discrepancy;
- complete the business operation only once;
- never synthesize a full pre-operation quantity.

For transfer, the target may still receive +Q because the arrival of Q units at the target is directly observed by the transfer itself.

### D. System inference — may signal risk, never mutate Physical

Examples:

- Physical < Reserved;
- old unresolved lifecycle evidence;
- stale/contradictory history;
- a previous operation handled more units than tracked stock explained;
- no exact count for a long time.

These may help prioritize a real revision or explain a contextual blocker. They are not physical truth and must not rewrite stock.

## What Stock Resolver is now

Stock Resolver is **not** a mini-stocktake.

It is a narrow operational resolver used only when the current physical operation cannot be completed from tracked stock truth.

It asks about the concrete units involved in the current action, not the total SKU count.

Approved insertion points:

1. **Final order shipping**
   - Client: `src/App.tsx -> markOrderSentToClient()`
   - Server: `PATCH /api/orders/:id/shipping`
   - Fulfillment: `worker/domains/order-reservations.ts`
   - Trigger only when required outbound quantity exceeds tracked physical truth.
   - Answer: confirm whether the required units are physically present for this shipment.
   - Do not ask for total shelf quantity.
   - Successful answer resumes the same shipping action automatically.

2. **Early stock handover / issue_now**
   - Server route: `/api/orders/:id/stock-handover`
   - Existing lineage question (`still_here` / `issued_before_checkpoint`) remains a separate concept.
   - Stock Resolver appears only when the actual issue requires more outbound units than tracked physical truth.
   - Successful answer resumes the same `issue_now`.

3. **Warehouse <-> Boutique transfer**
   - Client: `src/App.tsx -> saveInventoryMovement()`
   - Server: `worker/domains/inventory-movement.ts -> applyInventoryTransfer()`
   - If Q to move exceeds tracked source Physical, ask only whether those Q units are physically being transferred now.
   - Source must never be forced negative.
   - Target receives +Q because the transfer proves the inbound quantity.
   - The unexplained source difference is recorded as operation evidence, not as a fake stocktake.
   - A warning that the transfer will leave reservations short is a separate business warning, not a Stock Resolver question.

4. **Manual writeoff**
   - Same operational principle as transfer.
   - If Q to write off exceeds tracked Physical, require concrete confirmation that Q physical units are being written off now.
   - Do not replace the whole SKU count.

Not approved as Stock Resolver insertion points:

- return/exchange intake: explicit destination +Q is already a known transaction fact; identity ambiguity belongs to the existing catalog/lifecycle resolver;
- quick/full/selective stocktake: these are already exact counting workflows;
- manual_set/admin physical correction: this is already an explicit absolute correction;
- Arrival: frozen and out of Stage02 scope;
- routine proactive prompts merely because an SKU is old/unverified.

## Operation evidence record

Phase2 should not abuse `inventory_stock_checks` for contextual confirmations because those rows mean an actual count of the SKU.

Introduce a small append-only operation-evidence record only when an operation exceeds tracked Physical. Exact schema may be finalized in implementation, but the semantic minimum is:

- inventory source;
- variant id;
- operation type/reference/id;
- tracked Physical before the operation;
- operation quantity confirmed physically present;
- quantity not explained by tracked Physical;
- actor;
- timestamp;
- idempotency/evidence key.

This is **not an Attention ticket**. It is audit evidence.

A later exact stock check for the same source+variant supersedes older operation evidence naturally. No employee must manually "resolve" the evidence row.

## Physical mutation rule for unexplained outbound

If current tracked Physical is P and an outbound operation of Q units is explicitly confirmed:

- tracked source Physical after the operation = `max(0, P - Q)`;
- unexplained handled quantity = `max(0, Q - P)`;
- never write a negative Physical;
- never set Physical to Q before subtracting;
- never pretend the employee counted the full SKU.

For transfer:
- source follows the bounded rule above;
- target gets +Q exactly;
- if `Q > P`, the system has learned that previously untracked stock physically existed at the source and is now tracked at the target. The discrepancy remains auditable instead of being hidden by a fabricated source count.

## Reservations and Available

Reservations remain promises, not Physical.

- `Physical` never becomes negative merely to satisfy a reservation.
- `Available = Physical - Reserved` may be negative and may signal shortage.
- A resolver-confirmed outbound may fulfill the concrete reservation even when tracked Physical was insufficient, while the unexplained portion is recorded as evidence.
- This must not silently make unrelated reservations look physically satisfied.

## Attention

Warehouse Attention is no longer a required work inbox.

Every current Attention class must be treated as one of:

- actionable in the current workflow => move/keep the resolver at the point of action;
- exact-count work => revision/stocktake;
- identity ambiguity => Catalog Resolver / lifecycle resolver;
- derived diagnostic => admin diagnostic only.

No ordinary business operation may depend on a user voluntarily opening Attention.

Do not delete the diagnostic endpoint/UI until all signal classes have been mapped and their operational dependencies removed.

## Phase2 implementation order

### 2A — Truth primitives + evidence model
- define one shared server-side result contract for `stock_resolution_required`;
- add append-only operation evidence;
- add bounded outbound helper semantics;
- no user-facing proactive prompts yet.

### 2B — Shipping
- replace the current "enter total physical count" shortage prompt with possession confirmation;
- never write it as an exact stock check;
- automatically resume the original shipping action;
- preserve replay/idempotency guarantees from Catalog Resolver R9/R10.

### 2C — Early handover
- reuse the same resolver contract for `issue_now`;
- keep historical checkpoint/lineage questions separate.

### 2D — Transfer and writeoff
- reuse the same possession-confirmation resolver;
- transfer target receives exact +Q;
- source uses bounded outbound;
- reservation-shortage warning remains separate.

### 2E — Attention dependency removal + acceptance
- prove no daily flow depends on Attention;
- retain only useful admin diagnostics;
- verify no operational confirmation is recorded as an exact count;
- verify exact stocktake remains authoritative over older operation evidence.

## Acceptance invariants

1. Operational confirmation never overwrites the full SKU Physical.
2. Only explicit counting/correction workflows may set an absolute Physical.
3. Physical never goes below zero merely because an operation exceeds tracked stock.
4. Confirmed transfer still adds the exact transferred quantity to the target.
5. Shipping/handover/writeoff may complete only for the concrete quantity explicitly confirmed present.
6. Unexplained outbound quantity is durably auditable and idempotent.
7. Replay/lost response cannot duplicate either the business operation or its evidence.
8. A newer exact physical count supersedes older operation evidence.
9. Attention is not required to finish normal Warehouse/Boutique work.
10. Return/exchange explicit intake remains transaction truth, not a stock-count prompt.
11. Catalog/identity ambiguity stays separate from physical-quantity ambiguity.
12. Arrival remains untouched.


## Checkpoint 2026-09-19 — Phase2D micro-step mode

- User requested that Stage02 continue in small, bounded steps rather than large bursts, to avoid losing progress to response/tool time limits.
- Current working branch: `w-stage02-phase2d-transfer-writeoff-20260919`.
- Current branch head when this checkpoint was written: `4e8e9103199ef6a01b5934eb4bc41b5e670fcbda`.
- Phase2C changes are already included in this branch; current work is Phase2D transfer/writeoff transactional possession handling.
- The latest GitHub Actions attempt is blocked before project checks by an external npm registry audit HTTP 503, so that failure is not yet evidence of a project regression.
- Continue with one narrow verification/fix at a time, report it, then proceed to the next micro-step.

- Phase2D micro-step: fixed legacy negative Physical handling in transfer. Source/target quantities are normalized to >= 0 at the transaction boundary; stale guards and retry diagnostics use the same semantics; transfer-in applies exact +Q from a non-negative baseline. This prevents an infinite resolver loop where the UI confirms expectedQuantity=0 but the server compares it to a legacy negative value. Regression assertions were added in `scripts/test-stage02-phase2d-transfer-writeoff-possession-resolver.mjs`. Commits: `c9e05d981be22ece8fda70aedf3d8d6edec2e06e`, `6a0cdd6d234cb234b6dd5f62cb41fbdf9bed9c52`.

- Phase2D micro-step: verified transfer resolver idempotency. A committed `request_id` is checked before stock-confirmation/resolver validation; resolver confirmations are not part of the transfer fingerprint; `inventory_transfer_documents.request_id` is UNIQUE; concurrent identical retries recover through the winning document; transfer items and operation evidence also have uniqueness guards. Added regression assertions and registered the Phase2D test in `scripts/release-check.mjs`. Commits: `d191ad47e7978682a22809997f52b7ee2c8bea59`, `e9da8aef051b2b9acc4129c1cef03e9ff0d9d42f`.

- Phase2D balanced checkpoint: writeoff resolver now uses the same bounded legacy-negative semantics as transfer, so old negative Physical is treated as 0 only for writeoff operation confirmation/replay while exact manual correction semantics stay unchanged. Writeoff retry/idempotency invariants are covered: committed `operation_id` short-circuits before resolver validation, confirmations are excluded from the request fingerprint, concurrent identical retries converge on duplicate success, and evidence keys remain unique. The Phase2D regression itself is green. CI then exposed the expected structural-preservation layer mismatch from Phase2D edits; added exact Phase2D Worker/frontend manifests and outer normalization layers for Step 190.6A/190.6B. Relevant commits: `25d6eb160c2f348dc652201bc30409686beaea33`, `01c3d517234a63d19a7321e8cb5cf0681ff0c1c0`, `1d9ed76857ae8d7892b4a693c917599091c2f3b9`, `f05ecdb5ee8aa358495e4af48caaec18044860f1`, `2dd0562500653ba87eb337bf317d85012ad3b126`, `aa10952a4c09f53616cc3f05af2b16299a23f117`. Latest full Quality run for the final structural-layer commit is still in progress at this checkpoint.

- Phase2D completion checkpoint: combined transfer + manual writeoff resolver audit is green. Additional correctness fixes found during final review: transfer reversal now restores only the source Physical delta that the forward transfer actually deducted (the explained portion), while destination reversal still removes exact Q; zero/negative tracked writeoff rows remain selectable so the possession resolver is reachable instead of being hidden by the UI; duplicate manual-movement retries no longer emit duplicate activity-log events; Worker route result narrowing is explicit and TypeScript-safe. W4/W8.4 legacy acceptance assertions were updated to protect the new bounded-possession flow instead of the retired full-count prompt. Full Quality run `35459453380` succeeded on code head `106a0dc9e849b1643d12a5f499e797f6beb694b4`. Phase2C is still stacked underneath Phase2D and neither is in production. Next repository action is to merge the combined Phase2C+Phase2D branch into `branch2`; production remains blocked until the user's full Stage02 review.
