# После изменений справочников: регрессионный аудит и решение о main

Дата: 2026-10-10. Проверялся `branch2` на базе merge PR #365 `68eacdf25404dcca98d7839961e601d2455a0dcc`, плюс **только** скрипт аудита и документация в PR #366.

## 1. Реально выполненная проверка

PR #366, Quality Check GitHub Actions `38077227971`, job `114286636359`, **success**:
- `ACTIVE BRANCH2 CROSS-DOMAIN AUDIT: 20/20 passed` на **актуальном runtime**, а не frozen baseline;
- `CATALOG PORT AND BRANCH2 HISTORICAL GATES PASSED`;
- Stage04 protected SQL Git hashes не изменены;
- финальная production-like TypeScript/Vite сборка успешно завершена;
- вредных записей в рабочую D1 не выполнялось.

### 20 проверенных сценариев

| Область | Проверка |
|---|---|
| Заказы | `test-order-edit-payment-method-correction`: смена способа оплаты |
| Заказы | `test-order-edit-autonomy`: права менеджера на правки |
| Заказы | `test-order-delete-mobility`: удаления/доступ |
| Заказы | `test-order-shortage-save-nonblocking`: дефицит и сохранение |
| Заказы + SKU | `test-catalog-stale-order-merge-bridge`: актуализация ранее слитого SKU |
| Приход | `test-arrival-materialization-reliability`: архивный вариант/идентичность |
| Приход + SKU | `test-arrival-merged-sku-safety`: слитый вариант |
| Приход | `test-arrival-save-reliability`: ответ после записи |
| Обмен | `test-exchange-set-v2`: разные наборы старых и новых товаров |
| Обмен | `test-exchange-not-issued-r1`: неотправленный товар |
| Обмен + цены | `test-stage03-h9c-itemized-multi-exchange` |
| Возврат | `test-return-exchange-physical-receipt-r1`: физическое поступление |
| Возврат | `test-return-exchange-cancel-autonomy`: отмена и склад |
| Ревизия | `test-stocktake-functional-acceptance`: SQL lifecycle на in-memory D1 |
| Списание | `test-inventory-writeoff-review`: дефицит относительно резерва |
| Цех | `test-workshop-ui-r1`: обычные/Kaspi и накладная |
| Kaspi | `test-kaspi-order-separation-r1`: изоляция заказов/оплат |
| Финансы | `test-finance-day-transparency`: дневные операции |
| Финансы | `test-finance-f6-release-audit`: исторические денежные инварианты |
| Stage04 | `test-stage04b-workshop-status-capture`: отключённый capture |

Кроме этих 20 проверок продолжает проходить весь защищённый catalog/reference набор и исторический cumulative release gate. `scripts/test-reference-current-runtime-cross-domain.mjs` теперь включён в Stage04-safe gate до frozen baseline.

**Что эти тесты НЕ подтверждают:** нет полного браузерного E2E со staff/admin на реальном тестовом D1 для каждой операции, нет live фиктивных заказов/возвратов/движений на тестовом сайте, нет нагрузочного теста на 12k SKU, нет полного мобильного UX review, нет осмотра production D1. Многие ранние acceptance-тесты проверяют структуру маршрутов и контрактов; SQL end-to-end входит только в часть сценариев. Следовательно, правильный вердикт: «регрессии не обнаружены **в покрытых сценариях**», а не «абсолютно никаких багов нет».

## 2. Почему немедленная доставка в main НЕ разрешена

На момент аудита GitHub:
- main `c840feb0bc422af1faeea52c369a6daccf9f2c69` от 2026-10-07;
- branch2 `68eacdf25404dcca98d7839961e601d2455a0dcc` от 2026-10-10;
- compare `main...branch2`: `diverged`, main-only 478 и branch2-only 1366 коммитов. Глобальный merge затронет **много больше справочников**.
- Raw Git trees: main 981 blob, branch2 1380 blob; 36 shared changed paths, 148 main-only (включая production migration workflows и baseline fixtures) и 547 branch2-only (включая справочники, test-only Stage04 и Stage03/04 QA);
- production config `wrangler.jsonc` указывает Worker `orders-app` / `orders_db_prod` (D1 `17e68a41-1d58-4a36-8a63-47c3e32443c4`); branch2 config Worker `orders-app-branch2` / `orders_db_branch2` (D1 `40065052-854e-44b8-bcd5-251bdd488301`). **Не заменять prod binding тестовым!**
- В дереве main присутствуют миграции до `0082`, но отсутствуют `0090–0105`, на которых основан runtime слияний SKU/справочников. Это проверка **репозитория**, а не прямой снимок таблиц production D1. Реальное состояние продовой схемы ещё нужно проверить защищённым read-only preflight. Не запускать новый Worker до schema-first release.
- В branch2 имеются `0083/0084` Stage04, захват статуса готовности цеха выключен; перенос всего branch2 может случайно доставить незавершённый Stage04.
- Даже успешные 20/20 и Stage04-safe не означают совместимость с реальным Production D1 без migrations, production smoke, user/staff regression.

**Решение: production не менять; main НЕ сливать wholesale.** Это не означает, что текущие branch2 функции заведомо сломаны. Значит, что **не доказана безопасность конкретного production migration/release**.

## 3. Чёткий план отдельного будущего Production port

1. Из свежего main создать release-ветку, сверить только справочники и их реальные импорт/SQL зависимости, отдельно защищать production-only изменения 148 файлов и актуальный `wrangler.jsonc`.
2. Запланировать schema-first необходимые `0090–0105` по dependency matrix, без активации Stage04; проверка наличия объектов на production D1 только через выделенный guard, с backup/проверкой чужих данных и fingerprint до/после.
3. Проверить immutable constraints, FK, что миграции не переписывают orders/items, shipments, payments, stock, reservations; если какая-либо миграция касается действующих данных, остановиться и согласовать отдельно.
4. Fresh-main интеграционная ветка: `npm ci`, полная prod cumulative release:check, отдельная смежная регрессия на **новом** prod-compatible runtime, current Stage03/04 constraints, безопасность авторизации и Kaspi.
5. Не делать runtime release без schema подтверждения. Отдельная staged публикация со smoke login, обычный заказ, сохранение прихода, резерв/склад, ревизия, обмен/возврат, финансы/касса, цех; сначала никакого destructive operation.
6. Релиз только после подтверждённого exact SHA Cloudflare и допуска пользователя; production rollback и fallback для невозможности безопасного восстановления БД.

## 4. Следующие приоритеты

Справочники **на паузе**; полный контекст в `CATALOG_ON_HOLD_FULL_RETURN_CONTEXT_20261010.md`. Следующий день — Stage04 расчёты с цехом, затем Stage05 прибыль/экономика/аналитика; операционный UI, включая списание, позже, после личной проверки владельца.

Не возвращаться к разработке опасного объединения разных характеристик / сложных универсальных отмен, пока владелец не возобновит этап.
