# Система заказов — актуальный continuation

Updated: 2026-10-02  
Repository: `dymovicd123/Orders-app`  
Branch represented by this file: **main / Production**

Этот файл — короткий актуальный checkpoint. Старые Step/Stage документы сохраняются как история и подробные доказательства, но не должны использоваться как текущий roadmap без сверки с GitHub.

## RELEASE UPDATE — 2026-10-02 — Production authorization complete; stocktake navigation hotfix live

Production authorization is no longer postponed:
- PR #270 activated the tested account/session authorization stack on Production after guarded schema preparation;
- PR #271 hardened first-admin/login/session recovery;
- PR #272 added admin-only visibility of unlinked system administrators;
- PR #273 added safe system-administrator management;
- normal employee access is managed from Team, while account identity/role is server-owned;
- account sessions, password-change flow, throttling/audit hardening and browser password-manager semantics are all part of the current Production lineage.

Today’s stocktake incident was a frontend navigation regression, not a broken stocktake persistence model:
- PR #274 — `Hotfix: keep stocktake product navigation stable during partial counts` — merged;
- exact runtime-changing merged SHA: `99784288b3eafb30613d6213d818b62d2c0e0fd0`;
- the selected product is now preserved by stable product key when the same stocktake session is refreshed/re-adopted;
- operators may leave uncounted positions blank, move to another product and return later; blank still means “not counted”, not zero;
- explicit `Остальные = 0` remains a deliberate action and is not required for navigation.

Verification for the hotfix:
- cumulative Quality check on head `b39ede48a99814ff504f0df46ab41eca8daeeee3`: run `37013147259` — **success**;
- `STOCKTAKE FUNCTIONAL ACCEPTANCE PASSED`: start/resume, count persistence/replay, recount on concurrent stock change, atomic completion, completion replay, exact history, active-session guard and cancellation were verified;
- exact merged-SHA Cloudflare monitor: run `37013188693` — **success**.

No additional fixes are planned for 2026-10-02. The next session should return to business design, not continue opportunistic bug-fixing.

## RELEASE UPDATE — 2026-09-30 — Stage03 itemized pricing is live in Production

Stage03 Production promotion is complete. It was reconciled onto fresh `main`; Branch2 was **not** merged wholesale.

Production schema preparation:
- PR #252 — `Stage03: prepare Production schema 0073/0074` — merged;
- schema merge SHA: `8de27c402efc0eefd3e7e0da6485dfeb87eba4f1`;
- guarded Production migration workflow run `36739732036` — **success**;
- migrations 0073/0074 are applied in Production;
- existing orders/retained history remained `legacy_manual_total`;
- historical `catalog_price_snapshot` values were not invented/backfilled from the current Catalog;
- the guarded before/after Production business fingerprint remained unchanged.

Runtime promotion:
- PR #253 — `Stage03: release completed itemized pricing to Production` — merged;
- exact merged Production runtime SHA: `af5f666b0ef8aa3e99ff537c7d8ced3fc68b41b1`;
- final PR cumulative Quality run `36744477616` — **success**, including cumulative regression gate and Production build;
- exact merged-SHA Cloudflare deploy monitor run `36744693819` — **success**.

Production now has the completed Stage03 pricing model:
- new pricing generation `itemized_v1` for the supported new-order flow;
- historical orders remain `legacy_manual_total`;
- `catalog_price_snapshot` is historical Catalog recommendation, while `unit_price` is the factual sold price;
- `line_total = quantity × unit_price`, and itemized order total is server-derived from lines;
- Create/Edit/Exchange preserve factual item pricing; Return money remains an explicit separate fact;
- current mutable Catalog price does not reinterpret historical orders, payments, debt, Workshop or Warehouse truth;
- Finance product analytics can use factual itemized sold-price history while legacy rows remain explicitly legacy.

No further Stage03 implementation is pending. Any future Stage03 work should be treated as a concrete defect/follow-up, not continuation of the rollout.

## RELEASE UPDATE — 2026-09-30 — Catalog deletion is live in Production

Catalog deletion/retirement was promoted through fresh-main PR #250. Production runtime baseline:
- `7953a01d2856a6e674f0473918244ab53839a36f` — exact merged SHA;
- PR #250 was reconciled from main `820ff6be9a2e06fad4f61b147263927b0c42d3a7`; Branch2 was **not** merged wholesale;
- Quality on the release PR: run `36733462167` — success;
- exact merged-SHA Cloudflare deploy monitor: run `36733693812` — success.

