# W5.2 — Short physical check

Date: 2026-09-05
Base Production: `4d96abe35037ec1baabb4bfb85969672974fb40d` (`W5.1: clarify Warehouse checking flow`)

## Goal

Make the small voluntary check genuinely fast without weakening physical truth. A normal row should take one obvious tap when the system amount is visibly correct. A risky row must still be independently counted before the system amount can influence the answer.

## Changes

- `Проверить сейчас` is the prominent action while the short check is closed; `Свернуть` becomes secondary once it is open.
- Normal rows get one explicit local confirmation: `Да, на месте N`.
- Tapping that confirmation only fills the local fact field. It does not write inventory immediately.
- If the real amount differs, the same row exposes `Другое количество`.
- Risky rows (negative availability or a previous difference) keep the W5.1 blind-first rule and do not get a system-value quick-confirm action.
- The only write remains the existing `submitCycleCount()` action, now labelled `Сохранить проверенные позиции · N`.
- Consequence copy states that only rows with a confirmed/entered physical fact are saved; equal counts are still recorded as a fresh check.
- Mobile layout makes open/save/quick-confirm/input actions full-width and >=46–50px where appropriate.

## Invariants

- No new endpoint, table, migration or background read.
- No immediate mutation on quick confirmation.
- Existing cycle-count reconciliation remains the sole mutation path.
- Risky rows stay blind-first.
- Full revision/session logic unchanged.
- Arrival UI frozen and untouched.
- Branch2 untouched.

## Next

W5.3 should simplify `Проверить несколько товаров` into a short, understandable voluntary queue while retaining the existing safe resumable stocktake session underneath.
