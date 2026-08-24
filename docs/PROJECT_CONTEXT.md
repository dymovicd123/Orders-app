# Актуальный контекст проекта

Этот файл заменяет разрозненные `CLOUDFLARE_CONTINUATION_CONTEXT_STEP*.md`. Для новых изменений нужно читать его вместе с `docs/ARCHITECTURE.md` и исходным кодом текущей ветки. Старые step-файлы являются историей, а не источником актуальной версии.

## Защищённые решения интерфейса

### Приход товара — согласованный Step 115B

- Используется одна простая форма: товар, тип, пол, материал, длина.
- После выбора товара характеристики автоматически заполняются по наиболее частой известной комбинации.
- Пользователь может вручную изменить заполненные характеристики.
- Цвет и размер выбираются в матрице после кнопки «Показать таблицу».
- В матрице цвета расположены по столбцам, размеры — по строкам.
- Положительные количества создают или пополняют соответствующие складские клетки.
- Нельзя возвращать старый многоэтапный guided-интерфейс вместо этой формы.

### Менеджеры и цвета

- Выбор менеджера должен быть полноценным выпадающим полем с поиском, цветной точкой и датой начала работы.
- Менеджер в обычном рабочем режиме может выбрать себя при создании заказа; админ-режим для этого не требуется.
- Цветные обозначения менеджера должны отображаться в заказах, долгах, возвратах, клиентах, планах, лидах, отчётах и разделе «Команда».
- Раздел «Команда» сохраняет готовую палитру цветов и пользовательский цвет.
- Сотрудник связывается с историей через внутренний `manager_id`; одинаковые имена допустимы.
- Увольнение отключает сотрудника для новых операций, но не меняет старые заказы.

### Финансы и заказ

- Финансовая сводка состоит из трёх отдельных карточек: продажи, фактические движения денег, текущий долг.
- «Состав заказа» и товары в таблице показываются читаемыми карточками, а не слипшимся техническим текстом.
- Проверка наличия товара в форме заказа должна сохранять точную комбинацию и похожие варианты.

## Основные правила каталога и склада

- Вариант товара определяется связкой `товар + материал + длина`.
- Цвет, размер и пол не должны сами по себе создавать новый вариант.
- Пол не должен конфликтовать с политикой товара; для женских и мужских товаров значение фиксируется, для унисекс допускается выбор.
- Значение `СТАНДАРТ` должно присутствовать в справочнике материалов и не добавляться в видимое имя товара.
- Допускается «без цвета».
- Товар можно создать без заранее заполненных цветов и размеров; они могут появиться при приходе.
- Поиск должен учитывать похожие казахские и русские буквы и распространённые варианты написания.

## Правило внесения изменений

1. Никогда не заменять актуальные `src`, `worker` или миграции файлами из старого step-пакета.
2. Любое изменение выполняется поверх текущей версии и проверяется через `npm run release:check`.
3. Патчи должны содержать только изменённые файлы, а не `node_modules`, `dist`, SQL-бэкапы и старые контексты.
4. Перед изменением общей стилизации проверять баланс CSS и верхний уровень критических селекторов.
5. При рефакторинге сначала сохраняется поведение, затем отдельно меняется UX или бизнес-логика.
6. Любая правка связанной бизнес-цепочки считается незавершённой, пока не проведён сквозной аудит соседних read/write-paths, которые напрямую не менялись, но используют те же сущности, статусы, lifecycle-события, резервы, остатки, платежи, идемпотентность или историю. Нельзя исходить из предположения «этот участок не трогали — значит он безопасен».
7. Для каждого такого изменения перед релизом составляется карта влияния: источник события → серверная валидация → критическая запись → вторичные записи/readback → UI/Attention/история → retry/lost-response. Каждый соседний участок либо покрывается regression-test/статическим инвариантом, либо явно фиксируется как проверенный и неизменяемый.
8. Если новая логика меняет смысл общего состояния или границу ответственности (например, когда и кем меняется `inventory_stock`, reservation, fulfillment, lifecycle или order state), нужно отдельно проверить все другие операции, которые читают или пишут это состояние: create/edit order, handover/shipping, returns/exchanges, Workshop, transfers, stock checks/stocktakes, Attention, catalog resolution и history. Опыт Step 192B2A4 считается постоянным доказательством того, что локальный фикс без такого аудита недопустим.
9. Для опасных мутаций сначала доказывается retry/idempotency/atomicity и отсутствие false-failure после уже выполненной критической записи; затем проверяется UI. Потерянный ответ, повторный запрос, refresh и повторное действие не должны удваивать бизнес-эффект.
10. На Branch 2 выполняется технический gate, но если среда не содержит репрезентативных данных, это не считается достаточной функциональной приёмкой data-dependent сценария. Тогда Primary используется только для осторожной read-only/неразрушающей приёмки до любого реального mutation-теста.