Production data/schema preparation completed before runtime promotion:
- guarded legacy Catalog repair v2: run `36732576266` — success;
  - active fixed-gender mismatches = **0**;
  - inactive SKU carrying live Physical/Reserved = **0**;
  - one live Physical unit was moved from wrong-gender SKU 158 to its already-active canonical SKU 1089 without changing total Physical/Reserved/order counts;
  - legacy inactive identities 207/356/1065/1066 that still owned real operational state were reactivated;
- retirement schema 0076–0079: run `36733043591` — success, business fingerprint unchanged;
- post-deploy read-only Production smoke: run `36734056327` — success.

Production now includes:
- whole product/execution safe retirement + restore;
- exact-SKU and local-group retirement;
- explicit retired-order recovery and historical Return/Exchange intake;
- fixed product gender-scope prevention;
- unified deleted-history UI;
- larger, visible `Удалить группу` action in the subgroup header;
- patched transitive `undici 7.29.1` security override.

Catalog-retirement rollout is complete, and Stage03 is now also fully promoted to Production. Future work must start from current `main` and re-check GitHub before any new change.

## Текущее состояние Production

Последний runtime-changing Production baseline:
- `99784288b3eafb30613d6213d818b62d2c0e0fd0` — PR #274 stocktake navigation hotfix on top of the completed Production authorization lineage.
- Exact Production deploy monitor: GitHub Actions run `37013188693` — success.
- Production authorization PR #270–#273, Stage03 itemized pricing, Catalog deletion, semantic-SKU correction, CLIENT-ZAMMLER, Resolver R11/R12/R13, Stage01/Stage02 and Operational Autonomy all remain preserved underneath this lineage.

Завершено и находится в Production:
- **Stage01** — завершён и выпущен через Production release candidate PR #102.
- **Stage02 transactional stock truth** — завершён, прошёл Branch2 review/post-review fixes и выпущен через PR #145. Phase2C/2D/2E больше не являются pending work.
- **Stage03 itemized pricing** — завершён и выпущен в Production через schema PR #252 + runtime PR #253. Migrations 0073/0074 применены guarded workflow; исторические заказы не repriced/backfilled, новый itemized runtime находится в текущем `main`.
- **Production account authorization** — завершена и находится в текущем `main`: schema preparation PR #268/#269, activation PR #270, reliability R7 PR #271, system-admin visibility/management PR #272/#273. Новые auth-изменения делать только по конкретному дефекту или новому согласованному запросу клиента.
- **Stocktake navigation hotfix** — PR #274 завершён: переход между товарами больше не требует заполнять все варианты нулями; сохранение/завершение ревизии остаётся под существующими persistence/CAS/replay guards.
- **Operational Autonomy R3 A1–A5** — все реализованы в текущей main lineage: multiple returns / return+exchange coexistence, debt close after return, mistaken sent/handover correction, exchange financial correction.
- **CLIENT-ZAMMLER** — отдельный клиентский запрос, завершён и в Production. Это **не roadmap Stage04**.
- **Resolver R11/R12/R13** — завершён и в Production. Сейчас resolver считается стабильным; новые изменения только при конкретном обнаруженном дефекте.
- **Catalog selection / retirement integrity** — завершён и в Production через PR #214: рабочие product pickers не показывают retired products; известные характеристики берутся из maintained references ∪ active Catalog; whole-product retirement мягкий и блокируется активными SKU/остатками/резервами/незавершёнными операциями; reactivation заново проверяет canonical name/alias conflicts.
- **Catalog semantic SKU identity prevention + controlled correction** — PR #220, runtime `645b54ae320e45e1d34861f2e6e715819fcf5e43`: exact spelling остаётся fast path, harmless hyphen/space colors переиспользуют существующий semantic SKU. 2026-09-27 отдельная guarded D1 correction вывела из активной работы подтверждённые semantic duplicates; финальный Production audit `36322036163` attempt 3 показал `activeCollisionGroups: 0`. Исторические строки/текстовые snapshots не удалялись.
- D1 read-budget/O1/R5 optimizations уже находятся в истории main; следующий performance pass делать только по свежим Query Insights, а не «по инерции».

## Ближайшая точка продолжения — Kaspi + Stage04 business discussion

У пользователя уже есть новая информация от/для клиента по **Kaspi** и **Stage04**. Она ещё не зафиксирована в этом документе, потому что содержательное обсуждение отложено на следующую сессию. **Не додумывать эту информацию и не начинать реализацию до разговора с пользователем.**

