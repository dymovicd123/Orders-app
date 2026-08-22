# Structural refactor report — Step 190.6A–D

## 190.6A — Worker modularization

До рефакторинга Worker был одним файлом примерно на 22,5 тыс. строк. Доменная логика перенесена в `worker/core` и `worker/domains`, а `worker/index.ts` оставлен composition root.

Safety baseline 190.6A зафиксировал 577 верхнеуровневых деклараций и проверил сохранение их тел; import graph стал ацикличным.

## 190.6B — Frontend controller modularization

`App.tsx` и `InventorySection.tsx` уменьшены без смены владельцев React state/effect/ref. Крупные view-model блоки и 10 складских панелей вынесены в отдельные modules. Hook-order и JSX-preservation проверяются отдельным regression guard.

Замороженный блок **«Приход»** сохранён байт-в-байт; его SHA остаётся:

```text
d8806f8f7971d6ee5c4c656d5cdf1551297ecc6ad01cc84730b16c3153bd05bf
```

## 190.6C — Dead / dormant / legacy cleanup

Удалены только доказуемо недостижимые/устаревшие runtime части:

- Test1 Import Hub frontend;
- legacy `/api/import/*` Worker surface;
- старые workshop import-repair endpoints;
- неиспользуемые migration-gate helpers/flag;
- недостижимый `OrdersArchiveSection.tsx`;
- одноразовые historical installers/release markers/Step-era scripts из активного дерева.

Worker preservation guard знает точный allow-list из **98 намеренно удалённых legacy declarations**. Все остальные декларации baseline 190.6A сохраняют исходные hashes. Единственное намеренно изменённое старое объявление `Env` потеряло только больше не используемый `MIGRATION_ENABLED`.

После cleanup:

- Worker runtime: **33/33 достижимых TS-файла**, 0 import cycles;
- frontend runtime: **57/57 достижимых TS/TSX-файлов**;
- `App.tsx`: около **6,5 тыс. строк**;
- `InventorySection.tsx`: около **2,5 тыс. строк**;
- `worker/index.ts`: около **1,2 тыс. строк**;
- migrations: **63/63 сохранены байт-в-байт**.

`npm run verify` теперь указывает на текущий cumulative release gate. `verify:db-safety` проверяет актуальную архитектуру и запрещает возврат retired import/repair runtime или D1-mutating package scripts.

## Что не является частью 190.6C

- бизнес-логика, остатки, резервы и D1 data не меняются;
- Step 190.0 остаётся отложенным;
- 533 unresolved reservations, 15 pending workshop lifecycle и over-reserved позиции не «чинятся» source cleanup'ом;
- CSS selector pruning и bundle/lazy-loading остаются отдельными этапами;
- исторические migrations и актуальные regression tests не удаляются.


## 190.6D — Bundle / lazy-loading cleanup

Крупные workflow-секции переведены со статического mount-at-start на first-use dynamic import через React `lazy` + `Suspense`. После первого открытия `DeferredSection` сохраняет раздел смонтированным, поэтому локальный state продолжает жить при переключении разделов.

Финансовые presentation-renderers перемещены за соответствующие lazy boundaries; тяжёлые PDF/Word export packages остаются on-demand. Initial static source graph сокращён примерно с **1,3 МБ до ~592 КБ** исходного TS/TSX при 20 lazy feature boundaries.

Release gate дополнительно проверяет фактический production build: recursive initial JS graph должен оставаться ниже установленного raw/gzip budget и показывать измеримое уменьшение относительно baseline 190.6C (974.16 КБ / 231.63 КБ gzip для прежнего main chunk).

Для version-skew после deploy `main.tsx` обрабатывает `vite:preloadError` и выполняет однократный guarded reload; бесконечный reload-loop запрещён временным sessionStorage guard.

## 190.6E — Type / API boundary cleanup

Step 190.6E intentionally does **not** attempt to replace every legacy `any` in D1 row plumbing. Instead it hardens the highest-risk network/state boundaries while preserving accepted runtime behavior:

- `shared/api-contracts.ts` is the type-only contract surface shared by frontend and Worker for catalog/lifecycle resolution, inventory reservations, stocktake and cycle-count responses;
- frontend API reads use the centralized object-bounded `readJsonResponse<T extends object>`; `readJsonResponse<any>` and direct `response.json()` bypasses are forbidden in `src`;
- Worker JSON ingress uses the matching object-bounded `readJson<T extends object>` and rejects primitive/array request bodies as invalid JSON payload shape;
- critical-operation cached/serialized JSON is `unknown`-first instead of `any`-first;
- `InventorySection.tsx` is fully checked by TypeScript (its historical `@ts-nocheck` is removed);
- each of the 10 lifecycle-free inventory renderers consumes an explicit `Pick<InventoryRenderContext, ...>` boundary rather than the entire controller context.

The 190.6A preservation guard remains authoritative. Exactly **17 Worker declarations** have before/after SHA entries in the 190.6E boundary manifest; every other preserved Worker declaration must still match its previously accepted hash.

This step is source-only. It does not change D1 schema/data, accepted business rules, the deferred Step 190.0 access model, or the frozen **«Приход»** UI.
