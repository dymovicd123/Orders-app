# Arrival on a SKU merged while the form stayed open — 2026-10-10

**Employee mobility principle:** do not suspend arrivals or prevent sales during the administrator's SKU review. A merge occurs only on its own atomic confirmation. Once completed, new inventory must go to the audited canonical SKU; no duplicate physical inventory record may be created under the retired source.

## Backend change
- For Arrival only, after resolving current active variants, inspect explicitly selected stale IDs.
- When the old ID has an **audited** `catalog_variant_consolidations` receipt, resolve its same-product lineage through `resolveConsolidatedOrderWriteVariant` to an active canonical SKU. Re-read current canonical product/variation facts from the DB, then treat it as a normal Arrival item.
- Preserve original entered quantity and operation request id; the canonicalization pass collapses repeated old/new aliases into **one keeper stock update**, rejecting contradictory quantities.
- The existing retired-product and genuine retired-unmerged SKU recovery choices remain unchanged. Do not revive them based on name similarity.
- Three new D1 SQLite triggers, migration 0098, reject an *INSERT*, physical/reserved quantity *UPDATE*, or *variant reassignment* to a **permanently inactive consolidated source SKU**. The keeper and all unrelated active SKUs remain unrestricted. This closes the race where an admin merge commits after the Arrival snapshot but before the inventory stock mutation.
- Existing front end unchanged; eventual separate UI pass will make the recovery explanation and keeper identity visible.

## Guarantees and remaining limitations
- Source→keeper comes from the same reviewed physical identity receipts as the atomic merge; never move inventory between different products, executions, colors or sizes guessed by text.
- No generalized long-lived lock; all normal active catalog arrivals, reservations and orders work.
- No main/production changes. Data migration installs only three triggers on isolated Branch2, fingerprints order counts/amounts, payments, physical/reserved stock, historical movements and Stage04.
- This patch addresses **explicit selected stale SKU arrivals**; non-SKU manual materialization uses its existing semantic catalog resolver. A confirmed old SKU may still require user retry if the merge races with its very last database write; the form and its input must not be silently lost.
- Comprehensive reversal after later stock movements and full cross-characteristic merges remain separate hard problems; do not claim they are solved.

## Testing
`scripts/test-arrival-merged-sku-safety.mjs` covers receipt-based resolution, live keeper arrival, stale-source stock write rejection, unrelated active SKU mobility, ordinary retired product recovery and static placement before Arrival picker. Complete legacy Stage04-safe release gate restores exact pre-change inventory worker fixture. Schema 0098 workflow checks live isolated data fingerprints.