### Kaspi — текущий известный минимум

Клиентский запрос на данный момент понимается так:
- Kaspi-заказы должны быть отделены от обычного рабочего списка и показываться в отдельной вкладке/рабочем представлении в боковой навигации;
- не создавать отдельную параллельную сущность заказа и не добавлять специальный Kaspi-ID только ради самого факта происхождения заказа — отдельный идентификатор допустим только если завтрашний бизнес-контракт докажет, что он реально нужен;
- прежде чем менять schema/API/UI, нужно подтвердить бизнес-семантику: как Kaspi-заказ определяется/создаётся, как отражаются оплата и комиссия, что происходит с отменами/возвратами/обменами, и какие данные должны попадать в Finance/Workshop/Warehouse;
- CLIENT-ZAMMLER — уже завершённый отдельный scope и не должен смешиваться с будущей Kaspi-моделью.

Следующая сессия по Kaspi начинается с новой информации пользователя и сборки окончательного business contract. Только после этого проектировать код.

## Следующий roadmap — Stage04

Настоящий Stage04 ещё не начинался. Старые имена `Stage04-ZAMMLER` — только историческая ошибка именования.

У пользователя уже есть дополнительная информация для Stage04, которую нужно обсудить в следующей сессии. Ниже сохранён прежний design checkpoint, но он **не считается финальным контрактом** до сверки с этой новой информацией.

Stage04 = отдельная будущая работа вокруг **Workshop finance / исторической себестоимости / долга Цеху** и должна начинаться с бизнес-контракта, а не с миграции или UI.

Предварительное направление, согласованное для продолжения обсуждения:
- `Готово в цехе` / `workshop_task.done` само по себе **не создаёт долг**;
- текущая mutable Catalog `cost_price` сама по себе **не является историческим долгом** и не должна переписывать старую себестоимость;
- финансовое обязательство Цеху должно возникать только из отдельного подтверждённого факта приёмки/накладной Цеха;
- старые `workshop_tasks` нельзя автоматически backfill-ить в долг: система не знает, что из старой работы уже было оплачено вне неё;
- для запуска Stage04 нужен подтверждённый **opening balance / начальный долг (или аванс) на дату отсечения**, который сворачивает старую историю до cutover;
- новые накладные после cutover должны хранить frozen quantity + фактическую unit cost/line cost, чтобы будущая прибыльность использовала исторический факт, а не сегодняшнюю цену Catalog;
- оплаты Цеху — отдельные факты; обычное распределение по открытым обязательствам предполагается FIFO, при этом точная привязка к конкретной накладной может поддерживаться отдельно;
- переплата должна становиться авансом, а не запрещённым/отрицательным странным долгом;
- проведённые накладные/оплаты не должны тихо редактироваться задним числом: correction/reversal history обязана сохраняться;
- customer Return/Exchange не должен автоматически менять долг Цеху: скидка/брак/переделка/кредит Цеха — отдельный финансовый факт.

Это пока **business-design checkpoint, не реализованный Stage04 contract**. Перед кодом нужно отдельно подтвердить реальный формат накладной Цеха: есть ли фактическая цена по каждой позиции или иногда только общая сумма на набор изделий.

## Дальнейший порядок завершения проекта

Текущий high-level порядок после завтрашнего business discussion:
1. Kaspi — подтвердить модель с клиентом, затем реализовывать только согласованный scope.
2. Stage04 — подтвердить Workshop finance / historical cost contract с новой информацией пользователя, затем реализовать.
3. Stage05 — следующий запланированный этап после Stage04; его конкретный scope перед стартом нужно заново сверить с актуальным roadmap, не выдумывать по памяти.
4. Marketing / РНП — оставить ближе к самому концу, после основных operational/financial этапов.
5. Финальный аудит, cleanup только по доказанным проблемам, Production acceptance и передача системы.

Не смешивать Kaspi и Stage04 в один большой технический релиз только потому, что их бизнес-обсуждение идёт рядом.

## Warehouse status

Stage02 stock-truth работа закрыта и уже в Production. Старый W9 «полный Warehouse product audit» остаётся возможным будущим read-only/UX review после реального использования, но **не является незавершённой Phase2 задачей**. После PR #274 ревизию не перестраивать широко: дать текущему workflow пожить в реальной работе и исправлять только конкретно обнаруженные дефекты.

