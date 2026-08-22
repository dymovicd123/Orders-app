# Система заказов — актуальный roadmap после переноса в GitHub

Дата checkpoint: 2026-08-22

Этот файл — основной continuation-context для следующего этапа разработки склада после Step 192B2A4 и переноса исходников/деплоя в GitHub. Читать вместе с `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md` и актуальным кодом ветки.

---

## 1. Текущая инфраструктурная точка

GitHub теперь является основным source of truth проекта.

Репозиторий:
- `dymovicd123/Orders-app` — private.

Постоянные ветки:
- `main` → Cloudflare Worker `orders-app` → D1 `orders_db_prod`.
- `branch2` → Cloudflare Worker `orders-app-branch2` → D1 `orders_db_branch2`.

Обе ветки были загружены только после проверки из clean Git checkout:
- `npm ci`
- `npm run release:check`

Для воспроизводимости добавлена `.gitattributes` с LF для source/test/config/sql/md и CRLF для Windows launcher scripts.

Cloudflare Workers Builds подключён к GitHub для обеих сред:
- `main` автоматически запускает production build/deploy `orders-app`.
- `branch2` автоматически запускает build/deploy `orders-app-branch2`.
- Preview builds отключены.
- Build command: `npm run release:check`.
- Deploy command: `npx wrangler deploy`.

Безопасные docs-only trigger commits подтвердили GitHub → Cloudflare pipeline для обеих веток.

### Постоянное правило деплоя

Обычный source-only фикс:
1. изменение готовится в GitHub;
2. сначала проходит через Branch 2;
3. Cloudflare автоматически выполняет полный release gate и деплой Branch 2;
4. после фактической проверки тот же проверенный diff переносится в `main`;
5. Cloudflare автоматически выполняет release gate и production deploy.

Git push НИКОГДА не должен автоматически применять D1 migrations или repair SQL.

Schema/data migration — отдельная защищённая процедура с отдельным решением, backup/forensic/retry-safety и явной проверкой перед применением.

Для обычных source-only изменений ZIP/CMD installers больше не являются основным способом разработки. Они допустимы только как аварийный/локальный fallback.

---

## 2. Неподвижные продуктовые инварианты

### Приход

`Приход` заморожен. Его UI и исходный утверждённый блок нельзя менять в складских/каталожных работах. Regression SHA должен продолжать защищать его.

### Складская модель

Базовая модель:
- `Физически`
- `Зарезервировано`
- `Доступно = Физически - Зарезервировано`

Заказ резервирует позиции. Физический остаток уменьшается при фактической выдаче/отправке, а не при простом создании заказа.

### Частичная отправка

Обычной частичной отправки заказа нет: для клиента заказ остаётся моделью «всё или ничего».

Исключение — уже принятая узкая ранняя выдача складской/бутиковой части смешанного Warehouse + Workshop заказа. Она не превращает систему в общий partial-shipping engine и не должна приводить к повторному списанию при финальной отправке.

### Warehouse Attention

`Внимание / Требуют разбора` — derived operational queue, а не постоянная система задач.

Не добавлять:
- owners;
- SLA;
- дедлайны;
- отдельную case/task инфраструктуру;
- тяжёлую новую ролевую модель.

Safe/known cases должны либо разрешаться автоматически, либо иметь одно узкое понятное действие. Администратор нужен только для реально неоднозначных решений.

### Каталог

Вариации: пол/тип/цвет/размер.
Исполнение: материал/длина.

`СТАНДАРТ` или пустое значение сами по себе не означают «неизвестно».

Явный реальный `БЕЗ ЦВЕТА` допустим. Нельзя массово удалять такие SKU только по имени; удалять/retire можно только 100% доказанный мусор.

### Freshness / физическая правда

Новые события не могут переписывать более свежую физическую правду.

Особенно для возврата/приёмки из Workshop:
- требуется trusted completed full stocktake baseline;
- active stocktake → hold;
- event до full revision → superseded без изменения текущего stock;
- event во время revision → hold;
- более поздняя exact physical check → supersedes старое событие;
- только genuinely fresh event без более свежей физической истины может менять `inventory_stock`.

Персонал не должен вручную рассуждать «где был товар на момент ревизии» в нормальном workflow — эта сложность должна оставаться внутри server rules.

