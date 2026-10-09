# Catalog/reference consolidation — backend closure ledger

Date: 2026-10-09. **Priority: correct mechanisms and code first; existing reference-merge UI is unsatisfactory and must be redesigned later.** Do not polish UI as a substitute for data correctness.

## Existing confirmed mechanisms

- City and delivery reference consolidation: source/keeper selected by admin; current Kazakhstan calendar month orders; old orders unchanged; token and transactional audit.
- Payment method classification correction: guarded present-month orders and linked financial records; cash/Kaspi store exclusions; money and dates immutable; original classification journal.
- Exact-business-identity Catalog SKU consolidation: atomic per-location physical quantity and reservation transfer, live order pointer reconciliation, durable audit and CHECK-constrained rollback. Blocks reversible stock events, active stocktake, exchange/return links, unresolved lifecycle, workshop, inconsistent reservations.
- Equivalent spelling of colors: limited pair discovery, invokes the above guarded SKU endpoint one pair at a time; no blanket renaming.
- Unused reference retirement: soft-hide with historic rows untouched.

## Backend hardening in PR #326

1. All SKU consolidations now require a confirmed state token **even with zero physical stock and zero reservations**. Reject API calls with no token.
2. Material and length edits/deletions now account for active standalone stock executions, and inactive variants still carrying physical/reserved stock block reference changes.
3. Characteristic CRUD updates and deletion have SQL-side matching-value, kind, active-state and linked-SKU/stock-position conditions to stop new-link races between preflight and commit.
4. Exchange batch rows (`exchange_items.order_item_id`) are now included in both the read-only SKU impact and atomic blocking SQL; otherwise a future exchange cancellation could restore stock against a retired SKU.
5. Added focused SQLite regression and cumulative Stage04 gate; do not weaken these gates for deployment.

## Still unsupported — must NOT be advertised as solved

| Scenario | Reason it remains blocked |
|---|---|
| Different actual colors reclassified to a keeper color | New stock identity and possible collisions; require full SKU map + per-order reference semantics and reversible audit |
| Adult size 52 to 54; child ages 1 to 2 | Different physical goods; never treat as semantic duplicates automatically |
| Material/length merge with differing physical executions | Execution identity distinct; inspect catalog_stock_positions, active stock, reservations, workshop, order commitments, returns, undo and future arrivals |
| Return and writeoff reason merge | Source strings may be embedded in historical notes/comments rather than stable reference IDs; audit identity and current-month boundaries before writing |
| Already shipped, returned or exchanged orders | Preserve legal/financial snapshots and correction/undo semantics; do not silently repoint historical SKU |
| Reversible inventory movements, transfers and active stocktake | Require a compensating, transactionally validated method, not a silent SKU pointer update |
| Bulk all-catalog changes > bounded inspection size | A truncated preview is a **blocker**, not confirmation that there are no remaining links |
| Undo wrong SKU consolidation | Must account for subsequent stock activity and order/reservation mutations before any reversal; manual undo is not safe by default |
| Exact name duplicate with separate reference IDs | Catalog references carry text, not reference IDs: do not claim to know the source identity for any matching SKU |
| Concurrent order edits, arrivals, revisions or reference creation | Must revalidate snapshot and authoritative state at D1 write boundary |

## Acceptance requirements for future cross-characteristic writer

- Isolated branch2 database, real-schema migration rehearsal with independently recorded D1 receipts, never main/prod.
- Every current-month order with affected live inventory identified; older snapshots unmodified. No partial status changes.
- Source/keeper elected by admin; collision plan per SKU/location before mutation. Zero net change in physical stock, reservations and money.
- Stale preview rejection, idempotency, 100% postcondition conservation checks, atomic rollback on any failure, immutable source-to-keeper audit.
- Workshop active/pending/applied tasks, exchanges/returns and reversal implications explicitly handled or **blocked with a useful reason**.
- High-load/limit and multi-manager concurrent updates simulated, security/perms and CSRF boundary reviewed.
- Tests for hidden/reopened reference values, mixed category (adult vs child), same text but distinct ID, material execution collisions, zero stocks, stale token, replay.
- Only after all backend checks pass should a separate UI task replace the technical merge interface. Normal browsing/adding values remains visually primary.
