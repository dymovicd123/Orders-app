# Объединение значений: выбор пользователя и сохранение истории

Статус: **отдельная ветка**, не развёрнута на `branch2`; никаких изменений в D1. Ветка основана на текущем `branch2` и не содержит изменений Stage04, `main` или списания.

## Бизнес-правило

Администратор сам выбирает, какое значение убрать и какое оставить. Даже если два названия различаются существенно (`ТЕРМИНАЛ` и `KASPI PAY`), система не должна навязывать основной вариант и не должна путать его с самой старой записью.

**Месяц:** текущий календарный месяц по дате заказа в часовом поясе Казахстана (UTC+05). Ранее оформленные заказы и связанные с ними документы остаются как история. Выбранное значение сохраняет прежний ID; старое значение мягко отключается, не удаляется физически.

## Реализовано на feature branch

- `ReferenceMergeWorkspace`: выбрать тип справочника, убрать одно значение, оставить второе, увидеть последствия до подтверждения. Простые тексты без ID/SQL для сотрудника.
- `GET /api/reference-values/merge-preview`: admin-only, any two *active* values одного справочника. Для способов оплаты считает уникальные заказы текущего месяца, включая случаи, когда способ записан только в `payments`, и отдельно — платежи, финансовые события, кассу, возвраты и обмены.
- `0093_v72_reference_value_choice_merges.sql`: пустой журнал объединений, исходных значений текущих заказов и контрольных результатов; миграция **не применена**.
- `POST /api/reference-values/merge`: **только города и способы доставки**. Атомарно обновляет выбранные поля заказов *текущего месяца*, сохраняет прежние имена/ID заказов в журнале, скрывает исходное значение из будущих списков. Строгий token предпросмотра, сравнение состава затронутых заказов внутри транзакции, финальная проверка с rollback при ошибке, повторный запрос idempotent. Заказы из старых месяцев, удалённые заказы, деньги, платежи, склад, цех и история событий не переписываются.
- Простое удаление из справочника теперь подписано «Удалить из списка» с подтверждением: это существующее мягкое отключение с сохранением истории. Запрет отключения активных значений товара пока сохранён, пока не обработаны связанные SKU.
- Для цветов, материалов, размеров, причин операций показывать «0 затронутых заказов» было бы ложью: интерфейс предупреждает, что связи не проверены, и сохранение недоступно.

## ОСТАЁТСЯ СДЕЛАТЬ, прежде чем тестировать запрос клиента

1. `ТЕРМИНАЛ` → `KASPI PAY`: **кнопка сохранения заблокирована**. Для заказов текущего месяца нужно безопасно переобозначить `orders.order_payment_method`, `payments.method`, `financial_events.payment_method`, `cash_register_entries.payment_method`, `returns.payment_method`, `exchanges.payment_method`. Нельзя ломать денежный баланс, пересчёт закрытия долгов, прибыль по способам оплаты и историю исправлений. Проведённые оплаты за предыдущие периоды и переводы из категории наличных — особый случай: отдельно проверять и блокировать сомнительные случаи.
2. Для остальных видов справочников (причины возврата/списания, характеристики товара) провести собственные проверки связей, не сводить их к массовому `UPDATE`. Физические SKU объединяются отдельным складским механизмом с резервами, исполнением, активными документами и историей; пользователь выбирает базовый SKU.
3. Добавить понятную историю операций объединения и восстановление при ошибочном выборе.
4. Провести полный регрессионный и реальный тест на **отдельной branch2 D1**; миграция 0093 только после проверки. **Не сливать с main**.

## Проверки

`scripts/test-reference-merge-choice-preview.mjs` и `scripts/test-reference-merge-monthly-apply.mjs` на SQLite с искусственными заказами, хранением прежних значений, запросами с устаревшим предпросмотром, rollback, повторным запросом и блокировкой изменения способов оплаты. CI также проверяет Stage04-A/B, изоляцию D1, Catalog SKU и сборку TypeScript/Vite.

## R2 payment-method consolidation (development branch; 2026-10-09)

- `0094_v72_reference_payment_method_merges.sql`: additive audit, per-record original values and validated transaction result. **Not applied** on any D1.
- For **ТЕРМИНАЛ → KASPI PAY** and other explicitly supported ordinary noncash pairs, administrator picks source and keeper. Preview counts affected order records, payments, immutable-in-amount financial events, returns and exchanges. Active cash-register entries using the source method, cash methods, Kaspi **магазин**, older-period financial events, and oversize batches **block** merging.
- Atomic one-batch operation changes **only method labels** for records attached to *current calendar month's orders*. Amounts, cash-register entries, payment dates, event dates and older-month orders are not changed. Each original label (including the previous label of a financial event) is written to an append-only audit row before updating. Transactional fingerprints validate the exact set of rows and their amounts/dates. Postcondition checks cause full rollback on disagreement.
- Finance consumers group on method labels in both payment rows and financial events; updating them together prevents mismatched classifications. We deliberately do **not** generate new positive/negative financial events for a spelling correction because money has not moved. This is an audited classification correction, not a money operation. Method changes to a cash method or Kaspi магазин require a separate business flow, not silent remapping.
- Orders with blank intended `orders.order_payment_method` and a Terminal payment retain their blank intended payment method (we only correct the factual payment row); do not infer intent when an order might have mixed payments.
- `GET /api/reference-values/merge-history` lists cross-kind recent merges with original value, keeper, date and actor. Browser receives counts and a review token, **not** the original per-payment snapshot.
- Focused SQLite tests: `test-reference-payment-merge.mjs`, `test-reference-merge-history.mjs`, plus Stage04-A/B and full historical release gate. Must rehearse complete migrations `0093` then `0094` on an isolated DB with real existing schema before merging the PR. **No deployment** to branch2/main/production yet. Writeoff remains deferred.