---

## 3. Что уже выполнено

Ниже — не полная история каждого старого шага, а выполненные блоки, которые определяют текущую базу.

### 189A–189D.1 — стабилизация операций и историй

Закрыты:
- actionable-only review queue;
- safe stocktake persistence;
- storage safety;
- честная история склада/возвратов/обменов;
- append-only money history;
- Team activity как бизнес-история, а не технический audit;
- D1 split-select fixes для Team report.

### 190.1–190.6 — системная надёжность и архитектура

Закрыты:
- critical-operation idempotency;
- Cloudflare/D1 bulk-limit fixes;
- read/error/cache safety;
- storage/database hygiene;
- small-screen acceptance;
- Worker modularization;
- Frontend modularization;
- dead-code cleanup;
- lazy loading/bundle budget;
- typed API boundaries.

`190.0` access/login redesign остаётся отдельно отложенным до согласования с клиентом.

### 191A–191F — резервы, перемещения, runtime, session integrity

Закрыты:
- over-reserve forensic;
- ordinary-shortage forensic;
- transfer failure forensic;
- transfer runtime hardening;
- D1 runtime/atomicity hardening;
- signed admin-session integrity.

### 192A0–192A2 — truth/freshness и catalog truth

Закрыты:
- read-only warehouse truth/freshness forensic;
- warehouse truth/freshness implementation;
- catalog truth finalizer;
- soft-retire доказанного Workshop placeholder без изменения склада;
- сохранение реального `ОРАМАЛ АТЛАС / БЕЗ ЦВЕТА`;
- запрет случайного синтеза нового conflicting `БЕЗ ЦВЕТА` SKU в manager check/exchange;
- сохранение history/references/inventory fingerprint.

### 192B1–192B2A3 — ежедневное Warehouse Attention

Закрыты основные backend/frontend основы:
- derived actionable Attention;
- точный known-SKU count flow;
- explicit shortage decision;
- handover wording;
- отдельные типы вопросов;
- quantity-aware shortage/handover de-dup;
- order context;
- known exact pending inbound как `Приёмка`, а не `Определить товар`;
- safe `Завершить приёмку` с повторной freshness-проверкой;
- direct review loading без второго Refresh;
- SQL alias collision B2A3 устранён.

При этом перед следующим крупным Warehouse шагом нужен короткий visual acceptance текущего Attention, чтобы убедиться, что в реальном UI не осталось старого/неактуального шума.

### 192B2A4 — Order Create / Save Integrity

Считать завершённым и не трогать без конкретного нового бага.

Закрыты:
- structured 409 shortage вместо generic 500;
- frontend/server shortage mapping;
- Workshop исключён из Warehouse/Boutique availability check;
- zero-payment order creation/editing;
- controlled payment/input errors;
- Workshop schema preflight;
- resumable create/edit critical operations;
- retry-safe customer counter;
- own-reservation exclusion on edit;
- reservation race routing to Attention;
- browser request-id persistence across reload;
- unitPrice/audienceType preservation;
- idempotent manual payment;
- safe post-commit readback for shipping/handover/returns/exchanges/archive;
- archive restore retry safety;
- full mutation-route sweep for false failure after successful D1 commit.

Primary и Branch 2 были успешно deployed и live-accepted до перехода на GitHub workflow.

### GitHub migration / Cloudflare CI-CD

Завершено:
- source tree перенесён в private GitHub repo;
- `main` и `branch2` сохранены как отдельные среды;
- Branch 2 specific `auth.ts` и `wrangler.jsonc` сохранены;
- Git EOL reproducibility исправлена через `.gitattributes`;
- обе ветки проходят clean-checkout release gate;
- обе ветки подключены к Cloudflare Workers Builds;
- docs-only commits подтвердили автоматический deploy trigger для Branch 2 и Production.

---

## 4. Что осталось — активный roadmap

### Фаза 0 — короткая acceptance-добивка текущего Warehouse Attention

Цель: не переписывать B2A2, а проверить, что принятая логика реально выглядит просто.

