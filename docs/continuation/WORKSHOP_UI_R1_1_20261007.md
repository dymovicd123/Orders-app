# Workshop UI R1.1 — 2026-10-07

## Scope

Small Branch2 follow-up after visual acceptance of the Workshop redesign. No broad redesign, Worker change, migration, or D1 mutation.

## Changes

- Removed the hard-coded Kaspi subtitle claim that the deadline is always 20:00. The UI now says only that this is a separate priority queue; factual order deadlines still come from each task.
- Returning from `Накладная` to `Заказы` restores the all-date operational queue, so an invoice's bounded month cannot silently hide older unfinished Workshop work.
- Hid the legacy generated `особый` marker in the human-facing invoice table; the underlying special-order grouping behavior is unchanged.
- Updated Workshop regression coverage and the exact frontend preservation manifest.

## Boundary

Keep this as R1.1. Larger Workshop UX changes, if still needed, belong to Stage04.
