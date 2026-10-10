# Corrected SKU merge undo — read-only preparation (2026-10-10)

## Why the additive undo writer is not sufficient
Original catalog consolidation may have applied a physical correction using keep_source / keep_keeper / physical_count rather than a pure sum. The saved historical split cannot safely be replayed: the authoritative merged balance may differ from the two previous numbers. A reversal must never invent additional physical units, turn old guesses into new stock, undo an already audited correction without proof or rewrite historical customer orders.

## Delivered in this checkpoint
GET `/api/catalog/variants/consolidation-undo-corrected-review?consolidationId=…` is admin-only and **READ ONLY**. It uses the complete original undo preflight, then validates the exact original per-location correction movements against the immutable physical decision ledger: location, keeper SKU, signed delta, final quantity, reference and original timestamp, plus the number of required corrections.

The result separates *historical source and keeper counts*, *authoritative combined final count*, and *unfilled manual split amounts*. No default/preselected split is permitted. It records a state token covering exact current stock snapshots, correction-movement evidence, original preflight and any later merge generations.

It refuses eligibility if original reservations/customer links existed, later customer or inventory changes are present, stock rows have post-merge updates, corrected movements differ from the original ledger, any audit/stock topology is incomplete, or a prior undo/remerge generation exists. Only a corrected merge with intact original proof and no later activity may display `canPrepareCountedSplit=true`. This is eligibility **to prepare** a future explicitly counted split, not permission to write inventory.

## Implementation intentionally deferred
Before enabling the write action, build a new additive/immutable schema and an atomic CAS writer that requires an explicit physically verified source-and-keeper allocation **for every location**. Each pair must sum to its actual current combined quantity; both values must be nonnegative integers; source/keeper identities, timestamps, audit and all operational dependencies must be rechecked inside the transaction. A final SQL proof must roll back everything on any mismatch. Where original reservations were moved, later events exist, or keeper stock rows were newly materialized, route to a separate case-review workflow; do **not** automatically reassign orders or use a physical split to repair financial history.

Status: only admin diagnostic prepared in separate Branch2 PR; main/production untouched; no migration or inventory mutation in this checkpoint.
