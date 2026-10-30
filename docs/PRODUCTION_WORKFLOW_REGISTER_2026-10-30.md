# Реестр 47 GitHub Actions workflow: Orders-app (срез 30.10.2026)

**Источник:** дерево `main` на `e0dc37a07203d7c0cfb767cac7f9e64e38c33c1a`. Классификация по назначению и первичной проверке YAML; она **не доказывает**, что миграция когда-то применена, что скрипт только читает или что все деплой-триггеры Cloudflare безопасны. Не выполнять эти workflow ради проверки статуса.

## Безопасный рабочий приоритет

- Нынешние release gate заменены *только в черновиках*: [Branch2 #639](https://github.com/dymovicd123/Orders-app/pull/639), [Main #640](https://github.com/dymovicd123/Orders-app/pull/640). Обе серии CI зелёные; старый source-pinned replay сохранён.
- Защита монитора и устаревших автоматических workflow предлагается в [Main #641](https://github.com/dymovicd123/Orders-app/pull/641) и [Branch2 #642](https://github.com/dymovicd123/Orders-app/pull/642). Обе серии CI зелёные. **Ничего не слито в main/branch2**.
- Кандидат #641 ограничивает Staff/KPI/Finance выборочные тесты и удаляет прямой продакшен-деплой из мониторинга; кандидат #642 прекращает автоматический Branch2 fallback и обновляет live-UI smoke. Их нельзя путать с внешним управлением Cloudflare Builds.
- Исторические процедуры D1 и catalog one-off ниже остаются **неподтверждёнными как завершённые**, пока их execution history, production state и rollback/bookmarks не сопоставлены. Без такого доказательства не удалять и не повторно запускать.

## Полный перечень по назначению

В названиях ниже подразумевается путь `.github/workflows/<имя>.yml`. Категория — это рабочая **очередь ревизии**, а не вердикт о безопасности.

### Current CI and build monitoring — 2

- `quality-check.yml`
- `cloudflare-deploy-monitor.yml`

### Scoped feature / regression or selective release (possible production publish on matching push; investigate before reusing) — 20

- `main-city-staff-release-20261025.yml`
- `main-kpi-product-selection-20261028.yml`
- `main-manager-finance-20261024.yml`
- `main-manager-reports-20261023.yml`
- `main-manager-three-workspaces-20261022.yml`
- `main-manager-workshop-payouts-20261022.yml`
- `main-old-order-stocktake-handover.yml`
- `main-order-edit-delete-runtime-20261018.yml`
- `main-p0-financial-atomic-20261027.yml`
- `main-p0-legacy-partial-exchange-20261027.yml`
- `main-product-kpi-20261027.yml`
- `main-resolver-selective-20261022.yml`
- `main-retired-sku-runtime-20261018.yml`
- `main-stage05-demand-selective-20261023.yml`
- `main-w12-operations-only-20261024.yml`
- `resolver-shipping-acceptance-20261027.yml`
- `return-attributes-release-20261029.yml`
- `test-main-finance-exchange-lineage.yml`
- `test-main-return-active-reserve-p0.yml`
- `w19-main-stock-operations-only.yml`

### Historical production schema and reconciliation (remote D1 / migrations; read or write capability) — 12

- `auth-production-migrations-0080-0081.yml`
- `catalog-reference-production-schema-0090-0105.yml`
- `client-zammler-production-migration-0075.yml`
- `kaspi-production-migration-0082.yml`
- `kaspi-production-post-deploy-reconcile.yml`
- `main-admin-editor-schema-0110-0112.yml`
- `main-ethno-manual-finalization-schema-0109.yml`
- `main-retired-sku-schema-0113-0114.yml`
- `main-stage04-dormant-schema-20261018.yml`
- `stage03-production-migration-0072.yml`
- `stage03-production-migrations-0073-0074.yml`
- `main-1563-historical-return-reserves-20261030.yml`

### One-off forensic/catalog/payment cleanup (indirect scripts may modify production) — 13

- `audit-main-kaspi-sent-payments-20261018.yml`
- `one-off-prod-1734-1974-preflight.yml`
- `one-off-prod-1734-targeted-cleanup.yml`
- `oneoff-add-two-colors-rename23-20261016.yml`
- `oneoff-batch8-color-20261016.yml`
- `oneoff-color-1469-1584.yml`
- `oneoff-ethno-four-keeper-colors-20261016.yml`
- `oneoff-hide-retired-light-gray-reference-20261016.yml`
- `oneoff-main-asiya-23-kaspi-paid-20261019.yml`
- `oneoff-main-kaspi-sent-history-20261018.yml`
- `oneoff-production-color-canary-1464.yml`
- `oneoff-reference-audit-20261016.yml`
- `oneoff-remaining26-colors-20261016.yml`
## Критичные разрешения на изменения

1. **Запись в production D1:** особенно `oneoff-main-asiya-23-kaspi-paid-20261019.yml` (на подходящем `push main` выполняет SQL), `oneoff-main-kaspi-sent-history-20261018.yml`, `main-stage04-dormant-schema-20261018.yml`, исторические миграции `auth-*`, `catalog-reference-*`, `stage03-*` и `main-1563-historical-return-reserves-20261030.yml` (дополнительная проверка строки коммита). Их выполняемость **не означает**, что их следует запускать. Перед любым запуском: точная цель, подтверждение отсутствия уже применённой записи, SELECT-only preflight, Time Travel bookmark, ограниченный набор SQL, rollback/replay plan и отдельное согласование.
2. **Разовые старые публикации:** `main-product-kpi-20261027.yml`, `main-city-staff-release-20261025.yml` и другие selective release-файлы могут содержать `wrangler deploy`. Подтверждение CI старой версии **не** является разрешением на публикацию текущей системы.
3. **Монитор не является издателем:** первоначальные мониторы на двух ветках имели прямой deploy fallback при проблемах native Cloudflare. Исправления существуют только в PR #641/#642. Обновление workflow на `main` само по себе может запустить внешнюю native Cloudflare сборку; настройки Cloudflare необходимо проверить независимо.
4. **Не закрывать forensic PR как «мусор»**, если есть нерассмотренные изменения бизнес-кода или нет ссылок на результат. Завершённые SQL-SELECT аудитные PR можно оставить в истории без повторного запуска.

## Exit criteria из CI housekeeping перед складом

- [x] Есть текущие семантические release suites на обе ветки; исторические replay сохранены отдельно (PR #639/#640, CI success).
- [x] Документированы риски auto fallback и подготовлена защита монитора для обеих веток (PR #641/#642, CI success).
- [x] Все 47 workflow из дерева main классифицированы в перечне выше.
- [ ] Изолированная ручная release-процедура и действующие правила ветки/Cloudflare проверены на целевых окружениях.
- [ ] One-off production write-run history и фактическое состояние D1 сверены там, где планируется отключение/повторение/архивирование.
- [ ] Исправления из PR проверены после согласованного промоушена; **до этого действующее production поведение не менялось**.

**Практический вывод:** новый код склада можно безопасно проектировать и тестировать изолированно уже сейчас; принудительное объединение всех инфраструктурных PR до складской работы не требуется. Но production deployment — отдельный контрольный рубеж.
