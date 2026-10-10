# Catalog & References — living continuation checkpoint (2026-10-10)

## Product decision (do not regress)

This workstream is the user's priority until fully stable; **do not rush or cut safeguards to return to Stage04**. Stage04 stays intact and resumes separately. User explicitly dislikes current technical merge/writeoff interfaces; **backend first, UI redesigned after safety**. System must help ordinary staff solve dupes without developer. Merging is rare admin maintenance, not daily inventory management. Never introduce long-lived staff/SKU locks or block active regular orders/arrival during review.

## Repo / boundaries

Repository: `dymovicd123/Orders-app`, base `branch2`; production is `main`. Do not transfer test database contents into production or vice versa. Isolated Cloudflare branch2 Worker/D1 only; read-only analysis unless safe tests/migrations explicitly scoped. Every PR must pass Quality, cumulative `Stage04-safe Catalog Integrity` gate, isolated schema fingerprint if needed, and **exact deployed public Branch2 asset verification**. No deployment completion claims before monitor green.

Most recent prior Cloudflare-confirmed deployment: **PR #333**, commit `d3b70fa27b64915ef69245171e2a301876c51157`, Cloudflare monitor `38035911689` success. **PR #334** merged to branch2 as commit `7634a7ba32ca92551d56bb858f6d588dff21b377`; it fixes same-day SQLite/ISO event comparison, edited orders, malformed date blockers and keeper-only locations for reversal eligibility. Confirm public Cloudflare monitor status before describing that merge as deployed. Main remains untouched.

## Implemented

- Central references workspace, duplicates detection, guarded city/delivery/payment remap limited to current-month operational orders; prior-month historical documents unchanged. Reference CRUD protection for used characteristic values including material/length active execution and dormant nonzero stock.
- Per-SKU warehouse/boutique preview: independent quantities, reservations and last trustworthy physical counts; five user decisions `sum`, `keep_source`, `keep_keeper`, `physical_count`, `defer`. No automatic truth guess.
- Exact-business-identity SKU merge only: same product, stock position, gender, category, canonical color, size, material and length. Physical decision per source-positive location, explicit verification; non-sum requires reason, no active customer obligations/reversible operations; entire consolidation/stock changes/receipt/line validation/source retirement is atomic. Ledger schemas 0090–0092 and 0096.
- Originally separate stock correction 0095 now **disabled as a write API** (PR331), because correcting while source remains active leaves duplication gap. Its immutable historic report remains. Zero/stale sources remain protected.
- Old order form: follow audited exact-SKU source→keeper if inactive and same product; insert-time SQL triggers 0097 reject stale active order/reservation use of retired source only. No long locks.
- Old arrival form: same exact-SKU redirect to active keeper; stock triggers 0098 reject stale stock inserts/updates on already-retired source. Normal active products unaffected.
- PR333: admin-only **read-only** `GET /api/catalog/variants/consolidation-undo-preview?consolidationId=<id>`. Compares original source/keeper physical and reserved balances, chosen per-place method, audit validation, later orders/reservations/movements/revisions, nested merges and current stock rows. It returns `potentialCompensationCandidate` and ALWAYS `canUndoNow=false`. No mutation or restoration path yet.
- Historical Stage04 and production remain separate and unchanged. New UI still postponed.

## Most important unresolved backend tasks (order)

1. **Compensated reversal**: protect actual business commitments and all postmerge operations. Read-only preview is prerequisite; not a write permission. Reversal cannot blindly reset quantities. Need immutable reversal receipt, state token, serial atomic D1 proof, explicit delta reason, physical evidence, source/keeper identity and stock checks, and proper treatment of order/reservation pointers.
2. **Multi-generation SKU lineage:** `catalog_variant_consolidations.source_variant_id` is UNIQUE; simply reactivating the old source breaks any subsequent remerge. Revocation must be compatible with source-to-keeper resolution and D1 order/inventory retired guards. Prefer a safe schema extension with explicit generation status; do not delete/overwrite first receipts.
3. **Timestamp bug closed in PR #334**: undo-preflight uses SQLite `julianday(...)` for all postmerge comparisons, examines `orders.updated_at` and rejects unparseable event dates; its tests cover space timestamps and stock on keeper-only locations. **Still** audit timestamps and downstream updates in any future compensation writer.
4. Recheck nested merge and stock audit detection; a new unrelated keeper stock row after merge may affect reversal eligibility even if source unchanged.
5. More characteristic merging: genuinely different colors/sizes/age/material/length and positions need per-SKU physical/commitment mapping, not text replacement or naive stock addition. Reason dictionaries/duplicate reference IDs have specific text-keyed ambiguity. Current >400 variant previews must not silently truncate.
6. Prevent duplicate creation, audit edit/exchange/return/revision/transfer paths for stale merged identity; preserve user-entered forms when operation invalidated by concurrent merge.
7. Full stable tests, idempotency/DB races/load security, then completely redesign technical References merge UI and writeoff UI. Rehearse in branch2 and get explicit user confirmation before main.

## Business rules

- Historical shipped orders must remain attributable to original SKU and amount.
- A correction decreasing physical stock below client reservations must show shortage, **never silently erase reserved customer commitments**.
- Per warehouse/boutique decisions may differ on the same pair, and different products may need opposite decisions despite globally aliased reference spelling.
- A user chooses canonical reference and canonical SKU; the system explains and calculates but never invents correct physical quantity.
- Prefer fail-closed **admin operation only**, not long-lived staff locks.
- Avoid claiming complete cross-characteristic consolidation/reversal unless complete and tested.

## Work progression

At each new task/checkpoint read this ledger, the latest undo preview and associated tests. Implement in separate feature branch, preserve Stage04 baseline and test receipts, update this ledger with merged PR and remaining gaps after verification.

## Current in-flight next phase: generation-safe compensated reversal foundation

The legacy `catalog_variant_consolidations.source_variant_id` has a UNIQUE constraint, so an unrecorded "undo" followed by remerge of the same SKU would fail or destroy history. This phase adds an **additive, append-only generation-events table and read-only effective lineage projection**, with tested alternating undo/merge events and same-product checks. The view is preparation: until a completed audited atomic undo writer and its safe rollout, no production write route uses it and **there is no enabled SKU undo**. Apply any new migration exclusively to branch2 after verifying isolated D1 fingerprints, and keep existing exact-SKU source→keeper resolution unchanged until a schema-first rollout. Never allow an operator to append an "undo" event manually without compensating stock/reservation audit in one transaction.

Key acceptance before enabling actual compensated reversal: original and current stock row fingerprints, zero or deliberately settled customer obligations, postmerge movements/timestamps, active child/target lineage, reason+actor, idempotent compensation receipt, validated same-batch rollback, no unguarded live SKU acceptance during change, preservation of old shipped order snapshots, and a safe future re-merge generation.
