# Архитектура Orders App

Актуальный baseline после Step 190.6A–E. Любой новый код должен сохранять эти границы либо менять их отдельным проверяемым refactor-step.

## Frontend

```text
src/
  main.tsx                         # browser entrypoint
  App.tsx                          # application controller / orchestration
  app/
    types.ts                       # local UI/form/domain models
    constants.ts                   # shared constants and dictionaries
    utils.ts                       # pure formatting/normalization helpers
    controllers/                   # extracted controller/view-model hooks
    lazySections.tsx               # first-use lazy feature boundaries + state-preserving mount wrapper
  components/                      # reusable UI components
  features/
    sections/                      # workflow/screen sections
    renderers/                     # large presentation renderers
    inventory/
      views/                       # typed inventory panel renderers
  styles/                          # ordered CSS cascade
shared/
  api-contracts.ts                 # type-only frontend↔Worker API contracts
```

`App.tsx` остаётся владельцем общей orchestration-логики, но крупные чистые вычисления и view-model блоки выносятся в `app/hooks`/feature modules. Нельзя переносить hooks/state/effects между владельцами только ради уменьшения числа строк: React lifecycle является частью поведения.

`InventorySection.tsx` остаётся controller для складского экрана. Панели из `features/inventory/views` не имеют собственного hook-lifecycle и получают типизированный presentation context.

Step 190.6C требует, чтобы каждый runtime `.ts/.tsx` был достижим из `src/main.tsx`, включая dynamic-import edges. Недостижимые runtime-файлы не хранятся «на всякий случай».

### Type / API boundaries

Step 190.6E вводит `shared/api-contracts.ts` как type-only границу между frontend и Worker для наиболее активно используемых catalog/lifecycle/inventory API. Frontend не должен обходить `readJsonResponse<T extends object>` прямым `response.json()`, а Worker JSON ingress проходит через `readJson<T extends object>`. Оба reader-а отвергают primitive/array envelope вместо слепого приведения к ожидаемому DTO.

`InventorySection.tsx` больше не использует `@ts-nocheck`; 10 inventory renderers получают узкие `Pick<InventoryRenderContext, ...>` presentation boundaries. Некоторые старые presentation-only секции всё ещё имеют исторический `@ts-nocheck`; массовое переписывание их view-model типов не входит в 190.6E и не должно смешиваться с сетевыми API-контрактами. Новые runtime-модули не должны получать `@ts-nocheck`.

D1 query-row objects остаются отдельным слоем: сотни исторических SQL result-shapes не следует механически объявлять общими API DTO. Их типизация требует schema/query-level подхода, а не `any`→cast sweep.

### Runtime loading / bundle policy

Step 190.6D переводит крупные workflow-секции на first-use lazy loading. В `App.tsx` feature-секции не импортируются статически: dynamic boundaries объявлены один раз на module top level в `app/lazySections.tsx`. `DeferredSection` не монтирует раздел до первого открытия, а после первого открытия держит его смонтированным, поэтому локальный React state не сбрасывается при переходе между разделами.

Тяжёлые export-библиотеки `docx`, `html2canvas`, `jspdf` остаются только dynamic imports. `main.tsx` содержит обработчик `vite:preloadError`, чтобы stale-вкладка после нового deploy могла один раз перезагрузиться вместо зависания на отсутствующем hashed chunk.

После `vite build` release gate считает не размер одного файла, а рекурсивный initial static JS graph из `dist/client/index.html`; Step 190.6D не считается успешным, если startup bundle снова выходит за regression-budget.

## CSS

Порядок импортов CSS является частью принятого UI и меняется только вместе с browser acceptance. Step 190.5 добавил small-screen acceptance layer; замороженный экран **«Приход»** нельзя таргетировать новыми правилами без отдельного согласования.

## Worker

```text
worker/
  index.ts                         # composition root + route dispatch + health markers
  core/                            # shared types/http/db/errors/ids
  domains/                         # business domains: orders, inventory, workshop,
                                   # finance, returns/exchanges, storage, team, catalog, ...
  README.md                        # module-boundary rules
```

После 190.6A Worker разделён на ацикличные модули. `worker/index.ts` не является местом для новой доменной логики.

Инварианты:

- каждый Worker-модуль достижим из `worker/index.ts`;
- Worker import graph не содержит циклов;
- `core` не импортирует domain-модули;
- domain-модули не импортируют `worker/index.ts`;
- Worker не использует `@ts-nocheck`;
- новые API routes должны жить рядом с соответствующим доменом, а composition root только связывает их.

## Retired runtime

Step 190.6C удалил недостижимый Test1 Import Hub и старые import/repair API. Legacy-import staging tables были удалены ещё migration `0060`; сохранять runtime-кнопки и destructive repair routes после этого было опасным dormant-кодом.

Исторические SQL migrations при этом **не удаляются**: они нужны для воспроизводимости схемы и проверки upgrade-path. То же относится к regression-тестам текущей линии 189–190.

## Проверки

Основной gate:

```bash
npm run verify
```

Он запускает cumulative regression checks, database-safety guard, TypeScript, clean Vite build и Wrangler dry-run.

Дополнительно:

```bash
npm run verify:db-safety
npm run typecheck
```

Step 190.6A/B/C/D/E guards защищают модульные границы, dynamic reachability и bundle budget и намеренные удаления. Старый runtime нельзя возвращать, просто чтобы удовлетворить исторический step-script.
