# W8.2 — Stock workspace finish — 2026-09-06

## Scope

W8.2 finishes the daily `Остатки` workspace around the W8.1 execution/color/size hierarchy. It does not change Warehouse business truth.

- explicit search takes precedence over the normal availability filter so an existing SKU cannot appear missing merely because it has zero free stock or is fully reserved;
- product header totals use the whole query/category-matched product while the disclosure states when only a subset of positions is shown by the availability filter;
- SKU click is neutral information first; counting starts only after the explicit `Сверить количество` action and reuses the existing CAS-protected quick-check path;
- routine short checks move below the primary browse list and stay optional;
- one ordinary `Основное исполнение` no longer adds a heavy empty hierarchy level; large color sets are collapsible, and expanded desktop products keep sticky context;
- reservation detail loading is latest-request-wins so a slow response for a previously opened SKU cannot overwrite a newer SKU card.

## Safety boundaries

No migration. No Production D1 mutation/read for deployment. No Worker/API or Physical/Reserved/Available arithmetic change. Catalog, Arrival and Branch2 remain untouched. No pricing implementation.

## Next

Continue W8 across the remaining daily Warehouse surfaces (`Операции`, `Проверка`, `История`, recovery inbox) without reopening closed business semantics unless a concrete defect is proven. After W8 is closed, W9 is a full Warehouse audit/discussion pass: cross-workflow truth, UX, hidden defects, performance/D1 cost, mobile/desktop behavior and unresolved product decisions should be reviewed together before another broad change wave.
