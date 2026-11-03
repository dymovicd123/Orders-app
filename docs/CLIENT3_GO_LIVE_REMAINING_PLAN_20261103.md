# Client3 Watches — актуальный план готовности к передаче (03.11.2026)

**Источник:** ветка `client3/urgent-reference-russian-cities-20261103`, issue [#774](https://github.com/dymovicd123/Orders-app/issues/774), [история подтверждённых релизов](CLIENT3_MAIN_PARITY_ACCEPTANCE_20261102.md). Это текущий план, а не первоначальные устаревшие галочки W1–W5 из issue #774.

**Последний релиз:** [Actions 41598963136](https://github.com/dymovicd123/Orders-app/actions/runs/41598963136) SUCCESS; [автоматическая приёмка 41598802234](https://github.com/dymovicd123/Orders-app/actions/runs/41598802234) SUCCESS. Последний UI-фискс, 46 городов из активного Main, русские прописные отображаемые значения, 2 цвета кожаного ремешка и отдельная таблица городов опубликованы. Main и Branch2 не меняли.

## Уже есть и протестировано автоматически
- Два бренда с серверными ограничениями, каталог/watch SKU/псевдонимы, 4 складские операции, история, быстрые и сохраняемые ревизии, резервы.
- Создание/редактирование заказов (свободный ввод), логистика/гравировка/полная-частичная отправка, возвраты/обмены и физическая приёмка, несколько способов оплаты, долговые платежи.
- Журнал **финансовых событий по бренду**, суммы поступлений/возвратов/нетто. Это **не** полноценная касса или баланс средств.
- Автоматические SQLite/Worker сценарии заказов, складских движений, возвратов/обменов, изоляции бренда и контроль перед/после D1 релиза. Они НЕ являются реальной браузерной приёмкой сотрудниками.

## P0 — блокеры до передачи клиенту
1. **Клиентский Chrome/Windows (последняя жалоба).** После принудительного обновления проверить текст механизмов/материалов в выпадающих списках, создание SKU, справочники, «ЧЕРНЫЙ»/«КОРИЧНЕВЫЙ», 46 городов в подборе заказа. Сделать снимок состояния после исправления. Если не читается — точечно исправить CSS. Отдельно проверить мобильную версию.
2. **Сквозная цепочка на Client3** под настоящими сотрудниками: администратор добавляет модель и вариант/псевдоним → приход Офис/Витрина → менеджер оформляет многопозиционный заказ, несколько оплат и задолженность → логист видит гравировку/срок → «Готово» не отправляет заказ → фактическая частичная/полная отправка → выборочный возврат/обмен, доплата/возврат несколькими способами → подтверждение приёмки → сверка SKU, остатков, резервов, долга и финансовых событий. Проверять повторные клики/потерянный ответ, нулевой склад и существующий SKU.
3. **Права/два бренда.** Проверить под реальными admin/manager/logistic: видимость и отказ прямого API у менеджера другого бренда, назначение сотрудников, отсутствие пересечения заказов/склада/денег. Проверить названия кнопок и доступность форм на ПК и телефоне.
4. **Запуск/данные.** Снять и сохранить отдельный Client3 D1 backup/Time Travel bookmark, проверить доступы и конфигурацию деплоя, отчёт по действующим реальным данным без тестовых удалений; после релиза сравнить заказы, финансовые события, физические остатки, резервы и FK. Main и Branch2 никогда не изменять.

## P1 — незакрытое требование из исходной спецификации
5. **Полнота финансово-управленческих модулей.** Сейчас есть только брендовый журнал финансовых событий и краткие итоги. В Client3 нет полноценного аналога Main: касса с операциями и сверкой, отдельные отчёты/экспорты, план, KPI, лиды/клиенты и соответствующие страницы. В спецификации #774 W3 это планировалось. Перед финальным объявлением «готово» нужно предметно определить, что клиенту обязательно в первый запуск, и перенести нужное из Main с brand-scoped API и UI (не подменять их статичной статистикой).
6. **Браузерные замечания после прохождения P0.** Исправить только подтверждённые сбои UX, кликабельности, выбора/редактирования и сохранения, не добавляя параллельных универсальных форм.

## P2 — можно отложить без риска и без обмана
7. **Параллельные ревизии двух брендов на одной физической точке.** Сейчас по механизму Main одновременно разрешена только одна активная ревизия на Office/Showcase. Сериализация надёжна, но ограничивает процесс; изменение блокировки — отдельная задача с тестами конкуренции. Не ускорять запуск её обходом.
8. **Расширение статистики и остальные улучшения Main**, не входящие в необходимый клиентский рабочий процесс. Не переносить «Очередь проблем»: владелец прямо отказался от неё.

## Go / No-Go
- **GO для пилота:** P0 проверено реальными ролями и сквозными сценариями; критических багов нет; владелец согласовал, какие недостающие W3 модули необходимы в первый день; есть backup/bookmark и отчёт контрольных итогов.
- **NO-GO для безусловной передачи:** видимые сбои на устройстве клиента, ошибки прав/брендов, неправильные резерв/склад/оплаты или требования кассы/планов/отчётности ещё нужны, но отсутствуют.
- Старый issue #774 W1c–W5 содержит устаревшие незакрытые галочки; статус сверять с реальными релизами и этим листом.

Не писать «полностью готово», пока не пройдена указанная браузерная приёмка и не решён W3.


## Update 03.11.2026: Main daily workspaces released

**New live release:** https://github.com/dymovicd123/Orders-app/actions/runs/41602666016
**Isolated real SQL/TS acceptance:** https://github.com/dymovicd123/Orders-app/actions/runs/41602478532

- Fixed native city dropdown vs prior `datalist` and exposed a separate warehouse `Ревизия` entry.
- Dashboard (month/day real brand KPIs and urgency-ranked logistics queue), 7 standard watch report categories, financial Main six-tab UI and brand-specific real cash accounts, logistics urgency/stage tabs released. Main and Branch2 unchanged. Only additive D1 brand cash tables.
- Replace old claim that **no** reports/cash were present. They are now present in a first watch-adapted version.
- The user explicitly postponed full browser/UI tests until after functionality is finished. Keep minimal build/SQL/security tests in releases.

**True functional follow-ups still needed, in this order:**
1. Complete detailed Main report drilldowns and pivots, including city→orders, date→manager/model/city, reconciliation and full branded Word/PDF exports, avoiding inaccurate substitutions.
2. Confirm which Main Workshop invoice/print/export controls belong in watch Logistics. Keep "Готово" = engraving only, and physical shipment independent.
3. Bring advanced Main Cash functions (cycles, reversal, audit, automatic settings) per brand. Separate cash states must never be mixed.
4. Add real per-brand monthly Plan/KPI targets to dashboard; until then show '—', not a fabricated 0% achievement.
5. Browser acceptance with real roles, mobile UI and corrected customer Windows select; only then mark delivered.

The old W3 / browser QA checkboxes in original GitHub #774 are not up to date; rely on these actual shipped commits, CI and explicit gaps.


## 03.11.2026 — Report drilldowns released; logistics invoice EXPLICITLY DEFERRED

**Accepted actual Main-backed SQLite order + report regression and TypeScript:** https://github.com/dymovicd123/Orders-app/actions/runs/41604548953 (SUCCESS).
**Client3 Worker and static assets deployed:** https://github.com/dymovicd123/Orders-app/actions/runs/41604726054 (Worker deployment succeeded, but post-deploy smoke initially failed because it passed Cyrillic city in a raw non-URL-encoded URL; this was a CI smoke defect, not an API/business error).
**Live independently read-only verification:** https://github.com/dymovicd123/Orders-app/actions/runs/41605168367 (SUCCESS; corrected encoded request, anonymous authorization 401/403, actual Client3 D1 health and foreign keys PASS).
**Main and Branch2 were never deployed or changed. No D1 schema migration or business write in this release.**

Delivered:
- Reuse the **exact Main CityOrdersExplorer component** in watch Reports rather than a newly invented table/dialog. City -> paginated actual brand-scoped orders -> focus the real order in Client3, preserving selected brand/month.
- Clickable date -> brand-scoped breakdown of sold watch models, managers, cities with actual SQL, in Main's strict report card/table structure.
- City received amounts now use *financial event date* rather than order receipt snapshots; real counts of clients/managers shown. Revenue remains tied to original order date.
- Financial method reconciliation breaks out order payments, debt closure/extra payments, exchange extras, refunds, other outflows and net movements. The full test asserts that net movements and reported totals reconcile.
- **Owner decision:** logistics invoice is probably unnecessary; **DEFER** Word/PDF/print invoice / workshop printing. Do not port or implement it without a new explicit request. Core physical logistics, engraving completion and dispatch remain separate and unchanged.

**Revised functional order (before the final full browser QA, as requested):**
1. Advanced Main cash parity (cash cycles/reversal/audit, within each watch brand, with no cross-brand mix).
2. Real per-brand monthly Plans and KPI and correct Dashboard progress (still displays '—' until configured, no fabricated numbers).
3. Verify any remaining business-critical finance/report edge cases; do not resurrect a logistics invoice or the old Problems queue.
4. Final practical admin/manager/logistic desktop/mobile walkthrough and live-data sign-off.

Do not claim all Main features are identical: reports now have Main's actual city explorer and daily pivots, but some less common Main report categories remain intentionally outside the watch-specific set.


## 03.11.2026 — Деньги / Лиды / Планы: ОПУБЛИКОВАНО, KPI НЕ НУЖЕН

**Релиз Client3:** https://github.com/dymovicd123/Orders-app/actions/runs/41608498764 — SUCCESS. **SQLite и строгая сборка:** https://github.com/dymovicd123/Orders-app/actions/runs/41608023820 — SUCCESS. Изолированная миграция `1002_cash_plans_leads_no_kpi.sql` применена только в `orders_db_client3_old_client`; итоговая сверка количества заказов, заказанных позиций, оплат, финансовых событий, движений и физических/зарезервированных остатков выполнена. Main и Branch2 не менялись.

**Внедрено:**
- **Касса (бренды отдельно):** ручное внесение, выдача, сверка, обратная компенсирующая запись на ручную операцию (не удаляет её), пауза/возобновление автоучёта, не подтягивающее задним числом оплаты во время паузы, новый цикл и история закрытых циклов. Без смешивания TAUWACH/WACHIZEN; критичные изменения доступны только администратору. Сборка/SQLite тестировали невозможность перерасхода, повтор, отмену и новый цикл.
- **Планы:** Main-подобная форма денежного плана отдела и плана менеджера с окладом и фиксированными бонусами 5%/3%, отчёт по выполнению/факту денежных событий (время фактической операции), правка и удаление администратором, фильтры дат/бренда, Word и печать. На Инфопанели вместо «—» реальные месячный план бренда и процент выполнения, только если план задан. Менеджер видит только свои персональные планы.
- **Лиды:** реальный Main `LeadsSection` переиспользован целиком для интерфейса, разделы «Лиды» и «Call Centre» с таблицами, датами и привязкой к менеджеру. Учитываются реальные продажи менеджера в день и конверсия; менеджер может изменять только собственные записи, удаление разрешено админу. Данные брендов раздельны.
- **KPI:** намеренно **НЕ переносить и не разрабатывать** по решению владельца. Никакой вкладки товарных KPI, бонусных KPI-заданий или их обязательной проверки.
- **Логистическая накладная:** по-прежнему отложена; не реализовывать без отдельного требования. Не переносить «Очередь проблем».

**Оставшийся план:** практический браузерный проход для менеджера/логиста/администратора на реальном компьютере клиента и мобильном телефоне, проверка видимости новых страниц и ограничений брендов, кассы/планов/лидов на контролируемых тестовых записях. Обязательные релизные технические проверки успешны; реальная пользовательская приёмка пока не заявлена как завершённая.


## 03.11.2026 — Owner changed decision: ONE SHARED CASH + Main-level TEAM (deployed)

**Deployed third Client3 Worker:** https://github.com/dymovicd123/Orders-app/actions/runs/41612094664 — SUCCESS (remote `1003_shared_cash_main_team.sql`, HTTP auth smoke, database and inventory before/after counters, foreign-key check). **SQLite + TS acceptance:** https://github.com/dymovicd123/Orders-app/actions/runs/41611777824 — SUCCESS. Main/Branch2 unchanged.

**Shared cash decision supersedes all earlier "two brand cash registers" notes:**
- There is **one physical cash account**, combining every new cash-paid or cash-refunded financial event from orders for **TAUWACH and WACHIZEN**; the relevant brand remains shown beside the order event. Kaspi and other non-cash forms are excluded.
- Main-like shared manual in/out, balance correction, cancellation by compensating entry, auto-tracking pause/resume (no backdating), closed cycles and chronological audit. The Finance tab's brand filter continues to scope financial **reports** only, not cash.
- Migration intentionally **does not delete or rewrite** historical `watch_brand_cash_registers`, `watch_brand_cash_entries`, `watch_brand_cash_cycles`. Where old registers existed, a snapshot of both active balances would have initialized the combined register once (covered by SQLite test).
- **Crucial live observation:** On 03.11.2026 both legacy brand register counts were **zero** in the actual Client3 database (live release SQL returned `legacyRegisters=0,sharedRegisters=0,sharedOpening=0`). Thus the newly deployed unified cash is currently **not initialized**. The owner/admin must count the physical cash and enter the starting balance **once**. Earlier customer payments are not replayed a second time; later ones are counted after that opening point. Do not tell the user that historic cash was transferred in the live database.

**Team now uses Main's established roster/tabs/styling rather than the old separate crude brand checkbox cards:**
- Active/former employees, full editor (name, role, birth/hire dates, contact, color, comment), brand access controls, linked login management and system administrators.
- Role `Логист` preserved (cannot be converted into `Менеджер` by Main's generic normalizer). Main employment guards on dismissal, retaining historic ownership and disabling logins.
- Main's timesheet operations, watch-adapted actual money-plan completion, preliminary salary and order activity tabs.
- Remaining manual sign-off: real browser on customer Windows, administrator and logistics/manager account visibility, physical cash count/opening, cash payment from each brand to same shared balance, verify dialogs/timesheet on desktop/mobile. These were not completed by automated HTTP/SQL tests.

**KPI still EXCLUDED, logistics invoice still DEFERRED, problems queue remains removed.**
