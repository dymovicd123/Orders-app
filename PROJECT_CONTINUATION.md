# Система заказов — актуальный continuation

Updated: 2026-09-30  
Repository: `dymovicd123/Orders-app`  
Branch represented by this file: **branch2**

Этот файл — короткий актуальный checkpoint Branch2. Старые Step/Stage документы сохраняются как история и подробные доказательства, но не являются текущим roadmap без сверки с GitHub.


## STATUS UPDATE — 2026-09-30 — Legacy fixed-gender cleanup completed

Guarded Branch2 D1 correction run `36699491214` completed **successfully** after the read-only audit.

What changed:
- exactly the 13 previously audited active fixed-scope wrong-gender variants were soft-retired by setting only `catalog_variants.is_active=0` + `updated_at`;
- the write was guarded by an exact target-count check (13/13) and rechecked zero Physical, zero Reserved, zero active reservations, zero open unsent orders, zero active/ready Workshop tasks, zero pending lifecycle, and zero active stocktake before mutation;
- no order rows, stock quantities, reservations, movements, products, executions, or historical snapshots were rewritten.

Post-state:
- active fixed-scope gender mismatches: **0**;
- all 13 audited targets inactive: **13**;
- inactive variants with live Physical/Reserved/active reservation: **0**.

This closes the Branch2 legacy wrong-gender data cleanup. PR #240/#241/#242 already prevent recurrence. The next product/release focus is the requested **fresh main candidate for Catalog deletion**, preserving current main Production fixes and never merging Branch2 wholesale.

## STATUS UPDATE — 2026-09-30 — Branch2 read-only retirement data audit

Read-only Branch2 D1 audit run `36699118208` completed **successfully** against verified Branch2 identity only (`orders-app-branch2` / `orders_db_branch2` / `40065052-854e-44b8-bcd5-251bdd488301`). The audit wrote **0 rows**.

Findings:
- **13 active wrong-gender variants** still exist under fixed product gender scope; all 13 are operationally clean for local retirement: Physical=0, stock Reserved=0, active reservations=0, open unsent order items=0, active/ready Workshop tasks=0, pending lifecycle=0, active stocktake=0.
- The 13 rows are 13 distinct local groups across: `АЙДАР БОМБЕР` (4 female groups under male scope), `АЙДАР ШАПАН` (4 male groups under female scope), `СӘУКЕЛЕ ШАПАН` (4 male groups under female scope), `ҚОЗЫ КӨРПЕШ ШАПАН` (1 female group under male scope).
- **0 inactive variants with live Physical/Reserved/active reservation** were found.
- Runtime prevention from PR #240/#241/#242 is already deployed, so these are legacy data only; new ordinary creation paths should not recreate them.

Next safe action: retire exactly these 13 zero-footprint wrong-gender groups on Branch2 with a guarded, evidence-bound correction; do not rewrite order/history/stock facts. After that, continue toward a fresh main candidate for Catalog deletion rather than merging Branch2 wholesale.

## STATUS UPDATE — 2026-09-30 — Catalog retirement / restore chain

Последний завершённый runtime/business baseline этой цепочки: **`7933aba9940c82884d83e2f282bc4782964497a3`**, PR #239.  
После него documentation checkpoint добавлен отдельно; перед продолжением всегда проверять фактический текущий HEAD.

Закрыто на Branch2:
- PR #230/#231: безопасный soft retirement execution/product + hotfix;
- PR #232: `Удалённые` + safe restore в fresh generation + migration 0077 + Arrival explicit recreation;
- PR #233: new-order fresh-generation recreation вместо оживления старой SKU;
- PR #234: retired SKU не может снова получать новый Physical/Reserved через reservation, return/exchange lifecycle, handover correction или generic inventory materialization;
- PR #235/#236: regression sync для Arrival alias и lifecycle;
- PR #238: new order больше не получает blanket retired-recreate permission. Сначала идёт read-only preflight, затем explicit operator confirmation, привязанное к exact normalized item key, затем shortage decision; только после этого разрешена fresh-generation materialization;
- PR #239: добавлено строго локальное удаление группы `execution + adult/child + gender + color` через «Удалить группу». Операция soft-retire-ит только целевую подгруппу, атомарно блокируется любым Physical/Reserved/open order/Workshop/pending lifecycle/stocktake и не переписывает склад/заказы/историю. Ordinary PATCH для уже inactive SKU теперь fail-closed.

Validation:
- PR #238 branch validation `36669568796`: cumulative release-check + build — **success**;
- PR #238 merged-SHA Stage03 H7 safety `36669787332` — **success**;
- PR #238 exact merged-SHA Branch2 Cloudflare deploy `36669787336` — **success**;
- PR #239 branch validation `36689192770`: cumulative release-check + build — **success**;
- PR #239 merged-SHA Stage03 H7 safety `36689481147` — **success**;
- PR #239 exact merged-SHA Branch2 Cloudflare deploy `36689480949` — **success**.

