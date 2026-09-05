# W3.1B — Voluntary concrete stock micro-check

Date: 2026-09-05
Code base: W3.1A Production tree (`W3.1A: restore Warehouse operational reliability`)

## Goal

Let an ordinary Warehouse employee verify one concrete stock position directly from `Остатки` without first loading the recommendation engine, Warehouse Attention, reservations, catalog data, or any other extra D1 read merely to display the check.

## Human flow

- A concrete single position or expanded variant exposes `Проверить` instead of forcing `Подробнее` first.
- Opening `Проверить` uses the row already present in the stock snapshot; it performs no network/API read and no mutation.
- Normal non-negative system quantity offers:
  - `Да, на месте N` — one-click confirmation through the existing CAS-protected quick stocktake endpoint;
  - `Нет, другое количество` — explicit factual count.
- If the system physical quantity is below zero, one-click confirmation is intentionally unavailable; the employee must enter the real non-negative physical fact.
- `Подробнее о позиции` remains available as a deliberate second action. Only then can the normal detail flow load reservation/order context if needed.

## Technical changes

- `renderInventoryOverviewPanel.tsx`
  - builds the micro-check detail from the already-loaded stock row;
  - does not call inventory/Attention/reservation loaders when the check opens;
  - keeps the normal full detail drawer unchanged behind `Подробнее о позиции`;
  - no React hook/lifecycle added to the renderer.
- `useInventoryAttentionActions.ts`
  - `applyQuickStocktake` accepts an optional exact counted quantity for the one-click same-count confirmation;
  - the write still uses the existing `expectedQuantity` compare-and-set guard and existing quick-stocktake endpoint.
- `scripts/w3-1b-stock-micro-check-frontend-manifest.json`
  - records the exact accepted `renderInventoryOverviewPanel` return delta after W3.1A.
- `scripts/test-w3-1b-stock-micro-check.mjs`
  - protects no-read opening, voluntary copy, same/different paths, negative-quantity safety, explicit full-detail escalation, CAS semantics, W3.1A Attention invalidation, and frozen Arrival markers.

## Invariants / exclusions

- No D1 migration.
- No Production D1 data mutation during deploy/validation.
- No change to reservation arithmetic or physical write-off rules.
- No new automatic/mandatory count requirement.
- No background recommendation read is introduced.
- Arrival UI remains frozen.
- Branch2 is untouched.
- Existing `Короткая проверка` recommendations remain available and independent.
- Full position detail/reservation loading remains explicit rather than being preloaded for the micro-check.

## Next

Continue W3 with recovery/inbox behavior after this first concrete micro-check is accepted; do not expand the micro-check into a mandatory stocktake workflow.
