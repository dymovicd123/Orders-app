# Manager autonomy — order price correction, exchange/return dependency roadmap (2026-10-17)

## Scope / invariant
Correct **recorded information**, not actual money or physical inventory. The UI may never recommend deleting and duplicating an order to fix a typo. A separate correction must be traceable (old/new, actor, timestamp, idempotency). The original exchange execution plan is **immutable**. Cancellation uses physical lifecycle history and separately verified price corrections.

## Coverage matrix (NOT a claim of E2E acceptance)
| Case | Current evidence | Status |
|---|---|---|
| Ordinary itemized order line (active/closed/handed over) | Branch2 PR #452 | component CI passed |
| Unrelated line while other lines have Returns/Exchanges | Branch2 PR #452 | component CI passed |
| Line with independent standalone Return | Branch2 PR #453; return remains intact | component CI passed |
| New V2 Exchange line, active qty > 0 | PR #454 guarded correction provenance | code candidate; DO NOT MERGE until schema and E2E |
| Old V2 Exchange line, qty 0 (fully retired) | Stacked PR #455: immutable old-role price ledger; no changes to active order, money or stock; cancellation restores confirmed price if financially safe | Candidate; isolated SQLite pass, full-chain E2E pending |
| Old V2 Exchange line with nonzero remaining qty (partially exchanged) | Stacked PR #456: price-only manager action updates live remainder quantity × corrected price; role='old' correction ledger and exchange cancellation preflight restore exchanged quantity at approved price | Candidate, isolated SQLite/full historical CI required; no DB migration applied |
| Multiple sequential V2 Exchanges | Dependents, current values and cancellation order | NOT IMPLEMENTED |
| Legacy single Exchange old/new | Separate legacy cancel path | NOT IMPLEMENTED |
| Item returned after Exchange | Return must be unwound before exchange cancellation; preserve money+inventory | NOT IMPLEMENTED |
| Exchange refund and additional payment | Actual receipt/refund immutable unless correcting a wrong bookkeeping record through an independent action | NOT IMPLEMENTED |
| Correction that creates overpayment or already inconsistent totals | Fail-closed, no automatic refund | Partially checked; E2E pending |
| Employee cancels erroneous Return/Exchange | Explicit action with safe preview and accurate ownership | NOT IMPLEMENTED |
| Admin safely deletes erroneous order with multiple related operations | Atomic/saga cancellation chain, no partial data changes | NOT IMPLEMENTED |

## Required schema/rollout
PR #454 introduces migration 0110 (immutable exchange-order-line price provenance). This schema must be applied **to branch2's isolated D1 first**, before deploying Worker code that allows exchange-linked corrections. Do not run it on production without explicit separate authorization. No automatic merge of main and branch2.

## Final acceptance chain — run ONLY after above cases exist
1. Create regular itemized order; record prices/payments/reserves, correct a typo in an unrelated line.
2. Ship/confirm old order; open Exchange Set V2 (multiple old/new lines, one to many, repeat a SKU); verify physical count, reservation count, immutable creation plan.
3. Correct recorded new-line and historical old-line prices with CAS; record actor and before/after, preserve actual cash/return and stock; retry same request id and stale client snapshot.
4. Exchange newly received line again, then process a partial Return; verify correct available quantity and safe cancellation order.
5. Cancel Return, then later Exchange, then earlier Exchange. Reconcile restored pricing, original/existing corrections and all order totals. Confirm no double stock decrement, no over-return and zero orphan payments/reversals.
6. Repeat under legacy one-to-one Exchange, active and inactive variants, archived/deleted, under manager/admin roles.
7. Simulate failure after each operation checkpoint; replay with same idempotency request; ensure no duplicate cash or stock movement and audit ledger remains immutable.
8. Admin delete preflight must show every dependent exchange/return/payment impact and either execute safely or block before partial mutation.
9. Independently query **branch2 D1** for actual totals and event chain, and manually check manager UI. Do not use production data for destructive tests.

Current status: PR #454, stacked PR #455 and stacked PR #456 are separate, **not yet merged or deployed**. Migration 0110 is required for all exchange-linked price corrections and is not applied to branch2 D1. This coverage matrix is not proof of end-to-end cancellation safety. No production changes.