Проверить в реальном UI:
- типы проблем визуально разделены;
- у проверки есть понятный order context: ID/дата/клиент/нужный checkpoint;
- древняя/неактуальная chronology не превращается в текущую задачу;
- auto-resolved known case не остаётся как «требует проверки»;
- `Разобрать` сразу открывает конкретный объект;
- shortage и handover не дублируют друг друга количественно;
- known inbound не маскируется как unknown catalog problem.

Если конкретных дефектов нет — не создавать отдельный большой Step ради косметики.

---

### Фаза 1 — Step 192B2B: Movement picker + movement UX

Это следующий основной продуктовый шаг.

Проблема сейчас:
- слишком много вариантов;
- нужный SKU трудно найти;
- технический список мешает обычному сотруднику;
- garbage/irrelevant variants создают шум.

Цель:
- searchable/grouped выбор товара/SKU;
- сначала товар, затем релевантное исполнение/вариация;
- показывать только варианты, которые реально имеют смысл для операции;
- приоритет текущего товара/атрибутов;
- понятный Warehouse ↔ Boutique transfer flow;
- минимальное число действий;
- мобильная пригодность;
- не менять transfer runtime/atomicity, уже защищённые 191D/191E;
- не трогать Arrival.

Перед реализацией — сквозной audit всех entry points перемещения, возврата, обмена и stock check, чтобы новый picker был единым, а не очередным локальным компонентом.

Acceptance:
- сотрудник быстро находит нужную позицию;
- не видит технического dump всех вариантов;
- нельзя случайно выбрать заведомо нерелевантный SKU;
- перемещение остаётся атомарным и retry-safe;
- Branch 2 проверяется фактическим сценарием до merge в main.

---

### Фаза 2 — Workshop → Warehouse known return / intake

Точная нумерация Step будет выбрана при начале реализации; не придумывать номер заранее ради формальности.

Цель:
- exact known canonical Workshop return обычно автоматически возвращается на Warehouse;
- manager не должен вручную подтверждать известный корректный товар;
- manual attention нужен только при unknown/suspicious identity или конфликтующей характеристике.

Сохранить существующую safe recovery action `Завершить приёмку` для pending known inbound.

Критично:
- freshness barrier повторно проверяется непосредственно перед stock mutation;
- старое событие не меняет новый физический остаток;
- active/overlap/rechecked state fail-closed;
- pre-revision event superseded без изменения текущего stock;
- later exact physical check supersedes older event.

UX:
- нормальный сотрудник видит «товар вернулся / принят»;
- историческая reconstruction не выносится в основной интерфейс;
- ambiguous case получает один понятный вопрос.

---

### Фаза 3 — Calm stock-check / stocktake cycle UX

Цель: упростить выросший исторически workflow «где был товар на момент ревизии?».

Нормальный сценарий:
1. найти товар;
2. указать фактическое количество / подтвердить «На месте»;
3. сохранить;
4. система сама учитывает chronology, reservations и freshness.

Не превращать каждую сверку в полную ревизию.

Сохранить:
- quick stocktake;
- `inventory_stock_checks`;
- exact physical evidence;
- exchange stale-stock подтверждение `На месте`;
- inline добавление допустимых характеристик там, где это уже принято;
- reservation truth.

Историческая реконструкция должна быть исключительным/internal workflow, а не обязательной операцией для менеджера.

---

### Фаза 4 — Step 192B3: Catalog redesign

Это отдельный большой UX/product step, не смешивать с movement picker или stocktake.

Текущая проблема:
- каталог выглядит как техническая затычка;
- есть шум и исторически плохие значения;
- тяжело понимать связь товар → исполнение → вариация;
- опасно делать массовую «чистку» без evidence.

Цель нового интерфейса:
- понятная структура `товар → исполнение → вариации`;
- быстрый поиск;
- понятное редактирование справочных значений;
- легко видеть реальные активные SKU;
- garbage values не доминируют в выборе;
- manager blank color не синтезирует конфликтующий colorless SKU;
- explicit legitimate `БЕЗ ЦВЕТА` остаётся валидным;
- one-size/unisex semantics не ломаются;
- history/order references сохраняются.

Очистка:
- soft-retire/remove только 100% доказанный мусор;
- никакой массовой destructive normalization «по названию»;
- перед cleanup обязателен forensic/evidence audit Primary;
- Branch 2 не используется как доказательство физической правды Primary.

