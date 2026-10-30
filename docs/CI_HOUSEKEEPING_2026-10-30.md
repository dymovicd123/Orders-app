# Ревизия GitHub / CI перед стабилизацией склада — 2026-10-30

**Срез, а не автоматическое разрешение на удаление.** Главная цель: отделить проверку текущих правил системы от одноразовых production-операций и старого форензик-архива. Код заказа/склада и D1 этим документом не изменяются.

## Что найдено

- В `main` на момент ревизии 48 `.github/workflows/*.yml` и ~866 `scripts/`-файлов, 46 открытых PR. Число скриптов **не** означает 866 активных задач: многие — сохранённые регрессии и исторические доказательства.
- `main`: `npm run release:check` запускает `scripts/main-resolver-selective-release-20261022.mjs`. Он содержит жёстко закреплённые SHA и исторический replay целого набора старых файлов, включая `package.json`; изменение работающего источника может ошибочно классифицироваться как «Unreviewed file». Аналогично `branch2` использует `scripts/branch2-unified-kaspi-preserved-gate.mjs`.
- [PR #637](https://github.com/dymovicd123/Orders-app/pull/637) — новая правильная семантика «историческая отправка ≠ текущая задача», но часть CI тестирует старые подписи `shippedCount` и `WarehouseAttentionShippedUntrackedItem` ([W12.4](https://github.com/dymovicd123/Orders-app/actions/runs/41049201059), [W16](https://github.com/dymovicd123/Orders-app/actions/runs/41049201069)). Их нужно переписать на семантическую проверку *текущего* резерва и сохранённой истории, не удалять тесты.
- Quality Check в PR #637 прерывается на `test-legacy-exchange-product-pick-no-white-screen-20261017.mjs` ([run](https://github.com/dymovicd123/Orders-app/actions/runs/41049201104)). Тестовая фикстура не устанавливает обязательный `shipmentState` для новой позиции, из-за чего кнопка правильно остаётся отключённой, а тест ошибочно ждёт разрешение. Надо тестировать отдельно sent (с явным physical confirmation) и pending (без выдачи).
- `branch2` cumulative gate также выдаёт `Unreviewed current business source: package.json` ([run](https://github.com/dymovicd123/Orders-app/actions/runs/41049201071)). Это **не свидетельство** отсутствия бизнес-регрессии или её наличия: SHA-фильтр останавливает проверку до неё.
- Старый Stage04 gate на branch2 падает с `Branch2 D1 logical binding drifted` ([run](https://github.com/dymovicd123/Orders-app/actions/runs/41049200943)). Сравнить ожидаемую историческую схему с актуальной изолированной `branch2` и проверить, что gate не был написан только для прежнего состояния.
- `cloudflare-deploy-monitor.yml` срабатывает **на каждый push в main или branch2** и содержит production fallback. Поэтому даже merge исключительно документационного PR в `main` может запустить Cloudflare deployment. **Не merge в основную ветку лишь ради сохранения заметок**, пока не согласована стратегия деплоя документационных изменений.
- В `main` есть one-off workflows с прямым доступом к production D1 и некоторые `push: main` write jobs (например, `oneoff-main-asiya-23-kaspi-paid-20261019.yml`, `main-1563-historical-return-reserves-20261030.yml`). Не модифицировать их триггеры, не удалять и не повторно запускать без отдельного preflight/подтверждения, даже если операция была одноразовой.
- Открытые forensic-only PR октября 2026 хранят важную историю расследований; их можно **закрыть как завершённые без удаления веток или результатов**, но только после проверки, что PR не содержит нерассмотренный runtime/data patch.

## Принципы уборки

1. **Один понятный обязательный текущий gate на ветку**: dependency audit, TypeScript build, security/database isolation, semantics of orders/reservations/returns/exchanges/stocktake, idempotency, history. Дополнительные узкие тесты запускаются на релевантных путях и не требуют несовместимого UI-лейбла.
2. **Исторические source-pinned gates — в явно названный архив/опциональную проверку старого baseline**. Никогда не переписывать SHA на текущий «чтобы было зелено» и не убирать реальную контрольную точку без нового эквивалентного семантического теста.
3. **Однократные production workflow**: реестр (назначение/PR/применено?/ссылка на verified run/безопасно ли архивировать). Сначала подтверждение выполнения, потом отдельное решение об отключении. Никаких generic "apply latest" или неограниченного fallback к prod.
4. **Изолировать PR документации** от CD-триггеров: до согласования безопасного skip-path не merge housekeeping PR без осознанного решения о возможном deploy.
5. Проблемные PR не закрывать пачкой по дате: distinguish audit-only (archivable), open active code candidate (keep), stacked experiments (review whether superseded). Отмечать reason и финальную ссылку.
6. **Стабильность и честный сигнал важнее зелёной галочки.** Если не можем доказать, что тест устарел, оставляем failure и выясняем причину.

## Уже выполненная безопасная уборка (GitHub, без deploy)

- Созданы отдельные дорожная карта склада и этот реестр CI, ссылки добавлены в `docs/PROJECT_CONTEXT.md` и `docs/CLEANUP.md` ([PR #638](https://github.com/dymovicd123/Orders-app/pull/638), draft).
- В кандидате [PR #637](https://github.com/dymovicd123/Orders-app/pull/637) обновлены **поведенческие** тесты: обязательный `shipmentState` в Exchange, W12.4 current/reserved vs historical shipment semantics (без удаления проверки событий), а проверка Branch2 Worker+D1 переведена со старого ID на реальный **изолированный mirror 2026-10-27**. Это не изменение DB или бизнес-кода.
- Закрыты как **архивные SELECT-only PR**, после просмотра diff (только `scripts/ops` и `.github/workflows`, без runtime): **#418, #419, #423, #424, #425, #427, #428, #430, #431, #432, #433, #442, #443**. Причины добавлены в сами PR; их история/Actions/ветки остаются доступны. Никаких нерассмотренных code PR не закрывали.
- Список открытых PR уменьшился на 13 относительно того же состава; после создания нового docs PR исходные 46 превратились примерно в 34. Проверять свежую цифру непосредственно на GitHub.

**Эти действия не означают, что весь CI приведён в порядок:** source-pinned release gate ещё требует отдельной инженерной переработки и тестов, а не отключения. Даже после обновления точного D1 environment test нужно подтвердить прохождение Stage04 CI.

### Обновление диагностики Stage04

После обновления точного mirror ID Stage04-A и Stage04-B снова прошли. Исторический `test-inventory-writeoff-review.mjs` и тест видимости дублей ссылались на больше не монтируемую отдельную форму WriteoffReview, поэтому переведены на проверку единой формы операций, не меняя production или базу. Stage04 теперь действительно проходит: [run 41054695495](https://github.com/dymovicd123/Orders-app/actions/runs/41054695495). Проверки W12.4 и W16 тоже прошли ([W12.4](https://github.com/dymovicd123/Orders-app/actions/runs/41053599925), [W16](https://github.com/dymovicd123/Orders-app/actions/runs/41053600093)). Эти тестовые исправления **не** решают SHA-bound `release:check`.

## Конкретная очередь CI-cleanup

| Шаг | Состояние | Критерий выполнения |
|---|---|---|
| Зафиксировать складской roadmap + реестр CI-долга | документировано отдельной веткой | ссылки из `docs/PROJECT_CONTEXT.md` |
| PR #637: обновить устаревшие тесты `shippedCount` и required `shipmentState` | выполнено в кандидате, W12.4/W16 успешно | новая семантика и old-order Exchange проверяются живыми fixtures |
| Branch2 current gate: избавиться от stop-by-SHA для текущего кода, не выбрасывая семантические регрессии | требуется отдельный PR | чистый TypeScript/Vite build, все безвредные доменные тесты и retry/concurrency проверки; исторические frozen tests отдельно |
| Main current gate: аналогичная декомпозиция сложного Main Resolver replay | требуется отдельный PR | current Main regression надежно проходит вне зависимости от byte-hash изменений незатронутых файлов |
| Stage04 DB-bound assumption | актуальная зеркальная D1 уже проверяется; обновляются тесты устаревшего UI | проверка актуального `wrangler.jsonc` и реальных boundary conditions; никаких D1 writes |
| Список 46 PR: архивировать только конкретно завершённые аудиты | 13 архивировано, открыто 34 на 30.10 | финальный comment/body с результатами, ветки/история сохранены |
| Одноразовые production workflow и 866 scripts | не удалять до полного реестра | явный список usage (CI/import/runtime/one-off), ссылки и доказательство, что неиспользуемый безопасен |
| CD на documentation-only push | отдельное инфраструктурное решение | нет неожиданного build/deploy без ослабления real runtime releases |

**Не путать** эти действия с новым функционалом склада: до закрытия CI housekeeping не начинать новую форму создания заказов и маркировку.

## Дополнение 30.10: доказательство актуальной сборки и CD-рисков

- [Branch2 #639](https://github.com/dymovicd123/Orders-app/pull/639) — current semantic release вместо frozen SHA. [Quality check успешен, run 41057995401](https://github.com/dymovicd123/Orders-app/actions/runs/41057995401). Доменная безопасность и Stage04/складские регрессии сохранены.
- [Main #640](https://github.com/dymovicd123/Orders-app/pull/640) — аналогичный текущий gate, защищённые DOMPurify/Undici/Vite. [Quality check успешен, run 41059783126](https://github.com/dymovicd123/Orders-app/actions/runs/41059783126).
- [Main #641](https://github.com/dymovicd123/Orders-app/pull/641) — Cloudflare монитор только читает результаты; без автоматического fallback-deploy, датированные Staff/KPI/Finance workflows не запускают ложные проверки на несвязанных PR. [Quality check успешен, run 41060891634](https://github.com/dymovicd123/Orders-app/actions/runs/41060891634).
- [Branch2 #642](https://github.com/dymovicd123/Orders-app/pull/642) — прекратить Branch2 auto-fallback, проверять **текущие** маркеры интерфейса остатков на реальном URL после native success. [Quality check успешен, run 41061430513](https://github.com/dymovicd123/Orders-app/actions/runs/41061430513).
- [Реестр всех 47 workflow](PRODUCTION_WORKFLOW_REGISTER_2026-10-30.md) — четыре категории, возможные remote D1 writers и стоп-условия. Из 47 ни один архивный запуск не делали ради «очистки». Полного доказательства прежнего применения миграций в production пока нет.

**Граница готовности:** качество текущего кода в четырёх PR-кандидатах проверено, но **ни один не слит**; Cloudflare native trigger вне GitHub ещё не сверялся, данные D1 не затрагивались. Нельзя объявлять, что весь legacy CI/CD безопасен после одного зелёного Quality check. Инженерный цикл складских P0 можно начать в отдельной ветке с инвариантами и SQLite-тестами без ожидания каждой исторической однократной миграции; релиз в работающую систему — только после отдельной безопасной проверки CD.