## Текущий технический статус

- Frontend: React + TypeScript + Vite; `App.tsx` остаётся controller, крупные view-model/presentation части вынесены по feature-модулям.
- Inventory: controller + типизированные panel renderers; React hook ownership сохраняется у контроллера.
- Backend: Cloudflare Worker + D1; после Step 190.6A Worker разделён на `core`/`domains`, а `worker/index.ts` является composition root.
- Step 190.6C удаляет недостижимый Test1 Import Hub, legacy import/repair runtime и старые одноразовые Step-артефакты из активного source tree.
- Каждый runtime TS/TSX файл должен быть достижим из `src/main.tsx` или `worker/index.ts`; migrations и актуальные regression tests сохраняются как история схемы и защита поведения.
- CSS cascade/order остаётся частью принятого поведения; отдельная чистка CSS/bundle не смешивается с source cleanup.
- Step 190.0 access/auth остаётся отложенным до согласования с клиентом.
- «Приход» заморожен и защищён regression SHA; рефакторинг не должен менять его исходный блок.

<!-- STEP189-CONTEXT:START -->
## Последний checkpoint перед Step 189 — 2026-08-18

- Step 188K.2 client catalog cleanup успешно завершён; исторические заказы/резервы/stocktake evidence сохранены.
- Step 188K.3 вводит узкую раннюю выдачу складской части и разбор запоздалых заказов без общего partial-shipping engine. Rev 4 должен учитывать exact SKU check или FULL stocktake той же точки как fallback; статус deployment Rev 4 проверять по последнему live/post-check логу.
- Клиент НЕ должен вручную разбирать старые unresolved snapshots без текущей операционной причины. `Требуют разбора` должен быть очередью действий сейчас; исторический шум хранится как evidence и возвращается в review только если снова становится физически релевантным (например, return/exchange lifecycle).
- Step 189 выполняется небольшими проверяемыми частями: 189A stabilization/actionable queues/storage safety/release gate -> 189B visible honest histories -> 189C append-only financial events -> 189D team vs system audit -> Step 190 full-system audit.
- Не возвращать логический архив как основную модель; `Хранилище базы` = контролируемый physical retention старых безопасных месяцев. Не переусложнять UI.

Полный план: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189_PLAN_2026-08-18.md.
<!-- STEP189-CONTEXT:END -->

<!-- STEP189A1_OPERATIONAL_CLEANUP_START -->
## Step 189A.1 — Operational Cleanup & Stocktake Save Safety

- «Требуют разбора» — operational queue only; old history is hidden, not deleted.
- Old hidden unresolved rows are surfaced only when that exact order becomes operational again.
- Catalog resolution no longer sweeps unrelated stale legacy orders with the same text.
- Stocktake autosave reports only server-confirmed saves; bulk zero and final flush are failure-aware; Enter/blur saves are deduplicated.
- Step 188K.3 REV 4 is cumulative in this package if not yet deployed.
- Next: 189A.2 Storage Cleanup safety + one reliable release gate; then 189B/189C/189D as documented in Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189_PLAN_2026-08-18.md.
<!-- STEP189A1_OPERATIONAL_CLEANUP_END -->

<!-- STEP189A2_STABILIZATION_START -->
## Step 189A.2 — Review, Storage Safety & Release Gate

- «Требуют разбора» is a current-work queue; old June/legacy noise does not stay in the normal list. Exact old orders can resurface only their own unresolved rows when a later operation needs them.
- «Не добавлять в каталог» keeps the original order snapshot but deliberately excludes that reviewed line from catalog/inventory accounting.
- The UI no longer shows a technical count of hidden old review rows.
- Storage Cleanup now blocks active/unresolved reservations, pending inventory lifecycle events and active stocktakes, and deletes target lifecycle references before linked inventory movements.
- npm run check is the current release gate: targeted 189A.2 SQL tests -> TypeScript -> clean Vite build -> deploy identity verification -> Wrangler dry-run.
- Step 189A stabilization is complete after production verification. Next: 189B existing history visibility, then 189C financial event history and 189D team/system audit separation.
- Full context: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189A2_STABILIZATION.md and Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189_PLAN_2026-08-18.md.
<!-- STEP189A2_STABILIZATION_END -->

<!-- STEP189B_BUSINESS_HISTORY_START -->
## Step 189B — Business History Visibility

