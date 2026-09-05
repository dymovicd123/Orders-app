# W3.2 — Natural recovery: true clarification vs physical intake

Date: 2026-09-05
Base: W3.1B Production (`d52fc13a382ef77e97d9c049d56c7bd005aac5ad`)

## Goal

Make `Нужно уточнить` genuinely secondary. Ordinary stock shortages, physical checks and unfinished stocktakes belong to their normal work areas; the recovery surface should keep only questions that cannot be derived safely from known data or a newer physical fact.

## Human behavior

- `Нужно уточнить` now means only true ambiguity: historical handover uncertainty or unknown product/characteristics.
- Exact known physical inbound is shown separately as `Ожидают приёма` and only when such rows exist.
- The intake copy explicitly allows doing nothing when the employee is remote, busy or not sure the item is physically present.
- Shortage remains in `Остатки`, where W3.1B already provides a voluntary concrete `Проверить` action.
- Active stocktake remains in `Проверка`; it is not duplicated as a recovery inbox category.

## Natural self-healing

- A successful quick physical count and retirement of older matching known Workshop inbound are written in one D1 batch.
- A completed stocktake retires only matching pending Workshop inbound whose event existed no later than that exact SKU's `counted_at`; an inbound occurring after the count remains pending.
- Manual known-intake reconciliation recognizes a newer exact physical check before demanding an older full-stocktake baseline.
- Fresh Workshop return creation skips that historical-check lookup so the common write path does not spend an extra D1 read.

## Read / failure behavior

- Successful quick stocktake no longer performs a detailed Warehouse Attention read.
- Its inventory refresh is best-effort. A read failure after the write does not turn a successful physical fact into an apparent failed save.
- Warehouse Attention still loads details only when the user opens the secondary surface.

## Invariants

- No migration.
- Arrival UI frozen and untouched.
- Branch2 untouched.
- Reservation/write-off arithmetic unchanged.
- No mandatory stock check introduced.
- No background recovery/details preload introduced.
- Existing CAS protection for physical counts remains.

## Next

Continue W3 by auditing the remaining handover/identity exceptions and moving any resolvable case into its natural operational context. Do not turn `Нужно уточнить` back into a general task inbox.
