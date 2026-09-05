# W5.3 — Several-item check as a short queue

Date: 2026-09-05
Base Production: `a780693c92eabd9c37753193d36984ba10766b9a` (`W5.2: make short stock checks effortless`)

## Goal

Make `Проверить несколько товаров` understandable before the session starts. The employee should see exactly what they selected, how much work it implies, and be able to remove mistakes immediately. It stays voluntary and uses the existing resumable stocktake session underneath.

## Changes

- The picker now says `Соберите короткую проверку` when empty.
- Selected products are always shown in a separate `Вы будете проверять` queue, even when the search field filters them out of the candidate list.
- Each selected product is a removable chip with its position count; `Очистить` resets the queue in one action.
- Selected products also sort to the top of the current candidate list.
- The queue tells the employee both product count and exact position count before starting.
- Over 20 positions is an advisory `довольно большая проверка`; it is never a hard block and can still be started as-is.
- Empty search-result copy explicitly says already selected products remain above.
- Start summary reads `Готово к проверке · N товаров · M позиций`.
- Responsive CSS makes selected chips, search and queue actions comfortable on <=680/420px screens.

## Invariants

- No new D1 reads, endpoint, table or migration.
- Existing stocktake session creation/autosave/retry behavior unchanged.
- No compulsory check and no artificial maximum queue size.
- Full revision behavior unchanged.
- Arrival UI frozen and untouched.
- Branch2 untouched.

## Next

W5.4 should focus only on the full revision's strict workflow and remaining comprehension gaps (blind counting, progress, review, cancellation/resume) without redesigning the revision interface the users already like.
