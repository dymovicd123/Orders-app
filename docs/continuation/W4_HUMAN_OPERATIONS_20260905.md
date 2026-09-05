# W4 — Human Warehouse Operations

Date: 2026-09-05
Base Production: `5aed87218c328a7d55e90b9e3f0bab5252b54b6b` (W3.2)

## Product goal

`Операции` should read like a physical task, not like a movement database editor. The ordinary task is moving a real item between Warehouse and Boutique. Rare actions remain available but secondary.

## Implemented

- Operations opens on `Перемещение` by default.
- `Переместить товар` is the obvious primary action.
- Arrival, write-off and exact quantity correction are under `Другие действия`.
- Arrival workspace markup itself is unchanged/frozen.
- Transfer product choice still starts with product search, then variants.
- Only six likely variants are shown initially; search expands direct matches.
- Remaining variants are preserved under `Ещё варианты`, never discarded.
- Zero and negative system quantities are not filtered or labelled as garbage merely because of quantity.
- Formatting duplicates / visually suspicious near-duplicates are ranked lower and can be shown with a mild `похожее или старое значение` note; they are never merged or mutated automatically.
- Transfer table is reduced from six columns to four: variant, system state, quantity to move, human consequence.
- If requested movement exceeds system physical quantity, the existing safety rule remains: the person must explicitly count that exact variant in that location. Copy explains that this is a local check, not a full stocktake.
- No automatic interpretation of “I am holding one” as “the full physical count is one”.
- Reservation shortages remain non-blocking for the physical move; the consequence is shown in human language.

## Deliberate non-changes

- No D1 migration.
- No Production D1 read/write for diagnosis.
- No backend inventory arithmetic change.
- No automatic catalog merge/cleanup.
- No Branch2 change.
- No Arrival UI redesign.
- Write-off and exact correction retain their accepted business/runtime paths; W4 only makes them secondary in navigation.

## Adjacent audit targets

Focused/cumulative checks cover transfer picker behavior, manager-safe Operations, frozen Arrival, W3 recovery, order/handover/return/exchange invariants, DB safety and build. W6 remains responsible for true catalog cleanup; W4 only prevents catalog noise from dominating daily movement work.

## Next

Use Production feedback to tune the first-screen variant limit and wording. If the picker still feels heavy, W4.1 can switch the six primary variants from compact table rows to touch-friendly cards without changing movement semantics.
