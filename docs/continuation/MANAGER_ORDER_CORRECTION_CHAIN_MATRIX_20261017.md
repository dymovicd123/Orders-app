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
| Multiple sequential V2 Exchanges | Stacked PR #457 read-only chain dependency graph, earlier/later Exchange and Return order, legacy fallback links, cycle and ambiguous refund blocking; it performs NO cancellation | Preview candidate; actual chained cancel/price E2E NOT COMPLETE |
| Legacy single Exchange old/new | Separate legacy cancel path | NOT IMPLEMENTED |
| Item returned after Exchange | Return must be unwound before exchange cancellation; preserve money+inventory | NOT IMPLEMENTED |
| Exchange refund and additional payment | Actual receipt/refund immutable unless correcting a wrong bookkeeping record through an independent action | NOT IMPLEMENTED |
| Correction that creates overpayment or already inconsistent totals | Fail-closed, no automatic refund | Partially checked; E2E pending |
| Employee cancels erroneous Return/Exchange | Explicit action with safe preview and accurate ownership | NOT IMPLEMENTED |
| Admin deletion: preview all active Exchanges/Returns and money/stock consequences | Stacked PR #458 admin-only impact dialog and early block on linked operations; removes legacy non-atomic auto-cancellation | Candidate; linked deletion fail-closed; E2E pending |
| Admin deletion: full dependency ordering and stale approval | Stacked PR #459 composes ALL active operations, generated refunds owned by their Exchange, SHA-256 fingerprint for current items/payments/returns/reservations. Blocks positive payments and inconsistent ledger | Candidate; read-only plan and SQLite tests; NO executor |
| Admin safely deletes erroneous order with multiple related operations in ONE action | PR #460 persistent saga and stacked PR #461 dormant REAL handler adapter (`cancelReturn`, `cancelExchangeSetV2`), per-step critical-operation verification and cash/physical blockers; no HTTP activation | Isolated SQL mocks and failure tests only; actual D1 handler + stock lifecycle E2E NOT IMPLEMENTED |

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

Current status: PR #454, stacked PR #455, stacked PR #456, chain preview PR #457, admin safety PR #458, full read-only plan PR #459, dormant saga PR #460 and V2 handler adapter PR #461 are separate, **not yet merged or deployed**. Migration 0111 for the journal has NOT been applied. Saga currently cannot execute from any Worker HTTP route and forbids unresolved payments/refunds. Migration 0110 is required for all exchange-linked price corrections and is not applied to branch2 D1. This coverage matrix is not proof of end-to-end cancellation safety. No production changes.


## Explicit blockers before staging branch2
- Exchange Set V2 cancellation must be exercised against its **actual** Worker+D1 implementation, not just injected handler mocks, including physical stock/transfer and revision chronology.
- Saga adapter deliberately refuses sent/fulfilled handovers and any payment, Return refund or Exchange financial action. These common customer orders still need a sanctioned actual-money and physical-truth reversal workflow.
- Legacy Exchange is excluded; never substitute `cancelExchange` silently for V2.
- Migrations 0110 and 0111 have NOT been run on branch2 D1. Their production binding must never be passed to a migration workflow.
- The one-click admin action remains disabled; no frontend or HTTP route invokes the saga. Full manual branch2 acceptance can only follow schema-first isolated migration and real D1 E2E.