## Что отложено

- Новые Kaspi/Stage04 изменения — до следующей сессии, где пользователь даст уже собранную дополнительную информацию и будет зафиксирован business contract.
- Arrival / «Приход» — frozen.
- Широкая перестройка Warehouse — только по конкретным проблемам/новому пользовательскому решению.
- Новый resolver redesign — только если появится реальный дефект.
- Дополнительный auth polish — только по конкретному Production-дефекту или новому запросу клиента; сам rollout авторизации завершён.

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
- Harmless punctuation-equivalent **color** spellings не должны материализовываться как два новых physical SKU: runtime использует exact-first lookup + semantic fallback. Подтверждённые active semantic collisions, существовавшие до PR #220, исправлены контролируемой D1 correction 2026-09-27; исторические inactive rows и snapshots остаются audit history.
- Новая точная комбинация уже известных фактов не должна вызывать лишний вопрос; deterministic safe combination path может создать/связать комбинацию с physical stock 0.
- R11 сохраняется: явный пол менеджера → пол выбранного concrete SKU → fixed product scope fallback.
- Reference duplicate protection не переписывает старые заказы/варианты/историю.
- Retired product/SKU остаётся историей, но не должен попадать в рабочие формы выбора; вывод из каталога — soft deactivate, не delete.
- Нельзя создавать новое исполнение/SKU или сохранять активный SKU под retired product.
- Whole-product retirement допустим только после вывода активных SKU и при отсутствии физического остатка, резерва, активного неотправленного заказа, незавершённой задачи Цеха, pending lifecycle и активной ревизии.
- Reactivation retired product обязана заново проверять canonical product identity/aliases, чтобы старый дубль не мог вернуться в рабочий каталог.

### Warehouse / inventory truth
- `Physical`, `Reserved`, `Available = Physical - Reserved` остаются разными истинами.
- Только явный count/correction workflow может задавать абсолютный Physical.
- Operational possession подтверждает только конкретные единицы текущей операции и никогда не превращается в «полный пересчёт SKU».
- Outbound при нехватке tracked Physical ограничивается снизу нулём; unexplained quantity остаётся audit evidence.
- Arrival / «Приход» заморожен и не меняется без отдельного явного запроса.

### Finance / pricing truth
- Текущая Catalog recommendation, фактическая цена продажи, платежи и долг — разные сущности.
- Исторические заказы не пересчитываются по сегодняшнему Catalog.
- Для текущего Production `itemized_v1`: `catalog_price_snapshot` — историческая рекомендация, `unit_price` — фактическая цена, `line_total = quantity × unit_price`, платежи независимы.
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
- Production account authorization уже активна и завершена по текущему scope; не восстанавливать старое состояние «Step 190.0 auth отложен».


## Актуальные подробные документы

- `docs/PROJECT_CONTEXT.md` — постоянные архитектурные/рабочие инварианты.
- `docs/continuation/CATALOG_SEMANTIC_SKU_IDENTITY_20260927.md` — incident/checkpoint по semantic SKU identity: PR #220/#221, отдельные Production/Branch2 data corrections, Production recovery evidence и финальные read-only audits.
- `docs/continuation/CLIENT_ZAMMLER_COMPLETION_20260924.md` — завершённый ZAMMLER scope.
- `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` — исторические детали Warehouse/Stage02; верхняя status-note должна трактоваться как актуальная.
- `docs/continuation/STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md` — canonical stock-truth semantics, этап уже завершён.
- `docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md` — исторический аудит; A1–A5 уже реализованы.
- Stage03 H12 document живёт в Branch2 как исторический подробный pricing audit; фактический Production rollout зафиксирован выше через PR #252/#253.

## Точка продолжения

Production на конец 2026-10-02 включает завершённую account authorization lineage PR #270–#273 и stocktake navigation hotfix PR #274. Последний runtime-changing SHA `99784288b3eafb30613d6213d818b62d2c0e0fd0`; cumulative Quality на hotfix head и exact merged-SHA Cloudflare deploy зелёные. Stocktake persistence/completion acceptance также зелёный.

**Следующая содержательная сессия: не искать новые фиксы. Сначала получить от пользователя уже собранную новую информацию по Kaspi и Stage04, отдельно собрать/зафиксировать два business contract, и только потом решать реализацию.** После этих блоков roadmap остаётся: Stage05 → Marketing/РНП → финальный аудит/Production acceptance/передача.