---

### Фаза 5 — Admin independence / self-recovery

Это не отдельная тяжёлая case-management система. Это критерий качества всех предыдущих фаз.

Система должна работать, если администратор временно недоступен.

Достигается через:
- auto-resolution safe known states;
- deterministic server rules;
- узкие понятные exception actions;
- recovery paths после lost response/retry;
- отсутствие необходимости вручную чинить D1;
- понятные manager-facing тексты;
- минимальное количество technical choices.

Админ остаётся нужен только для:
- genuinely ambiguous catalog identity;
- редких truth conflicts;
- schema/data repair;
- опасных необратимых операций.

Не возвращать persistent owner/SLA/task framework.

---

### Фаза 6 — Warehouse final acceptance / cross-workflow audit

После B2B + known return + calm cycle + B3 провести полный сквозной acceptance.

Проверить:
- create/edit order;
- unpaid Workshop order;
- reservations;
- Warehouse shortage;
- early handover;
- final shipping;
- Warehouse ↔ Boutique transfer;
- Workshop return;
- returns/exchanges;
- stock check;
- stocktake;
- catalog create/edit/retire;
- mobile/desktop parity;
- history visibility;
- retry/lost-response behavior;
- D1 query/mutation limits;
- bundle/load cost.

Цель: найти не только баги одного экрана, а скрытые логические несовпадения между workflows.

---

## 5. Технические ограничения для всех следующих шагов

Не ломать:
- Arrival frozen block;
- `inventory_stock` physical truth;
- reservation accounting;
- early handover fulfillment state;
- B2A4 idempotency/lost-response semantics;
- Branch 2 auth distinction;
- migration history;
- current Git EOL policy.

D1/runtime:
- избегать большого parallel read fan-out;
- сохранять bounded mutation rowsets;
- не возвращать giant compound SELECT;
- archive/release/shipment critical writes должны оставаться atomic;
- не использовать file-import endpoint для больших repair SQL без отдельного обоснования;
- никакого runtime schema repair во время обычного запроса.

Release process:
- каждый change проходит `npm run release:check`;
- сначала Branch 2;
- затем live acceptance;
- только затем main;
- D1 write/migration не маскировать под обычный source deploy.

---

## 6. Отложенные работы вне активного Warehouse roadmap

### Step 190.0 — access/login

Остаётся deferred до отдельного согласования с клиентом. Не смешивать с Warehouse steps.

### Возможные будущие optimizations

После функционального завершения склада можно отдельно делать:
- performance/bundle cleanup;
- дополнительные GitHub branch protections / PR policy;
- ручной защищённый GitHub workflow для schema migrations;
- документационную чистку старых historical continuation files.

Эти работы не должны задерживать основную складскую функциональность.

---

## 7. Следующее действие после этого checkpoint

Следующий рабочий шаг:

**короткий визуальный acceptance Warehouse Attention → затем Step 192B2B Movement picker + movement UX.**

Перед патчем 192B2B выполнить сквозной audit связанных entry points, затем реализовать единый простой picker/flow, прогнать release gate в Branch 2, проверить реальный сценарий перемещения и только после этого переносить проверенный diff в `main`.

192B2A4 считать закрытым и не перерабатывать без конкретного воспроизводимого дефекта.

---

## 8. Короткая карта статуса

- 189A–189D.1 — DONE
- 190.1–190.6 — DONE
- 190.0 access/login — DEFERRED
- 191A–191F — DONE
- 192A0–192A2 — DONE
- 192B1–192B2A3 — DONE, visual acceptance remains
- 192B2A4 Order Create/Save Integrity — DONE / ACCEPTED
- GitHub source-of-truth migration — DONE
- Cloudflare Git deploy for `branch2` — DONE / VERIFIED
- Cloudflare Git deploy for `main` — DONE / VERIFIED
- 192B2B Movement picker + movement UX — NEXT
- Workshop → Warehouse known return/intake — PLANNED
- Calm stock-check/stocktake UX — PLANNED
- 192B3 Catalog redesign — PLANNED
- Admin-independence acceptance — PLANNED
- Final Warehouse cross-workflow audit — PLANNED