- История склада конкретной позиции теперь идёт через отдельный server query, а не через локальную фильтрацию последних 120 движений.
- Завершённые ревизии и физические сверки видимы отдельно; перемещения TR отображаются одним документом.
- Возвраты и обмены: server-side поиск/период/status, 50 строк + «Показать ещё», явные loading/empty/error states, комментарий и причина отмены разделены.
- Касса: компактные прошлые циклы без смешивания с текущим журналом.
- Step 189B не меняет D1 schema, остатки, резервы, приход или финансовую модель.
- Health marker: businessHistoryVisibility=189b.
- Full context: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189B_BUSINESS_HISTORY.md.
- Next: 189C financial events -> 189D Team/System Audit -> Step 190 full audit.
<!-- STEP189B_BUSINESS_HISTORY_END -->

<!-- STEP189C_RELIABLE_MONEY_HISTORY_START -->
## Step 189C — Reliable Money History

- Added append-only financial_events history; current payments/returns/orders remain present-state truth.
- Payment corrections/refund cancellations create new history rows instead of erasing the earlier money event.
- UI: simple server-paged «История денег»; no accounting journal and no mandatory actor audit.
- 0058 backfills only provable existing facts and never rewrites current money tables.
- financial_events intentionally has no FK to orders so future retention can remove old detailed orders without breaking compact money history.
- Cash register, Warehouse, stocktake, Arrival and reservations are unchanged.
- Health marker: reliableMoneyHistory=189c.
- Full context: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189C_RELIABLE_MONEY_HISTORY.md.
<!-- STEP189C_RELIABLE_MONEY_HISTORY_END -->

<!-- STEP189D_TEAM_ACTIVITY_CLEANUP_START -->
## Step 189D — Team Activity Cleanup

- Team «Активность» is now «Работа с заказами»: commercial facts attributed to the manager of the order, not proof of who clicked a button.
- Return/exchange creation and later cancellation are separate events; current status no longer rewrites the earlier fact.
- Manager totals are calculated over the entire selected period in SQL; the visible feed is paginated 50 + «Показать ещё».
- Manager is visible in Returns, Exchanges, Money History and the supplementary order-action journal.
- The old activity_log UI is narrowed to order-linked supplementary history; technical event names/internal DB order-ID filtering are removed.
- No order transfer/reassignment workflow and no heavy actor/system-audit architecture were added.
- 189D has no new D1 migration; if 0058 was still missing, this cumulative installer safely completes the additive 189C migration first.
- Warehouse, stocktakes, Arrival, reservations, cash and order business state are unchanged by 189D.
- Health marker: teamActivityCleanup=189d.
- Full context: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189D_TEAM_ACTIVITY_CLEANUP.md.
<!-- STEP189D_TEAM_ACTIVITY_CLEANUP_END -->

<!-- STEP189D1_PRE_AUDIT_STABILITY_START -->
## Step 189D.1 Rev 2 — Pre-Audit Stability

- Live Primary verification exposed D1_ERROR: too many terms in compound SELECT in Team Activity. Rev 2 removes the compound Team report completely.
- Orders, reliable money/debt events, return create/cancel and exchange create/cancel use independent small read-only SELECTs; D1 batches them and the Worker merges rows + manager aggregates.
- Health: teamActivityCleanup=189d1, preAuditStability=189d1, teamActivityQueryPlan=split-selects-r2.
- Failed first loads still show —; stale prior data is labeled; structured Worker 5xx errors remain visible.
- Team history displays the business actionDate used by report filters while actionAt remains only for ordering.
- No D1 migration/business-state changes.
- Full context: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP189D1_PRE_AUDIT_STABILITY.md.
- Next after successful live verification: Step 190 Full System Audit.
<!-- STEP189D1_PRE_AUDIT_STABILITY_END -->

<!-- STEP1901_CRITICAL_OPERATION_RELIABILITY_START -->
## Step 190.1 — Critical Operation Reliability

- Step 190.0 access/auth changes are deferred pending client approval.
- 0059 adds internal retry/idempotency state only; existing business rows are not rewritten by migration.
- Create/edit order, return create/cancel, exchange create/cancel use stable request IDs and resumable server steps.
- Money-only return creates no physical return_items.
- Team internal sentence about button-control/audit was removed.
- Arrival UI remains frozen.
- Full Step 190 plan: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP190_PLAN.md.
- Step context: Context/CLOUDFLARE_CONTINUATION_CONTEXT_STEP1901_CRITICAL_OPERATION_RELIABILITY.md.
- Next planned step after production verification: 190.2 Cloudflare bulk-limit corrections.
<!-- STEP1901_CRITICAL_OPERATION_RELIABILITY_END -->
