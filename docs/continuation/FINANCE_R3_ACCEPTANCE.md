# Finance R3 acceptance

Finance R3 closes the period and cash chronology inconsistencies without rewriting existing financial history.

## Period contract

- `Сводка`, `Операции`, `Долги`, `Возвраты / обмены` use the selected `dateFrom` / `dateTo` period.
- A single day (`dateFrom === dateTo`) uses the same report/read path as any wider range.
- `Касса` is current operational cash state and does not inherit the report period.
- `Способы оплаты` is configuration and does not inherit the report period.

## Cash chronology

- Primary cash history is grouped by `businessDate`.
- Insertion time is secondary and shown as `Внесено позже` when it differs from the business date.
- Running balance remains available only in the technical insertion-order ledger.

## Missing historical cash movement

- Only admins can provide an explicit past `businessDate` for a manual cash movement.
- `created_at` / `occurred_at` remain the actual insertion time; history is not rewritten.
- Future business dates are rejected.
- Dates before the current cash-cycle baseline are rejected to avoid double-counting an amount already represented by an opening balance or previous cycle.
- Historical mutations require a safe request id and preserve idempotency.
- Reversing a manual movement keeps the original business date while recording the reversal now, so the historical day nets correctly and the technical audit still shows when the correction was made.

## Release acceptance

Before merge:

1. focused finance regression;
2. full `npm run release:check`;
3. TypeScript build check;
4. production build;
5. lint;
6. `git diff --check`;
7. PR Quality Check.

No production D1 mutation is part of deployment or validation.
