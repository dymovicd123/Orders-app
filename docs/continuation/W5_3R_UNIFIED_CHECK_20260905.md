# W5.3R — Unified Check, 2026-09-05

## Why
The Check start screen had two competing workflows: an older `Короткая проверка` card and the newer selective stocktake queue. The result looked like two generations of UI stacked together, recommendations could appear only after a manual refresh in some sessions, and the copy included implementation/conversation rationale that did not help the operator.

## Change
- The duplicated `Короткая проверка` card is removed from the Check page.
- `Проверить несколько товаров` is now the single small-check workflow.
- Cycle-count suggestions are used only as recommendations inside that same picker; they add products into the ordinary selective queue and use the existing stocktake session flow.
- Recommendations load automatically when the Check page is open in selective mode. A retry button appears only after a real load error.
- Manual search, removable selected queue, advisory large-selection warning, and full-point check remain.
- The low-risk one-click physical check remains in `Остатки`, where it is contextual and does not compete with the revision workflow.
- The conversation-derived sentence `Это подсказка, а не блокировка работы.` is removed from operator UI.

## Mobile and action hierarchy
- recommendation cards become one column on small screens;
- recommendation and start buttons have large tap targets;
- the primary start button becomes full width on phones;
- selected items remain removable and wrap safely.

## Safety
- no migration;
- no D1 mutation or Production forensic read;
- Arrival JSX remains frozen;
- full check behavior is unchanged;
- W5.2 blind-first rule for risky quick checks remains enforced in `Остатки`.