Непереговорная retirement-семантика:
- старая retired SKU/execution остаётся historical/inactive;
- старые заказы/движения/история не перепривязываются;
- старые Physical/Reserved не возвращаются;
- active pickers/autocomplete retired identity не показывают;
- вернуться в работу можно только explicit restore, Arrival или подтверждённым новым заказом;
- это всегда fresh working generation, не revival старой SKU;
- background/runtime paths не имеют права автоматически resurrect retired identity.

### Ещё не решено

Приоритетные оставшиеся gaps:
1. **Fixed product gender-scope prevention** — PR #239 позволяет удалить ошибочную подгруппу, но нужно отдельно закрыть повторное создание противоположного пола для действительно fixed `gender_scope=male|female`, не ломая unisex/R11.
2. **Open `catalog_retired` order recovery** — открытый заказ после retirement может остаться заблокированным без явного пути перепривязать его demand к fresh active generation и восстановить резерв.
3. **Restore resumability/atomicity** — частичный сбой `restoreCatalogRetirement()` может оставить partly-active generation, а UI способен слишком рано считать объект «снова в каталоге».
4. **Legacy inactive SKU + non-zero stock audit** — новые write-paths закрыты, но нужен read-only Branch2 D1 audit старых аномалий и guarded correction only if evidence exists.
5. **Workshop retirement rule** — whole execution/product preview считает active Workshop tasks, но окончательное blocker/warning поведение не зафиксировано.
6. **Return/Exchange UX for historical retired SKU** — stock safety закрыта, но нужен явный операторский путь выбора fresh working identity вместо тупика.
7. **Exact-SKU/local-group history visibility** — старые точечные/local retirement действия ещё не представлены в `Удалённые` так полно, как whole execution/product retirement.
8. Отдельно от этой цепочки: стандартный Quality workflow всё ещё останавливается на **high-risk development-dependency audit**; production-dependency audit проходит. Security gate не ослаблять ради зелёного CI.

Каноническая подробная записка:
`docs/continuation/CATALOG_RETIREMENT_CHAIN_AUDIT_20260930.md`.


## Текущее состояние Branch2

Branch2 содержит весь завершённый Stage03 и последующие Resolver fixes.

Ключевые закрытые checkpoints:
- Stage03 H12 final E2E audit merged через PR #205; H12 commit lineage включает `504a14d11c5fab28435031bc6c9da0f4ba950e51`.
- Resolver R11 Branch2 runtime fix: `9352bc72b4628ebd5937798b185de1b6c266056b`.
- Resolver R13 runtime baseline: `0a23edd48d0eacdbd2e0f59cae51a4dc1f1a170e`; Branch2 safety/deploy были green.
- Catalog selection / retirement integrity: `43c79cbf0adb9d19a1b57ab3ecf303ed13871fbc`, PR #216; Branch2 safety run `36254901882` и exact deploy run `36254901804` — success.
- Catalog semantic SKU identity: `56f24c0dd9a883de966d9dccf31bf456d86422b1`, PR #221; cumulative candidate-tree Quality run `36320955570` — success, merged-SHA Stage03 safety run `36321055413` — success, exact Branch2 deploy run `36321055507` — success.
- Последний head перед этой context-cleanup был docs-only `cdcf994bd586837fb0b0f9592fe7add0878886c3`.

Завершено на Branch2:
- Stage01 / Stage02 lineage.
- Stage02 transactional stock truth полностью, включая Phase2C/2D/2E и post-review fixes.
- Operational Autonomy A1–A5.
- CLIENT-ZAMMLER.
- **Stage03 полностью технически закрыт на Branch2**: Create → Edit → payments/debt → Warehouse → Workshop → Return → Exchange → reports/history.
- Resolver R11/R12/R13.
- Catalog selection / retirement integrity: working pickers active-only, characteristics use maintained references ∪ active Catalog, whole-product retirement guarded/soft, retired products cannot receive active executions/SKUs, reactivation re-checks aliases/canonical identity.
- Catalog semantic SKU identity prevention + controlled correction: exact spelling remains the fast path; punctuation-equivalent colors use semantic fallback during Catalog/Arrival materialization. 2026-09-27 the independently audited Branch2 D1 correction retired its confirmed active semantic duplicates; final Branch2 audit `36322040358` attempt 3 reports `activeCollisionGroups: 0`. Historical inactive rows/snapshots remain as audit history.

Branch2 D1 имеет Stage03 schema work, включая migrations 0073/0074, которые Production ещё не имеет.

## Production boundary

Полный Stage03 **не находится в main / Production**.

