# W5.7 — финальный соседний аудит Warehouse — 2026-09-06

## Baseline

- Source baseline: `main` at `96ebf6ad7906bac0453d45f6a626993ceebc8ed6` (`W5.6: explain stocktake outcome and consequences`).
- Audit/fix branch: `w5-7-warehouse-adjacent-audit`.
- Production D1 не читалась и не изменялась в рамках аудита.
- Миграций нет.
- Arrival UI frozen и не меняется.

## Что проверено

### Manager / admin boundary

Проверены frontend и Worker для Warehouse-сценариев после W4–W5.6.

Manager должен и может:
- смотреть `Остатки`;
- делать короткую точечную сверку;
- выполнять рекомендованную короткую проверку;
- начинать выборочную и полную проверку;
- находить и продолжать активную проверку;
- отменять незавершённую проверку без изменения остатков;
- видеть историю движений и историю физических проверок;
- выполнять обычное перемещение Склад ↔ Бутик;
- выполнять routine existing-stock операции, которые не создают master-data;
- связать найденную неопределённую вещь с уже существующим точным вариантом.

Admin-only остаётся:
- создание/изменение канонического каталога и новых справочных значений;
- структурное разрешение неизвестной идентичности;
- сервис/диагностика;
- разрушительный reverse складского движения;
- прочие уже выделенные административные настройки.

Новых stale manager/frontend blockers в проверенных Warehouse-путях не найдено.

### Быстрая / выборочная / полная проверка

Проверены три соседних пути физической истины:

1. `Остатки → Сверить количество` — точечная сверка.
2. `Короткая проверка` — рекомендованный routine batch.
3. `Проверка` — выборочная/полная stocktake-session.

Backend по-прежнему является источником истины. Active stocktake блокирует параллельную быструю сверку той же точки. Routine UI даёт прямой переход `Открыть проверку`; выборочная/полная проверка умеет обнаружить и продолжить активную сессию.

Успешное завершение полной/выборочной проверки остаётся перед человеком на экране W5.6 и не переводит его автоматически в recovery. `Уточнить найденные` является отдельным явным действием.

## Найденный дефект W5.7A

В `src/features/inventory/routineCycleCount.ts` оставалась одна несогласованность надёжности.

После успешной короткой сверки физический факт уже мог быть записан Worker/D1, но следующий `refreshInventoryModule(true)` выполнялся внутри того же внешнего `try`. Если вторичный read/refresh падал, UI заменял уже показанный успех на `Не удалось сохранить короткую сверку.`

Это создавало ложный статус: пользователь мог решить, что физический факт не записан, и повторять действие.

Та же проблема была в conflict-recovery: после корректного server conflict вторичный refresh мог затереть смысл конфликта общей ошибкой.

### Исправление

- После `result.ok` успешная мутация фиксируется как авторитетный результат для UI.
- Secondary refresh теперь изолирован отдельным `try/catch`.
- Если refresh не удался, интерфейс говорит: физический остаток **уже сохранён**, общий список обновится позже.
- После server conflict оба secondary refresh выполняются через `Promise.allSettled`; ошибка обновления больше не превращает конфликт в ложную ошибку сохранения.
- Exact one-position check уже имел такой принцип; full/selective completion уже использовал `Promise.allSettled`. W5.7 делает поведение трёх путей одинаковым.

## Recovery / соседние сценарии

- Active stocktake остаётся единственным chronology barrier для быстрых сверок точки; защита не ослаблялась.
- Никакого автоматического удаления или завершения активной проверки нет.
- Отмена stocktake не меняет Physical.
- Найденная неизвестная вещь не создаёт новое справочное значение автоматически.
- Exact-known found item может быть связан менеджером без повторного увеличения Physical.
- Реальная master-data ambiguity по-прежнему требует admin.
- Warehouse history остаётся read-only для manager; reverse движения — только admin.
- `writeActivityLog` остаётся secondary/best-effort: сбой журнала не может превратить складскую мутацию в ошибку ответа.

## Регрессия

Добавлен `scripts/test-w5-7-warehouse-adjacent-audit.mjs` и включён в cumulative `release:check`.

Gate фиксирует:
- truthful post-write state для routine short check;
- изоляцию secondary refresh для exact/full paths;
- manager/admin permission matrix;
- explicit active-stocktake recovery;
- отсутствие forced recovery после W5.6 completion;
- admin-only destructive reversal/service/master-data;
- non-blocking activity journal;
- frozen Arrival structure.

## Изменения данных / стоимости

- D1 schema: без изменений.
- D1 migration: нет.
- Новых Production reads: нет.
- Новых polling/background reads: нет.
- Worker business mathematics/CAS/reservations/lifecycle не менялись.
- Изменение W5.7A находится только в frontend orchestration после уже полученного server-result.

## Результат аудита

Для W4–W5.6 соседняя Warehouse-матрица прав и проверок согласована. Единственный конкретный дефект, найденный в критическом checking-path W5.7, — ложный failure после успешной routine short-check при сбое вторичного refresh — исправлен и закрыт отдельным regression gate.

Следующее действие: технически провалидировать ветку, затем продвинуть reviewed diff в `main` и дождаться `cloudflare-deploy/main = success`. После этого Warehouse W5 можно считать закрытым, если Production не покажет конкретный новый дефект.
