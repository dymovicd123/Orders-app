# Catalog Integrity R1 — 2026-10-09

Source: `main` at `c840feb0bc`. Branch: `ci-catalog-integrity-r1-20261009`, separate from Stage04 `branch2`.

**Delivered in R1:** central **Справочники** shows all reference kinds, while working context shortcuts remain. Reference values use the same punctuation-insensitive color identity as Catalog/Arrival/Stocktake. Adding semantically equivalent active values reuses existing ID instead of duplicating it; explicitly re-adding an inactive value restores that existing ID. Renaming a reference to an already-existing legacy equivalent remains rejected. Color reference checks accept punctuation-equivalent active references. Removal errors propagate concrete reasons to the UI.

**Not done in R1:** applying any DB migration, silent merging of existing SKU/reference duplicates, touching stock/orders/payments, redesigning Writeoff, or deploying Production. Current Production audit: one reference duplicate color (`СВЕТЛО СЕРЫЙ` / `СВЕТЛО-СЕРЫЙ`), two semantic duplicate Ethno Cardigan SKU pairs (drap, 52 and 54), both pairs have zero physical stock now; separate drap from wool. Production uniqueness still compares raw spelling and requires a later schema migration after safe cleanup.

**Next:** build an administrator-friendly impact preview for reference and SKU merges, then safe transactional consolidation with stable survivor identity, conflict detection, history and post-operation invariants. Finally enforce canonical uniqueness in D1 after reconciliation. Keep operator flows non-blocking for obvious equivalent spellings. Writeoff UI postponed as requested.
