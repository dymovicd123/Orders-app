# Phase 2 — Smart Daily Stock Truth — Branch2 checkpoint

Date: 2026-08-26
Branch: `branch2`
Verified source commit: `c85ef7c39a685faddb1bb81b622fb437979fdbd9`

## Completed in this checkpoint

- Routine cycle-count recommendations are readable in normal worker mode; admin-only mutation surfaces remain closed.
- Full/selective `Ревизия`, admin cycle batch apply, transfers, manual corrections and catalog administration remain admin-only.
- `Остатки` now surfaces a calm routine batch capped at 5 positions.
- The routine surface does not show the global overdue/recommended backlog count.
- Each SKU shows one dominant reason by default.
- Matching physical quantity is one tap: `Совпадает: X`.
- Mismatch uses explicit numeric fact entry.
- Routine writes reuse the existing exact quick-check path and therefore preserve expected-quantity stale/race protection and inventory-write retry handling.
- A successfully confirmed SKU disappears from the current local batch immediately.
- A SKU checked today with no later movements is suppressed from the routine batch so an already-confirmed shortage does not nag again immediately.
- An active full/selective stocktake remains a hard chronology barrier; the routine surface explains that an unfinished revision blocks short checks and gives admin a route back to revision.
- No polling was added. Recommendations load when entering `Остатки` / changing the stock source and when explicitly asking for another batch.
- Existing composite index `idx_inventory_movements_variant_manual (inventory_source, variant_id, created_at)` already matches the cycle recommendation movement-count access path, so no new D1 index/migration was added.
- Arrival / `Приход` was not changed.

## Gate

The temporary application workflow ran `npm ci` and full `npm run release:check` before committing source.

Passed:
- full current release gate;
- TypeScript;
- clean Vite production build;
- Wrangler deploy dry-run;
- Step 190.6 modularity/type/bundle gates;
- Step 191D/191E/191F;
- 192A1/A2 and 192B1/B2A/B2A1/B2A2/B2A3/B2A4/B2B regressions;
- Phase 1C Workshop return safety;
- new Phase 2 Smart Daily Stock Truth regression;
- stocktake functional acceptance on real SQLite semantics.

Observed build after Phase 2 source: Inventory controller 2553 lines, 63 reachable frontend TS/TSX modules, initial JS bundle still 508449 raw / ~142.2 KB gzip. The new routine UI remains inside the lazy Inventory chunk.

## Still open in Phase 2

- Real Branch2 human/visual acceptance of the worker-mode 3–5 item batch, especially mobile.
- Better old/abandoned active-revision age/context in the blocker (current blocker is clear but does not yet distinguish active vs abandoned by age).
- Rotation/grouping refinements only if real use shows the same low-priority SKUs nagging or physical switching cost is high.
- System-zero blind spot remains intentionally unsolved for routine suggestions; do not sample the entire zero catalog without evidence.
- Production promotion must happen only after Branch2 deploy/acceptance is green.

## Next action

Wait for the monitored Branch2 Cloudflare deploy of this checkpoint, then perform read-only/visual acceptance. If green, update canonical `WAREHOUSE_CURRENT_CONTEXT.md`, promote the reviewed Phase 2 diff to `main`, run the full Production gate/deploy monitor, and then continue Phase 2E/2H or Phase 3 according to observed UX friction.
