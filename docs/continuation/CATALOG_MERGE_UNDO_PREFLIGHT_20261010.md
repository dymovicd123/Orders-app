# Catalog merge undo impact — Stage R1 (2026-10-10)

**Admin-only, read-only. Never claim a one-click undo is safe merely because the old quantities are known.** This preview identifies whether a **future compensated restoration** is even a candidate. All live staff operations remain enabled; no temporary locks.

GET `/api/catalog/variants/consolidation-undo-preview?consolidationId=<id>`.

## Grounded evidence
Read the immutable `catalog_variant_consolidations` receipt, its original per-location `catalog_variant_consolidation_stock_rows`, independently confirmed `catalog_variant_consolidation_stock_decisions` (0096), and both successful stock/reservation validation receipts. Show before/after quantity of each warehouse/boutique row and the original inventory choice. Compare current source and keeper rows with their original journal IDs, amounts and lineage marker.

Reject a naive automatic reversal if:
- The retired source / active keeper identity changed, audit incomplete, choice or physical correction movements missing;
- A newer active order or reservation, stock movement, physical count, active workshop/stocktake, pending/applied lifecycle, transfer, return or exchange can alter downstream accounting;
- A newer SKU merged into the keeper, the source is keeper for another consolidation, or keeper itself got merged;
- Original consolidation redirected **any** active reservation/order, because reversing those pointers is a separate obligation-aware operation;
- Either stock row no longer agrees with the journal, unexpectedly changed topology, or keeper stock row was created *by the merge* (would require independently audited safe row removal).

Even in the cleanest case, `canUndoNow=false`; `potentialCompensationCandidate` means only that detailed safeguards *might* support a **future** compensating transaction. It is not a permission to mutate, and neither source variant nor historic order identity is changed by preview.

## Next delivery (must be tested before enabling)
A compensating reversal requires an append-only reversal receipt, a new preview token covering stock/variant and obligation versions, independent physical inventory confirmation for any non-additive original decision, postcondition-driven atomic D1 batch, and lineage-aware guard logic. The existing UNIQUE(source_variant_id) means a reversed historical receipt must remain queryable while making a future new consolidation an explicit new generation; do not delete/overwrite the history or pretend a manual quantity change was a sale.

Run the full frozen historical release gate and test this diagnostic against postmerge orders, reservations, movements, physical counts, linked merges, missing decision receipts and stock drift before deployment.

No main/production changes; no employee-facing UI changes.