Нельзя:
- merge-ить Branch2 целиком в main;
- переносить старый H12 snapshot поверх более новых Production fixes;
- заменять Production `useWorkspaceViewModel.tsx` старой Branch2 копией;
- случайно тащить Branch2 `wrangler.jsonc`/D1 identity в Production.

Будущий Stage03 rollout — только после явного разрешения пользователя и только через fresh candidate от текущего `main`, с намеренным переносом Stage03 deltas и сохранением R11/R12/R13 + CLIENT-ZAMMLER + всех новых Production-only fixes.

## Resolver status

Resolver сейчас считается закрытым:
- R11: не терять известный gender;
- R12: Catalog-consistent clarification + non-destructive reference duplicate guard;
- R13: known facts независимы от существования точной SKU-комбинации.

Не продолжать Resolver «на всякий случай». Возвращаться к нему только при конкретном воспроизводимом дефекте.

## Roadmap после Stage03

Настоящий Stage04 ещё не начинался. CLIENT-ZAMMLER не считается Stage04.

Stage04 должен отдельно определить Workshop finance / historical cost truth. Stage05/profitability нельзя честно строить до исторической себестоимости.

Warehouse Stage02 уже закрыт; старый W9 может быть отдельным будущим product audit, но не текущей недоделкой Stage02.

## Непереговорные правила работы

1. **Перед любой содержательной работой по проекту сначала открыть актуальный `dymovicd123/Orders-app` на GitHub.** Память, скриншоты, старые ZIP/step-файлы и локальные context-файлы — только исторические подсказки, не source of truth.
2. Источник истины по текущему состоянию: актуальная ветка и её код → этот continuation → профильные документы в `docs/continuation`. Если старый документ конфликтует с текущим кодом/историей GitHub, приоритет у текущего GitHub.
3. Не заменять современные `src`, `worker`, migrations или controller-файлы снимком из старой ветки. Любой перенос — только осознанное reconciliation поверх свежего target branch.
4. Работать средними цельными кусками: одна логическая правка + прямые regressions + cumulative release gate. Не смешивать несколько крупных этапов в один релиз.
5. Для связанной бизнес-логики обязательно проверять соседнюю цепочку: источник события → серверная валидация → критическая запись → вторичные записи/readback → UI/история → retry/lost-response.
6. Для мутаций сначала доказывать atomicity/idempotency/replay safety и отсутствие false-failure после уже совершённой критической записи. Потерянный ответ или повторный запрос не должен удваивать бизнес-эффект.
7. Историческая финансовая/складская правда не переписывается «для удобства». Исправления должны идти через безопасную correction/reversal логику с историей, а не через скрытый rewrite.
8. Пользовательские интерфейсы не должны показывать служебные комментарии, внутренние шаги разработки, названия регрессий или сообщения, предназначенные разработчику.
9. Предпочитать semantic/domain regression tests exact-source hash/line-count проверкам. Byte-level freeze оставлять только для действительно замороженных артефактов.
10. Не считать релиз завершённым по одному CI. Для deploy нужен успешный статус **точного merged SHA** в соответствующем Cloudflare workflow.
11. Не тратить сессию на бесконечный polling. Если внешний CI/deploy долго ждёт, оставить безопасный checkpoint: ветка/HEAD/run/status/следующее действие.
12. После значимого merge/deploy/нового инварианта обновлять continuation, чтобы новый чат не восстанавливал состояние по древним файлам.

## Жёсткая изоляция окружений

- `main` / Production Worker: `orders-app`.
- Production D1: `orders_db_prod`, id `17e68a41-1d58-4a36-8a63-47c3e32443c4`.
- `branch2` Worker: `orders-app-branch2`.
- Branch2 D1: `orders_db_branch2`, id `40065052-854e-44b8-bcd5-251bdd488301`.
- Никогда не связывать Worker одной среды с D1 другой.
- Никогда не копировать/синхронизировать данные между Production и Branch2 без отдельного явного запроса пользователя.
- Перед любой D1 mutation сначала проверить фактические Worker name + D1 logical name + D1 id; имя ветки само по себе не доказательство.
- Не запускать blanket remote `migrations apply` по старому журналу. Сначала read-only сверка schema/`d1_migrations`, затем только конкретная доказанно нужная migration.
- Environment-specific `wrangler.jsonc`, визуальный marker и regression gate не переносятся вместе с бизнес-кодом.
- Инцидент 2026-09-22 с Production binding в Branch2 считается постоянным предупреждением; исправление: `0f38bf4f1c85ef124237abd952384b05513b946c`.

## Постоянные бизнес-инварианты

