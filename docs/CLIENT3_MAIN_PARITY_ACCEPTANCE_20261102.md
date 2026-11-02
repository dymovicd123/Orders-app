# Client3 — единый план доведения до Main (02.11.2026)

**Статус документа:** актуальный рабочий план. Система Client3 продаёт часы TAUWACH / WACHIZEN. Базовый продукт и поведение — Main, а не заново сконструированный сокращённый ERP. Этот файл заменяет разрозненные «почти parity» критерии в качестве статусов готовности. Любое закрытие задачи — только после релиза Client3 и проверки живого сценария.

## 0. Зафиксированные требования и границы

- Отдельные заказы, остатки, резервы, полномочия и финансовые отчёты каждого бренда. **Справочники характеристик, доставок и оплат — общие для обоих брендов**.
- Модель, пол (мужской/женский), механизм, материал браслета (сталь/кожа/каучук), цвет циферблата, цвет кожаного ремешка. Размеров, длины и цеха нет. Каталожная цена отдельно от цены продажи.
- Точки хранения: Офис и Витрина (позднее уточнение исходной заявки «только офис»). Каждая точка имеет собственный физический остаток и резерв.
- В заказе ФИО/телефон/адрес/город/индекс, доставка, точная дата и время дедлайна, срочность, текст гравировки для **каждой товарной позиции**, отдельные оплаты, долг.
- «Заказы» — реестр продаж/финансов/редактирования/возвратов/обменов. «Логистика» — гравировка/готовность и физическая отправка. Подтверждение готовности не равно отправке.
- Сохраняем канонические позиции и бухгалтерские/складские действия Main; не создаём независимые параллельные проводки. Не трогаем Main, Branch2 и их D1, не копируем чужие заказы в Client3.

## 1. Что реально есть по исходникам и релизам

| Компонент | Статус на 02.11 | Подтверждённое наличие | Разрыв до Main |
|---|---|---|---|
| Изолированная установка и вход | База есть | Третий Worker/D1, экран входа, панель Main-подобной навигации, admin/manager/logist, назначение менеджеров на бренды | Полная визуальная и ролевая проверка в браузере отсутствует |
| Два бренда | Есть базовая работа | Серверная фильтрация заказов и SKU, переключатель брендов склада/логистики, раздельные финансы | Проверить все ID lookups/экспорты и роли без межбрендовых утечек |
| Общие справочники | Выпущено; требуется браузерная проверка | Администратор создаёт, редактирует и удаляет общие значения механизма, материала браслета, цвета циферблата/ремешка, оплаты и доставки; составные имена с пробелами | Пол только мужской/женский; системные brand/source не редактируются; визуальная проверка всех форм под ролями ещё не завершена |
| Каталог часов | Выпущено; требуется браузерная проверка | Модели, SKU, цены, брендовые карточки, редактирование имён моделей и характеристик неиспользованных SKU; удаление позиции/исполнения/всего товара с защитой истории и резервов | Для использованных SKU редактирование идентичности запрещено как в Main — новая позиция и удаление старой; полноценное визуальное QA и удобство потока ещё открыты |
| Остатки | Частично | Офис/витрина, физический/резерв/свободно, поиск по моделям | История SKU, детальные действия и взаимодействие как в Main неполные |
| Операции | Частично | Приход, перемещение, списание и отдельный пересчёт одного SKU с защитой резервов | Пакетные операции, полноценная выборочная/полная ревизия и история Main отсутствуют |
| Создание заказа | Выпущено (основной поток); нужна проверка сотрудниками | Обязательный бренд, до 20 позиций, свой источник/количество/цена/гравировка на каждую, свободный ввод новой модели и характеристик с пробелами, до 8 оплат, срочность и точный срок; дефицит сохраняется как незавершённый резерв | Редактирование уже созданного заказа и полное перенесение вспомогательных Main-сценариев ещё открыты; браузерное QA по ролям не подтверждено |
| Оплаты | Реализованы при создании | До 8 строк разных способов/сумм, записи в Main money ledger, защита повторного сохранения, расчёт долга | Закрытие долга/коррекция оплат в существующем заказе не перенесены полностью |
| Заказы (реестр) | Выпущен 12-колоночный обзор, действия ещё частичны | Поля Main: дата/номер, менеджер, клиент, город, все товары, доставка/срок, отдельные оплаты, сумма/получено/долг, статус; бренд/месяц/поиск/отправка/долг и детализация | Редактирование, удаление заказа, доплаты и корректировки Main не перенесены; возврат/обмен пока ограничены одно-позиционными заказами; браузерное QA отсутствует |
| Логистика | Частично | Очередь, срочность, дата/время, гравировка, отдельно подтверждения готовности и физической отправки; роли раздельные | Отправляется целый однострочный заказ. Выбор товара/количества, частичная отправка, отмена/уточнение выдачи отсутствуют |
| Возвраты/обмены | Ограниченный сценарий | Денежный/физический возврат, очередь фактической приёмки, обмен одной отправленной единицы с резервами и защитой SKU | `lineCount===1`, обмен при количестве 1, нет полноценного выбора позиций/частичных цепочек/отмен Main |
| Resolver | Нет полноценного | Сопоставление по уже созданному точному watch SKU через canonical links и brand scope | Main advisory resolver, исправление неоднозначности и сохранение identity на всех переходах не перенесены |
| Финансы | Частично | Движение денежных событий и методы по брендам, суммы поступлений/возвратов | Не полный Main Finance/касса, корректировки/сверки/расширенные отчёты отсутствуют |
| Сотрудники/прочее | Частично | Админ-аккаунты, список менеджеров/назначений; исторические заказы администратору | Работа команды, клиенты, планы, лиды, отчёты Main не завершены, не блокируют критичный поток |

