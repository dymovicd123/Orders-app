# Система заказов — актуальный continuation

Updated: 2026-09-26  
Repository: `dymovicd123/Orders-app`  
Branch represented by this file: **main / Production**

Этот файл — короткий актуальный checkpoint. Старые Step/Stage документы сохраняются как история и подробные доказательства, но не должны использоваться как текущий roadmap без сверки с GitHub.

## Текущее состояние Production

Последний runtime-changing Production baseline перед этой чисткой контекста:
- `4ecd8e2aeab8afc5805c5eb209542659acc09a72` — Resolver R12/R13 Production promotion.
- Exact Production deploy для него: GitHub Actions run `36244645101` — success.

Завершено и находится в Production:
- **Stage01** — завершён и выпущен через Production release candidate PR #102.
- **Stage02 transactional stock truth** — завершён, прошёл Branch2 review/post-review fixes и выпущен через PR #145. Phase2C/2D/2E больше не являются pending work.
- **Operational Autonomy R3 A1–A5** — все реализованы в текущей main lineage: multiple returns / return+exchange coexistence, debt close after return, mistaken sent/handover correction, exchange financial correction.
- **CLIENT-ZAMMLER** — отдельный клиентский запрос, завершён и в Production. Это **не roadmap Stage04**.
- **Resolver R11/R12/R13** — завершён и в Production. Сейчас resolver считается стабильным; новые изменения только при конкретном обнаруженном дефекте.
- D1 read-budget/O1/R5 optimizations уже находятся в истории main; следующий performance pass делать только по свежим Query Insights, а не «по инерции».

## Что НЕ находится в Production

### Stage03
Stage03 технически завершён на Branch2 через H12, но **полный Stage03 pricing/itemized runtime не продвинут в main**.

Production сейчас намеренно сохраняет:
- актуальные Production-only fixes;
- CLIENT-ZAMMLER;
- Resolver R11/R12/R13;
- Stage01/Stage02/Autonomy lineage.

В `main` есть migration 0072 (Catalog execution prices) и 0075 (ZAMMLER due time), но **нет** Stage03 migrations 0073/0074 и нет полного `itemized_v1` runtime.

Любой будущий Stage03 → Production rollout:
- только после явного разрешения пользователя;
- строится от свежего `main`, а не прямым merge старого Branch2 snapshot;
- reconcile-ит только Stage03 business changes;
- сохраняет R11/R12/R13 и все более новые Production fixes;
- применяет 0073/0074 отдельными guarded schema steps после read-only D1 audit;
- проходит full cumulative CI + exact Production environment guard + exact-SHA deploy + manual E2E acceptance.

### Roadmap Stage04
Настоящий Stage04 ещё не начинался. Старые имена `Stage04-ZAMMLER` — только историческая ошибка именования.

Stage04 = отдельная будущая работа вокруг Workshop finance / исторической себестоимости и должна начинаться с бизнес-контракта, а не с миграции или UI.

## Warehouse status

Stage02 stock-truth работа закрыта и уже в Production. Старый W9 «полный Warehouse product audit» остаётся возможным будущим read-only/UX review после реального использования, но **не является незавершённой Phase2 задачей**.

## Что отложено

- Step 190.0 access/auth — до согласования ролей с клиентом.
- Arrival / «Приход» — frozen.
- Широкая перестройка Warehouse — только по конкретным проблемам/новому пользовательскому решению.
- Новый resolver redesign — только если появится реальный дефект.

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
- `docs/continuation/CLIENT_ZAMMLER_COMPLETION_20260924.md` — завершённый ZAMMLER scope.
- `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` — исторические детали Warehouse/Stage02; верхняя status-note должна трактоваться как актуальная.
- `docs/continuation/STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md` — canonical stock-truth semantics, этап уже завершён.
- `docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md` — исторический аудит; A1–A5 уже реализованы.
- Stage03 H12 document живёт в Branch2 и описывает завершённый Branch2 pricing audit.

## Точка продолжения

Никакой незапрошенной крупной разработки сейчас не начинать. Следующее содержательное действие определяется следующим вопросом/решением пользователя. Если речь пойдёт о Stage03 rollout, сначала заново сверить current `main` и `branch2` и построить fresh promotion candidate.
