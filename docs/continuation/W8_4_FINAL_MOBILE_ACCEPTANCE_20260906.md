# W8.4 — final Warehouse mobile acceptance

Date: 2026-09-06
Branch: `w8-4-final-mobile-acceptance`
Baseline entering W8.4: `main` `c224c5082ddcf6d968c700af50037f36123b1526` (W8.3).

## Scope

Final presentation/acceptance pass for the Warehouse W8 interface. No Warehouse business semantics were reopened.

The concrete mobile defect entering this step was that `Перемещение` already became readable cards on phones, while the rarer `Списание` and `Исправить количество` modes still inherited the desktop variants table with a 660px minimum width and therefore required horizontal scrolling.

## Changes

- On <=760px, `Списание` and `Исправить количество` now render their existing table rows as readable card-like grids with explicit visual labels (`Позиция`, `На месте`, `В заказах`, `Списать`, `После`, `По системе`, `Фактически`, `Разница`).
- On <=460px those cards collapse to one column and their submit actions become full-width.
- Existing transfer mobile behavior is preserved.
- `Приход` remains intentionally outside all W8.4 selectors, including its submit bar and mode-specific form.
- History/recovery touch targets receive narrow-screen spacing only.
- A cross-screen audit found that the W8.3 stylesheet existed but was not actually imported into the Warehouse bundle. W8.4 fixes the import chain so the already-accepted W8.3 History/Attention presentation is now really loaded.
- The W8.4 regression gate now checks the stylesheet import chain, mobile writeoff/manual-set card hooks, transfer preservation, W8.2 stock workspace markers, W8.3 History/Attention markers, Stocktake markers and frozen Arrival boundary.

## Safety boundaries

No Worker/API change.
No migration.
No D1 mutation or Production data read was required by this step.
No stock/reservation/available arithmetic change.
No transfer/writeoff/manual-set mutation code change.
No Stocktake mutation code change.
No Catalog change.
No Arrival UI change.
Branch2 untouched.
No task/SLA/case-management system introduced.

## Validation

A dedicated temporary validation workflow passed:
- cumulative `npm run release:check`;
- `npm run verify:db-safety`;
- TypeScript + production build;
- lint;
- `wrangler deploy --dry-run`.

The temporary workflow was removed after success. The clean branch must still pass the normal Quality check before merge.

## W8 closure / next action

After clean PR validation and successful Production deploy, W8 is closed unless a concrete Production defect is observed.

Next planned Warehouse phase is **W9 — full Warehouse audit and discussion**. W9 begins read-only: review all Warehouse workflows and disputed product rules together before starting another broad implementation wave.
