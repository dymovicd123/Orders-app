# Catalog Integrity R1 — 2026-10-09

Source: `main` at `c840feb0bc`. Branch: `ci-catalog-integrity-r1-20261009`, separate from Stage04 `branch2`.

**Delivered in R1:** central **Справочники** shows all reference kinds, while working context shortcuts remain. Reference values use the same punctuation-insensitive color identity as Catalog/Arrival/Stocktake. Adding semantically equivalent active values reuses existing ID instead of duplicating it; explicitly re-adding an inactive value restores that existing ID. Renaming a reference to an already-existing legacy equivalent remains rejected. Color reference checks accept punctuation-equivalent active references. Removal errors propagate concrete reasons to the UI.

**Not done in R1:** applying any DB migration, silent merging of existing SKU/reference duplicates, touching stock/orders/payments, redesigning Writeoff, or deploying Production. Current Production audit: one reference duplicate color (`СВЕТЛО СЕРЫЙ` / `СВЕТЛО-СЕРЫЙ`), two semantic duplicate Ethno Cardigan SKU pairs (drap, 52 and 54), both pairs have zero physical stock now; separate drap from wool. Production uniqueness still compares raw spelling and requires a later schema migration after safe cleanup.

**Next:** build an administrator-friendly impact preview for reference and SKU merges, then safe transactional consolidation with stable survivor identity, conflict detection, history and post-operation invariants. Finally enforce canonical uniqueness in D1 after reconciliation. Keep operator flows non-blocking for obvious equivalent spellings. Writeoff UI postponed as requested.

## R2 read-only reference consolidation preview
- Added admin-only endpoint `GET /api/reference-values/duplicates`. Group existing same-kind entries by exactly the shared punctuation/whitespace identity key, even if inactive.
- Added admin-only endpoint `GET /api/reference-values/consolidation-preview?sourceId=...&targetId=...`: check canonical identity, target active, inspect affected catalog variants, material/length executions, current physical and reserved quantities. Bounded result and explicit truncated warning.
- Added `Порядок в справочниках` in centralized references: explicit user-triggered scan and per-duplicate preview, avoiding heavy reads on page load.
- **No endpoint for merging yet**, no write SQL in preview module; never silently transfer inventory, modify orders, rewrite history or collapse actual different materials.
- Current catalog products may have two active variants with same business identity: safe reference removal must wait until a verified SKU merge workflow exists.

R2 work continues on branch `catalog-integrity-r2-20261009` to prevent redundant full CI on every incremental `ci-*` push. The original R1 branch is preserved. Historical exact-SHA CI gate currently fails with intentional newer source edits; focused test/build does not replace full gate.

R2 also lists active Catalog SKU duplicates using exact product, execution ID, category, gender, canonical color, and size. Read current stock and reserved quantities without modifying them. Ethno cardigan drap and wool never merge by this check. This is read-only and user-initiated to conserve D1 rows.

R2 guarded admin action: only a reference value with **no active Catalog variants, no material/length executions, no physical stock or reservation** may be marked inactive in reference_values using a single atomic conditional UPDATE that rechecks targets and current source usage. Historical orders/variants, materialized inventory, quantities and customer money are never changed by this operation. Duplicate cleanup is reversible by normal admin reference activation. Full SKU merges remain a separate stage.

R2 executable SQLite acceptance covers active SKU, inactive SKU with nonzero stock, active material execution, stale-preview concurrent SKU creation, idempotent replay and preserved stock/variant rows. No existing business data is modified by the test.
