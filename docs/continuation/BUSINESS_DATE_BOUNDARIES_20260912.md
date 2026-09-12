# Business date boundaries — 2026-09-12

Production baseline before this change: `bed033851fd0f7d24ddbffcbb598da5c32b3edab`.

## Problem found

Several date-only business workflows still derived “today” or the current month from UTC (`toISOString().slice(...)`) or from the browser/device timezone. Around the Kazakhstan day/month boundary this could move operational records and filters to the previous day/month even though the main Dashboard Worker had already been corrected.

Affected paths found by the repository-wide audit:

- Dashboard workshop due-date sorting/tone/status;
- order shipping date;
- team timesheet current month;
- Worker `normalizeDate()` fallback/timestamp conversion;
- archive default cutoff;
- Workshop today/yesterday/month period resolution;
- activity/report default date range;
- team default current month.

True event timestamps remain UTC ISO timestamps. Only date-only business semantics are changed.

## Fix

- Frontend date-only helpers use explicit `Asia/Almaty` calendar parts.
- Date-only arithmetic is performed from normalized YYYY-MM-DD values so browser timezone cannot move a month/day boundary.
- Dashboard and order shipping reuse the same frontend business-date helper.
- Worker `normalizeDate()` resolves empty/default and timestamp inputs in `Asia/Almaty` while preserving YYYY-MM-DD and DD.MM.YYYY input semantics.
- Archive, Workshop, activity-report and team defaults now flow through the business-date normalization.
- No migration and no D1 write are required.
- Arrival / `Приход` is untouched.
- Branch2 is untouched.

## Permanent regression protection

- `scripts/test-business-date-boundaries-r1.mjs`
- `scripts/business-date-boundaries-r1-worker-manifest.json`
- `scripts/business-date-boundaries-r1-frontend-manifest.json`
- exact 190.6A and 190.6B cumulative preservation layers
- focused test is part of permanent `npm run release:check`

The focused test explicitly checks the Kazakhstan boundary where `2026-09-12T20:30:00Z` is already `2026-09-13` in Almaty, and the month rollover where `2026-09-30T20:30:00Z` is `2026-10-01`.

## Validation

Guarded finalizer run `34691154603` passed:

- focused business-date regression;
- full cumulative `npm run release:check` including exact Worker/frontend structural gates;
- TypeScript typecheck;
- production build;
- temporary patch/finalizer workflow/scripts removed before the finalized runtime commit.

Final validated feature commit: `6dddfa7b33daef02d290741e346c5e6e2f5e7c9c`.
