# W3.1A — Warehouse reliability before voluntary recovery UX

Date: 2026-09-05
Base Production: `1cf1f302dfbb8e7852bdbb0e3a3a5a5a7bd02d26` (`W2.1: fix Warehouse Attention refresh race`)

## Goal

Remove two reliability regressions found by W3.0 before adding any new recovery prompts:

1. ordinary Warehouse workers must not be blocked by a blanket frontend admin gate when the existing server contract already permits safe routine operations;
2. unrelated mutations must invalidate Warehouse Attention cache without automatically spending a D1 read while the recovery surface is not being used.

## Changes

- `src/features/inventory/views/renderInventoryMovementPanel.tsx`
  - removed the blanket `!isAdmin` disable from the shared Operations submit button;
  - removed the now-unused renderer `isAdmin` dependency;
  - backend/frontend operation-specific guards remain authoritative;
  - manager can again submit existing-SKU transfer, writeoff, correction and known-variant Arrival;
  - unknown/new Arrival remains rejected by the existing frontend boundary with the explicit admin explanation, and independently by the backend.

- `src/App.tsx`
  - `invalidateInventoryStockCaches()` now only invalidates inventory/catalog-review/Attention caches;
  - it no longer starts a forced Warehouse Attention request;
  - order create/edit shortage paths no longer issue an unsolicited Attention refresh after save;
  - W2.1 detailed Attention refresh ownership remains with the Attention surface/effect/actions.

- `scripts/w3-1a-warehouse-reliability-frontend-manifest.json` + `scripts/test-step1906b-frontend-modularization.mjs`
  - records the exact one-line Operations renderer delta after the accepted W2 hash;
  - keeps the 190.6B preservation gate strict instead of weakening or rewriting historical baselines.

- `scripts/test-w3-1a-warehouse-reliability.mjs`
  - protects the manager-safe Operations submit path;
  - protects the backend permission matrix and known-Arrival admin boundary;
  - protects demand-driven Attention invalidation;
  - protects W2.1 race invariants;
  - protects the frozen Arrival workspace markers.

- `package.json`
  - focused W3.1A regression is chained into `release:check`.

## Invariants / exclusions

- No D1 migration.
- No Production data mutation.
- No inventory quantity or reservation business-rule change.
- No Branch2 change.
- Arrival UI remains frozen; its workspace and add-position action are unchanged.
- Unknown catalog/master-data creation remains admin-only.
- Destructive reversals remain admin-only.
- W2.1 Attention race fix is preserved.
- No visual acceptance is required for this reliability step.

## Next

After W3.1A acceptance, W3.1B can add the first voluntary micro-check on a concrete stock position, using already-loaded stock data and without turning physical verification into a blocking requirement.