**Свидетельства деплоя:** [смешанные оплаты и справочники](https://github.com/dymovicd123/Orders-app/actions/runs/41489102944), [позиции и оплаты в реестре](https://github.com/dymovicd123/Orders-app/actions/runs/41489778407); оба SUCCESS. `npm run build`/SQLite/SSR прошли; реальное браузерное QA под сотрудниками по всем ролям **не подтверждено**.

## 2. Этапы и порядок

### Этап 1 — справочники, каталог и точная идентичность (P0)
1.1 Общие редактируемые справочники характеристик, доступные во всех SKU формах. Пол остаётся только муж/жен, системные brand/source — не произвольный ввод. Изменяемые механизм/браслет/цвет циферблата должны безопасно проходить БД, нормализацию, старые SKU и resolver; прежде создать совместимую схему/адаптер. Не включать фальшивые editable поля до API.
1.2 Довести каталог Main: создание/редактирование модели и вариантов, цены, отключение/восстановление при разрешённых остатках, быстрый выбор, информативные ошибки; никаких «подготовить SKU» без понятного смысла пользователю.
1.3 Проверить идентичность бренда/SKU/источника/резерва на приходе, продаже, отправке, обмене и возврате; не переписывать складское ядро, если проверенная функция Main уже подходит.
**Готово:** админ заводит значение в общих справочниках, создаёт SKU в обоих брендах, принимает и продаёт, характеристики не теряются; старые товары/остатки не меняются.

### Этап 2 — настоящие Заказы Main: форма, таблица и редактирование (P0)
2.1 Перенести поведение/структуру `CreateOrderSection` и `OrdersTableSection` через Client3-адаптеры; сохранить оригинальные действия и плотность таблицы, а не только CSS-классы.
2.2 **Сначала backend**, потом UI: расширить `watchCommit` с одной строки до массивов `order_item_id -> watch_variant_id -> engraving_text`; обеспечить канонические SKU, резервы, цены, запись и повторяемость операции. Добавить несколько часов/комплектаций с разными количества­ми и гравировками.
2.3 Полноценное редактирование существующего заказа (клиент/доставка/город/контакты, товары и цены по правам), корректировка оплат, дополнительная оплата/долг, удаление с правильными последствиями и аудитом.
2.4 Полный Main-подобный реестр: фильтры, статусы, товарная детализация, действия с заказом без искусственных ограничений по наличию возврата/обмена.
**Готово:** два разных SKU в одном заказе, две разные оплаты, редактирование, корректное закрытие долга, правильные резервы и отображение в одной таблице. Без скрытых несохранённых изменений.

### Этап 3 — логистика и реальная отправка (P0)
3.1 Адаптировать рабочий экран Main со сроками, срочностью, группами и действиями, сохранив понятную роли логиста.
3.2 Выбор конкретных готовых позиций и количества к отправке через проверенный Main dispatch engine. Статусы на строках «Отправлен/Не отправлен», на заказе «Частично отправлено», если применимо.
3.3 Возобновляемая отправка остатка, безопасная отмена/уточнение фактической выдачи и корректные movements/reservations. Гравировка не становится отправкой.
**Готово:** из двух часов отправляем один, второй остаётся в резерве/очереди; затем отправляем второй. Повторная команда не дублирует движение; возврат отправленного отдельно работает.

### Этап 4 — возвраты, обмены, resolver и уточнения (P0)
4.1 Перенести работу с конкретными позициями и частичными количествами, убрать `lineCount===1` и запреты, когда уже был частичный возврат/обмен.
4.2 Денежный, товарный и смешанный возврат; отдельное физическое поступление с понятными статусами, без автоматического увеличения остатков до приёмки.
4.3 Обмен: старая и новая позиция, обязательное состояние физической отправки/возврата, последствия для цен, денег и резервов; отмены/исправления с аудитом.
4.4 Resolver из Main адаптировать для часов: точное определение по атрибутам, советы при неоднозначности, никакой молчаливой потери `variant_id`.
**Готово:** часть товаров возвращена/обменена, остальные позиции остаются доступны для обычных действий; идентичность и суммы сходятся.

### Этап 5 — полное складское рабочее место (P1, фундаментальные ошибки — P0)
5.1 Складской интерфейс Main: каталог, остатки, операции, поиск, карточка SKU, история движений и причины.
5.2 Массовый приход/списание/перемещение и выборочная/полная ревизия. Кнопка «Исправить количество» открывает конкретную позицию.
5.3 Доступы сотрудников, отображение двух брендов, понятные предупреждения дефицита и неуспешных операций, мобильная работа.
**Готово:** несколько SKU в одной операции, понятная история и корректные физические/зарезервированные/доступные остатки.

### Этап 6 — финансы, команда и итоговая проверка (P1/P2)
6.1 Сверить финансовые данные и действия с Main: долг/доплата/коррекция/возврат, удобные фильтры и детализация, строгий брендовый scope.
6.2 Довести права администратора, менеджера и логиста; расширенные разделы (планы/лиды/отчёты/клиенты) — после критического потока и только если требуются этому клиенту.
6.3 Реальные сквозные проверки: ПК/телефон, оба бренда, сотрудник разных ролей, 2 SKU + 2 платежа, частичная отправка, возврат, обмен, пересчёт, сохранность старых данных.
**Готово:** каждая операция из плана доступна сотруднику, функционально и визуально сопоставима с Main, все финансовые и складские события проверяемы.

## 3. Как исполнять без повторения провалов

- Для **каждой подзадачи** перед реализацией открыть оригинальный раздел Main и соответствующие API, составить маленькую таблицу «Main → Client3: переиспользуем / адаптируем / убираем». Не заменять Main стили похожими вручную.
- Менять только отдельные ветки `client3/*`; новые функции сначала проверять на третьей тестовой среде / disposable SQLite, без касания Main и Branch2. Не портить рабочее ядро ради визуальной схожести.
- Проверять **только затронутые сценарии + базовый склад/заказ/деньги** после подзадачи, затем браузерный smoke в Client3. Полный сквозной набор — на границах этапов. Никакой массы дублирующих grep-«тестов» как замены функциональности.
- После каждого релиза дописывать в этот файл: статус **не начато / в работе / в коде, не выпущено / выпущено / проверено в браузере**, ссылку на конкретный Actions run и реальные открытые проблемы.
- **Не закрывать этап по SSR, CI, наличию CSS-классов или зеленой сборке.** Не писать «как в Main», пока действия не работают так же.
- Приоритет: P0 = блокирует нормальную продажу/товарооборот; P1 = функциональное доведение и удобство; P2 = второстепенные разделы.

## 02.11.2026 — Step 1 / verified Client3 release

**Released:** https://github.com/dymovicd123/Orders-app/actions/runs/41495945406 (SUCCESS). Branch `client3/step1-main-catalog-references-20261102`.

- Shared reference administrator actions: add/edit/delete (mechanism, bracelet material, dial color, leather strap color, payment method, delivery). New mechanism/bracelet/dial choices are in extension table `watch_reference_values_v5`; existing references are not rebuilt. Embedded whitespace retained in values; repeated whitespace normalized.
- Watch SKU custom attributes are stored in `watch_variant_attributes_v5` referencing unchanged `watch_variants.id`. Old check-constraint fields, all existing watch/order IDs and Main's complex catalog triggers remain untouched.
- Original Main `assertCatalogVariantMayDeactivate` reused for server deletion preview. Admin can remove one SKU, an execution group or a whole watch model from active workspace, preserving historic links; actual physical stock/reservations and unresolved work block removal. Retirement events written to original Main journal.
- Client3 D1 V5 extension applied and all historical counts verified unchanged; remote `PRAGMA foreign_key_check` clean; exact third Worker deployed; anonymous access to protected watch API refused.
- CI isolated checks: https://github.com/dymovicd123/Orders-app/actions/runs/41495558612 (SUCCESS). Tested full Main migrations, custom values with spaces, historical sold watch FK integrity, stock-blocked SKU removal, group removal, original retirement events, order/exchange/warehouse regression and TS/Vite build.

**Remaining within full Step 1:** complete Main-equivalent *editing* of existing product names and variant attributes (not just creating/retiring), detailed brand-specific catalog usability and authenticated visual QA on desktop/mobile. Do not report Step 1 as fully closed until these have been implemented and tested. The user specifically requested deletion rather than mere hide toggles; the customer-facing action is deletion, with Main-compatible historical retention.

## 02.11.2026 — Step 1.2 / Main catalog editing, release 2

**Deployed, third system only:** https://github.com/dymovicd123/Orders-app/actions/runs/41498779486 (SUCCESS). New product name editor changes only `watch_products.model_name` with expected-name guard; never rekeys canonical product IDs or adjusts stock. Draft SKU characteristic editor supports values with internal spaces, collision avoidance across the original UNIQUE constraint and the Client3 V5 extension, and request-staleness protection. Original Main catalog layout classes reused; responsive edit form added.

**Deployed, third system only:** https://github.com/dymovicd123/Orders-app/actions/runs/41499935278 (SUCCESS). Unused linked watch SKU can now change exact gender/mechanism/material/dial identity **in place** under the real Main `catalogVariantHasOperationalUsage` rule and extra SQL write-time guards. Canonical variant ID is preserved; any catalog execution prices (cost and sale) carry to the new execution where no target price exists. If order, stock, reservation, revision or movement history exists, the edit is rejected, with a form to add a new corrected SKU and subsequently remove the old one safely. No new schema migration; remote third D1 order/stock/payment/user counts unchanged.

**Tests:** https://github.com/dymovicd123/Orders-app/actions/runs/41499801836 (SUCCESS), full Main-derived SQLite and Client3 regressions, stale edits, duplicates, cross-brand access, zero-history vs. used-history linked edits, original ID preservation, catalogue price continuity, SSR/TS/Vite build. Smoke public UI and anonymous PATCH protection included in release workflows.

**Outstanding:** A logged-in browser visual/role test for catalog and shared reference CRUD on desktop/mobile; newly entered reference values must also be verified in the end-user order form. Full Client3 Main parity continues with Step 2 (multi-item order creation/edits and Main-style Orders table), Step 3 (logistics and per-item dispatch), and later stages. Do **not** mark the entire system or Stage 1 fully browser-verified.

## 02.11.2026 — Stage 2: Main-like usable order registration and ledger

**Release A (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41503682235 — existing active catalog SKUs, whether physically stocked or not; brand required; multiple distinct watch lines each with independent Office/Showcase source, quantity, sale/catalog price, engraving; multiple payments. Main's existing critical create/reservation/money engine reused. Shortage is recorded as **unresolved / pending reservation**, not an invented physical receipt, and doesn't block order registration. 12-column Main-like financial table with separate payment/debt columns, deliveries, deadlines, items and stock flags; filters on shipping and debt and model search.

**Release B (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41505275974 — free manual watch entry when the model/SKU isn't in catalog yet, with text model name and mechanism/bracelet/dial/strap characteristics including embedded spaces. Only a manager entitled to the chosen brand (or admin with an authorized manager) may add order-owned model/variant; underlying watch SKUs are provisioned as Main canonical identities. Shared references are added without brand separation; *no stock receipt or movement is synthesized*. Reuses request-ID replay, strict money amount rules and brand write protection. No D1 migrations; third Worker only, D1 counts/FK check and anonymous write checks remain clean.

**Acceptance runs:** https://github.com/dymovicd123/Orders-app/actions/runs/41503387685 and https://github.com/dymovicd123/Orders-app/actions/runs/41505099907 (both SUCCESS). Full Main-derived SQLite and Client3 order+exchange+warehouse regression, absent-stock pending reservation, multiple independent lines, mixed payment, idempotence, cross-brand 403, multiword manual model+attributes, no fabricated movements and TypeScript/Vite build. These tests do not constitute logged-in browser QA.

**Open blockers for complete Stage 2 parity:**
- Existing order edits: customer/shipping metadata, item-price changes and deletion/audit, including safe consequences for reservations. **Debt closure is now implemented and published through Main's critical finance engine**.
- Main OrdersTableSection action parity; current table has the Main's key 12 columns and summaries but not all native Main action subforms.
- Selective shipment of **whole order-item lines** now works for multi-watch orders through Main's engine, including pending reserve and engraving protection. Remaining: split quantities **within** a line, item-specific physical returns/exchanges, cancellation/correction. Do not conflate a partially shipped order with wholly sent.
- Authenticated desktop/mobile UX inspection, especially free-entry and zero-stock line warnings, must be performed before announcing full rollout.

## 02.11.2026 — Stage 3: real selective watch shipment + partial status + debt action

**Client3-only deploys:**
- https://github.com/dymovicd123/Orders-app/actions/runs/41506805707 — SUCCESS. Logistics now selects individual READY reserved order-item lines from the same multi-watch order; Main's `dispatchSelectedCompleteOrderLines` does all financial-independent stock movements and reservation fulfilment. Explicit multi-line selection required, not blindly ship all. Idempotent dispatch request IDs and strict brand/SKU/engraving guards. No invented physical inventory. Tests cover one unengraved line shipped while another engraved line remains reserved; second dispatch after engraving; repeated requests; foreign-brand denial.
- https://github.com/dymovicd123/Orders-app/actions/runs/41507282339 — SUCCESS. Orders ledger shows **Частично отправлено** based on actual dispatch records and `Отправлен / Не отправлен` per item; logistics shows correct per-item source and reservation state.
- https://github.com/dymovicd123/Orders-app/actions/runs/41508084710 — SUCCESS. Brand-scoped **Закрыть долг** action in expanded Orders details; paid amount may be partial or full. Reuses Main `createManualOrderPaymentCritical` with real payment/money event, atomic current-balance check and requestId idempotence. Configured shared payment methods, actual payment date and optional comment. No warehouse movement. Anonymous request guard and pre-/post-deploy third D1 count checks. Payment regression includes partial/full debt, stale idempotent retry, concurrent overpay denial, wrong-brand access, no movement.
- QA: https://github.com/dymovicd123/Orders-app/actions/runs/41506734625 and https://github.com/dymovicd123/Orders-app/actions/runs/41507941989 — SUCCESS; TypeScript/Vite build and real Main-derived order/warehouse/payment scenarios.

**Operationally available now:** multiple-watch sales including zero stock and unknown-model manual entry; partial shipping by whole item row; distinct payments at creation, debt closure after creation; Main-like financial 12-column ledger and per-SKU shipping visibility. All changes only to isolated third Worker; no schema migrations and no Main/Branch2 deployments.

**Remaining before full Main parity / operational signoff:** admin/manager edit of customer delivery fields and order item prices; safe cancellation/deletion (with reservation consequences); splitting a single line's quantity for shipment (requires preserving watch engraving mapping for new line); multi-item return/exchange with explicit selection; verified authenticated web/mobile UX and staff role test; history and stocktake beyond this stage. Do not represent deployment/synthetic tests as a verified end-to-end human browser session.

## 03.11.2026 — urgent user-visible Main order form correction: NO SKU selector

**Released Client3 only:** https://github.com/dymovicd123/Orders-app/actions/runs/41510527731 — SUCCESS. **QA:** https://github.com/dymovicd123/Orders-app/actions/runs/41510402901 — SUCCESS.

The user rejected the still-present catalogue dropdown, manual entry switch and English default watch names. The production order form now **always opens in direct free-text item mode** after mandatory brand selection; the catalogue is *suggestions only*, never a creation prerequisite. This reuses the actual `SmartPickerInput` from Main for model name, movement, bracelet material, dial colour and leather strap colour. Internal enum codes quartz/mechanical/steel/leather/rubber/black etc. are displayed as Russian labels; labels are mapped back to their canonical codes on save to preserve SKU identity and movement matching. New values and multi-word names are still accepted and shared reference values flow into suggestions. For real model names entered in Latin by staff, the app retains original spelling rather than silently changing customer data.

The order form is no longer blocked while catalog suggestions load: a manager can register an unlisted zero-stock item immediately. Per-brand mandatory choice, quantity, office/showcase source, distinct engraving text, sale price, split payments, delivery deadline, urgency and pending reserves remain intact. No DB migrations and no Main/Branch2 changes. Post-deploy anonymous write protection, UI status and historical database counts checked through the release workflow.

**Still not browser verified:** real logged-in employee mobile/desktop interactions and visual QA. Separately staged admin/manager edit functionality was interrupted by this urgent user form correction and has **not** been released in this hotfix; avoid marking full editor done.

## 03.11.2026 — Continued after free-text hotfix: manager-safe Main order corrections

**Deployed only Client3:** https://github.com/dymovicd123/Orders-app/actions/runs/41512452992 (SUCCESS). **Acceptance:** https://github.com/dymovicd123/Orders-app/actions/runs/41512365658 (SUCCESS). Base includes the previously deployed mandatory-brand, Main SmartPicker **free-text** order form; no return to catalogue-only creation.

The Orders table expanded row now exposes **«Доп. действия · исправить»** for managers and **«Редактировать / исправить»** for admins. Two safely separated actions: «Реквизиты» (name, phone, city, delivery, comment; date only for admin) and «Записанная цена» per exact active line. Both call the **existing Main `updateOrderCritical`** with narrowly isolated `metadataCorrection` or `itemPriceCorrections` and original snapshots. The server checks employee/brand entitlement and watch SKU ownership, retries via original critical request IDs, blocks manager date changes, stale edits and overpaid totals. Watch-specific recipient/name/city/method projections are synchronized after successful canonical metadata update, including replay/resume. No stock movements, reservation replacement or payment rewrite for these correction modes. Admin can use these narrow actions but is not yet given a *complete* item composition editor.

The order register now includes canonical Main customer snapshot, original line total, catalog price snapshot and return totals for optimistic concurrency. Responsive correction controls added; tests use Main migrations in SQLite and cover actual metadata+price updates, replay, price stale, wrong-brand access, manager date permission, and unchanged stock/payments. The release pre/post checked remote third D1 order/item/payment/stock counts and FK integrity, and anonymous write access denied. No D1 migrations, no Main or Branch2 changes.

**Still open for full admin edit parity:** complete product/quantity/source/manager rework with preservation of `watch_order_item_details`, `watch_order_details` and canonical reservations on a multi-item order; watch-only logistics address/deadline/urgency and per-line engraving corrections; Main previewed order deletion. Admin role should never use manager shortcut as a substitute for a real guarded full editor. Authenticated browser / mobile acceptance remains outstanding.

## 03.11.2026 — Admin watch-specific safe editing, after Main manager corrections

**Client3 third Worker deployment:** https://github.com/dymovicd123/Orders-app/actions/runs/41513414029 (SUCCESS). **Validation:** https://github.com/dymovicd123/Orders-app/actions/runs/41513241061 (SUCCESS). Main and Branch2 not changed; no database migrations.

New admin-only third mode in expanded Orders correction form: **«Данные часов и логистики»** — full delivery address, postal code, urgent flag, precise shipping deadline (Asia/Almaty shown, UTC stored), and each actual watch order line's engraving text. The form uses the **existing order and brand** rather than creating any replacement goods or bookings. An atomic D1 batch compares every original watch detail and item line, refuses stale data, mismatched line identities, operations after shipping, and engraving changes once logistics marks ready. Administrative role is enforced server-side; a manager cannot call this endpoint. No changes to finance, SKU identity, physical inventory or reserves.

**Automated scenarios** prove successful admin corrections and replay; rejection for manager, foreign brand, stale state, completed engraving and physically shipped order; unchanged payments/movements; full Client3 order/return/exchange test and TS/Vite build. Remote release smoke checked protected write paths and preserved D1 counts. No authenticated employee browser/mobile QA yet.

**Remaining to complete real Main admin editor:** adding/replacing/deleting order item rows and quantities/sources, changing responsible manager with exact watch-brand entitlements, full order deletion preview and recovery; reconciled watch-specific order item links and reservations must be maintained. Existing manager narrow correction, admin Main metadata/date/price corrections, and admin watch logistics/engraving correction are available but are **not** a full admin composition editor. No claim that multi-line return/exchange selection or partial quantity shipping is completed.

## 03.11.2026 — Stage 2 admin Main order actions: manager reassignment, guarded deletion and payment-method correction

**Release 1 (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41514921305. **QA (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41514798263.
- Admin-only action «Сменить менеджера» in expanded Orders. Only active managers assigned to this watch brand; stale current manager, foreign brand, shipped/fulfilled, active return/exchange, or unreconciled itemized total blocks the action. Uses Main `updateOrderCritical` for a non-inventory, non-payment editor operation. Preserves existing finance, order item IDs and stock. The optional Main manager-audit table may be absent on historical deployments; do **not** assert guaranteed audit-row persistence without checking runtime table.
- Admin-only «Удалить заказ» is **not** a one-click delete. GET uses Main `previewAdminOrderDeletion` with exact snapshot fingerprint, payments, returns, exchanges, physical handover and blocking reasons. POST rechecks the snapshot and runs Main `deleteOrderSafely`; requires a written reason and explicit checkbox. Additional watch tenant guard blocks *any* physically dispatched, fulfilled or non-active sale, including falsely `not_sent` orders with individual dispatches. Deletion is historical/logical; `watch_order_details` remains linked to deleted Main order for audit. Main and Branch2 never deployed; third only, no migrations.
- End-to-end SQLite covers brand/role/stale manager reassignment, money and stock invariants; admin delete preview/authorization, a successful safe unshipped deletion, retained watch history and blocked shipped order.

**Release 2 (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41516046177. **QA (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41515920167.
- Admin-only «Исправить способ оплаты» corrects the method of a specific recorded order payment. It uses Main isolated `paymentCorrections` with full old snapshot, not a direct ledger UPDATE or cash rewrite. Change must belong to this order and brand and use a configured global watch payment method; the server checks admin role. UI shows each actual payment with date/amount and selected corrected method.
- Order register includes payment comment for exact optimistic comparison. Tests confirm method update KASPI GOLD → KASPI RED, same money totals, untouched physical movements, idempotent replay, manager/foreign-brand rejection. A historical lightweight list-read fixture was updated with Main's `payments.comment` column. Build and lifecycle regressions passed. Deployment third Worker only; historical D1 counts and foreign keys checked and protected anonymous writes rejected.

**Incomplete Main admin parity remains significant:** item addition/removal, quantity or source revision and replacement of existing SKU **cannot safely use** generic Main `itemContentReplacement` by itself: Main may retire and recreate canonical `order_items` but Client3's `watch_order_item_details` (engraving/SKU identity) is attached to individual order item IDs. A fully resumable watch-aware item replacement adapter must re-link every newly written order row and reservation inside the Main edit saga, and ensure already dispatched items remain immutable. Until this is implemented and tested, do not expose a cosmetic fake full item editor. Other pending: verified logged-in role/mobile browser QA, item-selective multi-line Return/Exchange, partial quantities within a line, customer testing.

## 03.11.2026 — Stage 2 completed: admin order-item composition editing

**Third-only deployed release (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41518472720
**Critical automated acceptance (SUCCESS):** https://github.com/dymovicd123/Orders-app/actions/runs/41518294319
**Source:** branch `client3/step2-admin-watch-composition-rewrite-20261103`.

The Client3 Orders expanded **Редактировать / исправить** UI now includes admin-only **Состав товаров**. It supports adding/removing watch rows; changing model name, gender, movement, bracelet material, dial colour, leather strap colour, office/showcase, quantity, sale price, and line-specific engraving. Inputs use Main's real `SmartPickerInput` with Russian labels and existing catalog/reference suggestions, but no forced catalog dropdown. A new manual model/SKU can be added with zero stock. Brand remains fixed from the original order; manager cannot call the replacement endpoint.

**Main engine with exact watch identity:** `updateOrderCritical` owns resumable `itemContentReplacement`, payment math, reservations, old-row logical retirement and new item insertion. The branch adds a trusted, tenant-only `watchRewrite` adapter: all watch SKU IDs and brand references are verified before Main reverses old reserves; Main's garment name resolver is bypassed only for these already-verified watch SKUs. At Main's `new_content_written` saga step, `attachClient3WatchRewrite` uses the critical operation's mapped order-item IDs and a single D1 batch to attach (or confirm) exact `watch_order_item_details` identities and engraving before advancing the critical step. Existing unchanged rows preserve their identity/reservation when Main approves; replaced/removed historical rows remain available for history. The order total and debt are Main-calculated. No direct stock quantity or payment mutation from the Client3 adapter.

**Verified integrated scenario:** multiwatch order with paid part; admin changes quantity for first line, removes second, adds alternate SKU from another source with distinct engraving. The order has the correct new active SKU links and amounts, the removed old item is retained with quantity 0, Main reservations remain recorded, money is not duplicated. Manager and cross-brand calls are rejected; stale originals, overpayment, sent/partially dispatched orders and active Returns/Exchanges are blocked. Main-style sale creation, dispatch, warehouse, returns/exchange, read table and TypeScript/Vite build pass. Release checked protected routes and third D1 integrity. No migrations and no Main/Branch2 deployments.

**Explicit limits of this completion:** normal complete-order composition editing is for unshipped/unreturned orders only, exactly as required to avoid rewriting real physical handover. Existing sent or partially sent orders must use Return/Exchange and logistics correction flows. Full authenticated visual/mobile role QA remains unperformed (user explicitly requested speed rather than manual testing). Partial quantity shipment within one order line and multi-line selective Return/Exchange remain separate Stage 3/4 scope, not part of Stage 2 editor. The first-time successful edit and stock/money invariants are covered by automated integration tests; error recovery after a mid-saga database/network interruption has not been separately fault-injection tested.

## 03.11.2026 — Stage 3 logistics: split quantities and correct erroneous shipments

**Release A (SUCCESS, third Worker only):** https://github.com/dymovicd123/Orders-app/actions/runs/41520465704
**Acceptance:** https://github.com/dymovicd123/Orders-app/actions/runs/41520285900 (SUCCESS)

The logistics screen now accepts an integer **quantity to ship per selected watch line** instead of forcing the line's full quantity. Main `dispatchSelectedCompleteOrderLines` remains the sole stock movement/reservation authority: shipping 1 of 3 splits the order into a physically fulfilled 1-unit line and a reserved 2-unit line. New Client3 hook `watchSplitBrandId` requires the original watch variant to belong to the claimed brand before mutations and copies exact `watch_variant_id` plus engraving into the newly created order item **inside Main's same D1 batch**. A missing or mismatched watch association rolls the entire shipment back, rather than lose identity. Test: 1/3 + 2/3 sent in separate idempotent calls, correct physical and reserved counts, no duplicate payments/charges, preserved line totals, correct distinct shipment statuses, FK integrity. No D1 schema changes; Main and Branch2 not deployed.

**Release B (SUCCESS, third Worker only):** https://github.com/dymovicd123/Orders-app/actions/runs/41521287291
**Acceptance:** https://github.com/dymovicd123/Orders-app/actions/runs/41521115736 (SUCCESS)

Administrators may now **«Исправить ошибочную отправку»** on the exact dispatched watch row in Logistics, with explicit reason and warning that a real customer return must instead go through Returns. The Client3 adapter validates admin role, exact brand/order/dispatch-item/watch-SKU association, and delegates all corrections to Main's `cancelExactOrderDispatchItem`, not to ad-hoc stock updates. Main checks returns/exchanges, the reservation, physical dispatch, and newer revisions/stock checks. If physical restoration is not safely established, Main leaves a pending shortage and the UI warns to review stock rather than silently increment quantity. Idempotent operation keys and 8-character minimum reason; a cancelled shipment cannot be cancelled again. The test cancels the 2-unit shipment of a previously split watch order, verifies 2 units/2 reserved restored, brand isolation, manager denial, no financial changes, replay, and subsequent legitimate dispatch of the remaining 2 units. No migration; pre/post D1 counts/FK intact and anonymous write protection confirmed.

**Stage 3 core now released in Client3**, not formally end-to-end browser certified: multi-line and partial-quantity dispatch, remainder reservation, per-line shipped indicators, global partial sent status, dedicated engraved readiness, exact erroneous shipment correction. Staff browser/mobile acceptance is still unperformed, and canceled-after-revision stock checks may require a deliberate warehouse adjustment. **Next P0: Stage 4 multi-line partial Returns/Exchanges**: replace single-line constraints with exact line selection/quantity and preserve the watch SKU & engraving on all return/stock receipt and exchange replacement paths. Stage 5 Main warehouse UI, Stage 6 finance/roles and final visual acceptance follow.


## 03.11.2026 — Stage 4 finalized: multi-watch returns and exchanges

**Isolated Client3-only release SUCCESS:** https://github.com/dymovicd123/Orders-app/actions/runs/41525858058

**Actual Main/SQLite engine acceptance SUCCESS:** https://github.com/dymovicd123/Orders-app/actions/runs/41525588649

- Multi-line, partial-quantity physical and/or financial Return in one operation, separately selected item quantities and up to three verified refund methods. Distinct financial events are idempotent; original SKU identity stays attached to each return item. The watch return intake screen requires a separate physical receipt, with exact Office/Showcase/no-stock choice; recording a Return does **not** automatically restock.
- Multi-line ExchangeSetV2: old watch lines, quantities and shipment state explicitly selected, up to 20 replacement lines, exact watch brand/SKU and engraving attached through Main critical order-item lineage. Payment and refund portions use separate methods (up to three) and create correct Main ledger entries. Extra amount can remain outstanding debt. Main holds inventory admission and financial commit/replay authority.
- Fixed the legacy Orders action-gating bug: Return/Exchange actions are now available for multi-position and partly shipped orders based on their per-item returnable quantity, not global `lineCount===1` or whole-order shipped status. Actual server validation still prevents stale totals, duplicate item selection, cross-brand access, over-return or conflicting writes.
- Added genuine real-engine two-old/two-new exchange fixture (different original SKU identities, two replacement sources, distinct engravings) and asserted pending physical receipt, exact balance, no phantom receipt/payment and idempotent replay. Existing tests cover multi-line returns and split refunds, extra payments, refund split, and full stock/order lifecycles.
- Guarded release checked exact accepted commit, third Worker/D1 configuration, no pending migrations, read-only D1 counts/physical/reserved aggregates/FK before/after, public UI and anonymous Return/Exchange write denial. Only `orders-app-client3-old-client` Worker was updated. **No Main/Branch2 modifications, no remote D1 writes or schema migrations.**

**Stage 4 engineering and automated acceptance: DONE / LIVE.**
**Acceptance limitation:** authenticated real-user desktop/mobile browser interaction and operator training remain part of final UX/role sign-off. Do not equate isolated SQLite tests with a human browser session. Next priority is Stage 5 Main-level warehouse operations/history/revisions, then Stage 6 finance/permissions and final client acceptance.


## 03.11.2026 — Stage 5 warehouse / resolver, first tested milestone

**Isolated candidate:** `client3/stage5-warehouse-resolver-20261103`.
**Actual Main + full temporary SQLite/D1-domain acceptance SUCCESS:** https://github.com/dymovicd123/Orders-app/actions/runs/41527305176.

**Implemented:**
- Client3-only, admin-controlled `POST /api/client3/watches/stock/count-batch` (1–30 exact watch SKUs, one brand, one Office/Showcase). Each watch ID is mapped to its existing canonical Main variant *before* invoking Main `quickInventoryStocktakeBatch`, which atomically checks stale counters, revision conflicts, duplicate keys and physical stock updates. Explicit shortage acknowledgement; no invented receipts/payments.
- Main-derived human input cells, select-by-model multi-line correction, a final confirmation, and a protected per-brand/source movement history view. `GET /api/client3/watches/stock/history` filters at the SQL level by canonical watch SKU and brand, paginates by movement ID, no Problems/attention queue.
- Known-watch resolver before free-entry creation: Unicode-safe model name/characteristic matching, mapped RU default labels, canonical active reference values, exact existing watch variant and stock identity even at zero physical, retired/ambiguous fail-closed. Unknown watches still follow Main-like unrestricted manual order registration and pending reserves; one unique match never forces a catalogue dropdown or Enter confirmation.
- Real SQLite integrated acceptance includes cross-brand refusal, manager denial on stock writes, two-SKU atomic recount and stale/reused request failures, read-only history isolation, known SKU no-duplicate/no-stock side effects, retired model refusal, orders, financial and return/exchange suites. TS/Vite build passes.

**Not Stage 5 full Main parity yet:**
1. Full multi-step stocktake sessions, plus better selective/full source handover and administrative controls.
2. Main-style multi-position arrivals, write-offs and Office↔Showcase transfers (currently one SKU per operation).
3. Full operational history UI review with logged-in desktop/mobile roles. History exists, but not the heavy Problems queue by user request.
4. Resolver semantic coverage for deliberately configured synonyms/compound aliases and cross-flow end-to-end recovery. It now resolves unique case/whitespace/reference matches and existing SKU; do not claim every Main resolver scenario is identical.

**Release scope:** third Worker only, no migration. Never copy historical Main/Branch2 data or expose Main APIs through Client3. UI/role browser acceptance remains pending.


## 03.11.2026 — Stage 5 bulk warehouse operations and Main W12 semantic colors

**Verified isolated acceptance:** https://github.com/dymovicd123/Orders-app/actions/runs/41528576152 — SUCCESS.

- Reused Main's existing `applyInventoryMovement` and `applyInventoryTransfer` engines under one strict brand-scoped Client3 endpoint `POST /api/client3/watches/stock/bulk`. Handles one source, one brand, up to 30 different registered watch SKUs with canonical variant mapping. A single Main operation is used for the full batch (never looping over one-row write endpoints).
- Arrival, write-off and Office↔Showcase transfer have separate stock and reserve guards, explicit original expected physical counts on outbound operations, obligatory write-off explanation and fingerprint-protected idempotent retry. Rejects foreign brands, inactive SKU, repeated variants and unauthorized manager writes. Real SQLite tests confirmed multiple stock adjustments for each mode, stale batch rejection, reserved-stock denial, replay without duplicate movements and preservation of order/money invariants.
- The original Main CSS palette `src/styles/193-unified-inventory-operations.css` is restored with `data-unified-operation` and specific Client3 overrides for its old hard-coded blue styling: arrival green (`#15803d`), write-off red (`#b91c1c`), transfer amber (`#a16207`), correction/recount blue (`#1d4ed8`). Different modes retain distinguishable accents even when inactive. Buttons, headers, source and review controls follow the active accent.
- Added a dedicated Main-component-based multi-SKU bulk UI on Client3 Operations, preserving single-SKU operations, selective recount, and SQL brand-scoped warehouse history. The user specifically declined carrying over the Problems/attention queue; none is added.
- Release workflow `.github/workflows/client3-stage5-bulk-release-20261103.yml` accepts **only** the exact fully tested commit `fc4aa10e5cf986573905e4d3e92481dda6cd3866` and targets the third Worker with D1 count/fingerprint/foreign-key safeguards and without migrations. **Release SUCCESS:** https://github.com/dymovicd123/Orders-app/actions/runs/41528703776. Verified third Worker only, no remote D1 writes/migrations, unchanged historical counts, reservations and foreign-key check. Main/Branch2 untouched.

**Remaining in Stage 5:** true full/session-based inventory revisions, authenticated desktop/mobile practical QA, deeper semantic resolver aliases and remaining Main inventory parity details. Main and Branch2 must remain unmodified.


## 03.11.2026 — Corrective UX release: ONE warehouse operation workspace

User screenshot exposed a regression: a second `Массовые складские операции` panel was added below the original Main-derived `Складские операции` panel, even though the Main warehouse actions already support multiple positions. This duplicated both the operation chooser and the physical recount UI, and is not the desired Main-parity design.

**Corrective source acceptance SUCCESS** https://github.com/dymovicd123/Orders-app/actions/runs/41529929795
**Corrective isolated Client3 Worker release SUCCESS** https://github.com/dymovicd123/Orders-app/actions/runs/41530259039

- Deleted redundant `WatchBulkOperations.tsx` and `client3-watch-bulk.css`; deleted the duplicate `WatchSelectiveRecount` screen from `WatchWarehouseStage5.tsx`. That file now contains only read-only warehouse history.
- The existing `WatchWarehouseMain.tsx` Main-derived operation layout is now the **sole** form for arrival, write-off, transfer and correction/recount. Existing Main StocktakeProductChoice/StocktakeSizeCountCell primitives and existing Main `193-unified-inventory-operations.css` semantic palettes remain. Users can input multiple watch variants per model, switch models without clearing chosen quantities, then review all 1–30 exact lines and save one atomic operation. `count` routes to the already-proven Main quick-count-batch engine; other modes route to the already-proven `bulk` Main inventory movements/transfer engine. No client-side per-line write loop.
- Kept exact Office/Showcase distinction, explicit stock/reserve guards and shortage acknowledgment, idempotent request ID, required writeoff reason and familiar green/red/blue/amber Main W12 accents. No Problems queue.
- Full real Main-domain stock/return/exchange/order regression and build passed. Worker-only deployment did no migrations or remote D1 writes; verified preserved orders/payment/movement/stock/reserve counters and FK before/after; Main/Branch2 untouched.
- One intermediate release run was blocked at pre-deploy gate (41530072485; no deployment). Diagnostic guard rerun deployed successfully (41530259039) after verifying the accepted source unchanged. Do not treat the blocked run as an application regression.

**Next:** full Main stocktake session workflow and practical logged-in browser/mobile acceptance, plus deliberately-configured resolver alias edge cases; do not reintroduce a separate bulk operations screen.
