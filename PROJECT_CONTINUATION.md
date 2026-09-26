# Система заказов — актуальный continuation

Updated: 2026-09-26  
Repository: `dymovicd123/Orders-app`  
Branch represented by this file: **branch2**

Этот файл — короткий актуальный checkpoint Branch2. Старые Step/Stage документы сохраняются как история и подробные доказательства, но не являются текущим roadmap без сверки с GitHub.

## Текущее состояние Branch2

Branch2 содержит весь завершённый Stage03 и последующие Resolver fixes.

Ключевые закрытые checkpoints:
- Stage03 H12 final E2E audit merged через PR #205; H12 commit lineage включает `504a14d11c5fab28435031bc6c9da0f4ba950e51`.
- Resolver R11 Branch2 runtime fix: `9352bc72b4628ebd5937798b185de1b6c266056b`.
- Resolver R13 runtime baseline: `0a23edd48d0eacdbd2e0f59cae51a4dc1f1a170e`; Branch2 safety/deploy были green.
- Последний head перед этой context-cleanup был docs-only `cdcf994bd586837fb0b0f9592fe7add0878886c3`.

Завершено на Branch2:
- Stage01 / Stage02 lineage.
- Stage02 transactional stock truth полностью, включая Phase2C/2D/2E и post-review fixes.
- Operational Autonomy A1–A5.
- CLIENT-ZAMMLER.
- **Stage03 полностью технически закрыт на Branch2**: Create → Edit → payments/debt → Warehouse → Workshop → Return → Exchange → reports/history.
- Resolver R11/R12/R13.

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
- Новая точная комбинация уже известных фактов не должна вызывать лишний вопрос; deterministic safe combination path может создать/связать комбинацию с physical stock 0.
- R11 сохраняется: явный пол менеджера → пол выбранного concrete SKU → fixed product scope fallback.
- Reference duplicate protection не переписывает старые заказы/варианты/историю.

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
- `docs/continuation/STAGE03_H12_FINAL_E2E_AUDIT_20260926.md` — финальная Stage03 интеграционная модель.
- `docs/continuation/CLIENT_ZAMMLER_COMPLETION_20260924.md` — ZAMMLER завершён и не является Stage04.
- `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` — Warehouse/Stage02 history; Phase2 уже завершён.
- `docs/continuation/STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md` — stock-truth semantics.
- `docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md` — A1–A5 теперь закрыты.

## Точка продолжения

Не начинать новый Stage или Production promotion без следующего вопроса/решения пользователя. Перед любым новым шагом заново открыть GitHub и проверить текущие HEAD/PR/deploy state.