### Catalog / Resolver
- Catalog identity: product → execution (`product + material + length`) → exact SKU (execution + adult/child + gender + color + size/age).
- Resolver — **anomaly guard, а не анкета на совместимость**.
- Известный факт считается известным, если он есть в maintained references **или любом активном Catalog SKU**.
- Безопасные различия пунктуации/пробелов, например `ТЕМНО-СЕРЫЙ` и `ТЕМНО СЕРЫЙ`, канонизируются автоматически.
- Harmless punctuation-equivalent **color** spellings не должны материализовываться как два новых physical SKU: runtime использует exact-first lookup + semantic fallback. Подтверждённые Branch2 active collisions исправлены отдельной guarded D1 correction 2026-09-27; исторические inactive rows/snapshots не переписываются.
- Новая точная комбинация уже известных фактов не должна вызывать лишний вопрос; deterministic safe combination path может создать/связать комбинацию с physical stock 0.
- R11 сохраняется: явный пол менеджера → пол выбранного concrete SKU → fixed product scope fallback.
- Reference duplicate protection не переписывает старые заказы/варианты/историю.
- Retired product/SKU остаётся историей, но не должен попадать в рабочие формы выбора; вывод из каталога — soft deactivate, не delete.
- Нельзя создавать новое исполнение/SKU или сохранять активный SKU под retired product.
- Whole-product retirement допустим только после вывода активных SKU и при отсутствии физического остатка, резерва, активного неотправленного заказа, незавершённой задачи Цеха, pending lifecycle и активной ревизии.
- Reactivation retired product обязана заново проверять canonical product identity/aliases, чтобы старый дубль вроде `ОРДА` не мог вернуться в рабочий каталог.

### Warehouse / inventory truth
- `Physical`, `Reserved`, `Available = Physical - Reserved` остаются разными истинами.
- Только явный count/correction workflow может задавать абсолютный Physical.
- Operational possession подтверждает только конкретные единицы текущей операции и никогда не превращается в «полный пересчёт SKU».
- Outbound при нехватке tracked Physical ограничивается снизу нулём; unexplained quantity остаётся audit evidence.
- Arrival / «Приход» заморожен и не меняется без отдельного явного запроса.

### Finance / pricing truth
- Текущая Catalog recommendation, фактическая цена продажи, платежи и долг — разные сущности.
- Исторические заказы не пересчитываются по сегодняшнему Catalog.
- Для будущего/Branch2 `itemized_v1`: `catalog_price_snapshot` — историческая рекомендация, `unit_price` — фактическая цена, `line_total = quantity × unit_price`, платежи независимы.
- Legacy orders остаются `legacy_manual_total`; нельзя выдумывать построчную цену для старой истории.
- Возврат денег и физический возврат — отдельные факты; exchange money также отдельный финансовый факт.

### Operational autonomy
- Нормальные бизнес-коррекции должны быть выполнимы через приложение без разработчика.
- Безопасность достигается stale checks, явными correction/reversal действиями, audit history и idempotency, а не блокировкой законного сценария навсегда.

## Техническая основа

- Frontend: React + TypeScript + Vite.
- Backend: Cloudflare Worker + D1; `worker/index.ts` — composition root, доменная логика разнесена по `worker/domains`.
- Runtime-файл должен быть достижим из `src/main.tsx` или `worker/index.ts`, если он не является deliberately inactive contract/fixture.
- CSS cascade/order считается поведением; широкую CSS-cleanup не смешивать с бизнес-изменениями.
- Step 190.0 access/auth всё ещё отложен до отдельного согласования с клиентом.


## Актуальные подробные документы

- `docs/PROJECT_CONTEXT.md` — постоянные архитектурные/рабочие инварианты.
- `docs/continuation/CATALOG_SEMANTIC_SKU_IDENTITY_20260927.md` — incident/checkpoint по ЭТНО КАРДИГАНУ, PR #220/#221, release evidence и следующий safe data-correction chunk.
- `docs/continuation/STAGE03_H12_FINAL_E2E_AUDIT_20260926.md` — финальная Stage03 интеграционная модель.
- `docs/continuation/CLIENT_ZAMMLER_COMPLETION_20260924.md` — ZAMMLER завершён и не является Stage04.
- `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` — Warehouse/Stage02 history; Phase2 уже завершён.
- `docs/continuation/STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md` — stock-truth semantics.
- `docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md` — A1–A5 теперь закрыты.

## Точка продолжения

Semantic SKU incident 2026-09-27 закрыт и на Branch2: отдельная correction использовала только Branch2 evidence, не копировала Production data assumptions, и финальный audit показывает `activeCollisionGroups: 0`. Branch2 Stage03 runtime остался сохранённым и не переписывался этой работой. Возвращаться к semantic SKU correction следует только при новом конкретном дефекте; перед следующим проектным шагом заново открыть GitHub и проверить актуальные HEAD/deploy state.
