# Catalog Resolver emergency block — R8 checkpoint

Date: 2026-09-19  
Repository: `dymovicd123/Orders-app`

## Canonical resolver sequence

This file records the current emergency resolver plan so R7 is not mistaken for the end of the work.

- R4 — DONE: resolver/session reliability across consecutive orders.
- R5 — DONE: canonical `variant_id` / SKU truth outranks stale order snapshots.
- R6 — DONE: deterministic auto-resolution and safe missing-combination creation; no guessing of omitted unisex gender/color/size.
- R7 — DONE: every human decision inside Orders is scoped to one order item only.
- R8 — THIS CHECKPOINT: show only the real unresolved human question.
- R9 — NEXT: clean completion with fresh order readback and automatic continuation of the original shipping action.
- R10 — AFTER R9: full acceptance matrix / replay and consecutive-order proof.

Stage02 Warehouse remains paused while R8-R10 are completed. Arrival and pricing are out of scope.

## R8 behavior

For an ordinary resolver state where the product is already known and the next unresolved decision is one field:

- do not repeat the manager snapshot;
- do not repeat already-known canonical characteristics;
- do not show the admin/catalog fallback;
- do not show resolver status chatter or the generic blocking guard;
- show the product name plus exactly the missing question;
- gender is phrased as `Не указан пол` with `Жен` / `Муж`;
- the admin-only historical unknown-gender escape remains available as the compact human action `Не удалось выяснить`, without exposing internal catalog terminology.

Product identification, compound-name classification, reference-value creation and the advanced explicit admin fallback remain unchanged. R8 does not yet remove the post-answer confirmation/completion step; that belongs to R9.

## Safety boundary

R8 is frontend/question-surface only. It does not change:

- Worker resolver semantics;
- line-scoped R7 mutation behavior;
- deterministic R6 auto-resolution;
- physical stock / reservation rules;
- D1 schema or data;
- Stage02 Warehouse;
- Arrival;
- pricing.

## Validation

Validated source before this context file: `73cc951c3c402b3b4de083e1d40ccddcee776b73`.

GitHub Quality run `35440994157` completed SUCCESS:

- focused real-component resolver UX regression;
- R4/R5/R6/R7 regressions;
- dedicated R8 minimal-question regression;
- R8 -> R7 -> historical frontend structural reconstruction chain;
- full cumulative release gate;
- TypeScript;
- clean Vite build;
- bundle budget;
- Wrangler Branch2 dry-run;
- all downstream historical package regressions.

PR #123 targets `branch2` only. Production promotion must carry only the validated R8 delta and must not pull unfinished Stage02 work from Branch2.

## Next action

After Branch2 merge/deploy confirmation, promote only R8 to current Production `main`. Then begin R9 clean completion.

R9 target invariant:

> After the last necessary human answer, obtain fresh server order truth and continue the original shipping action automatically. The resolver closes only after the result is proven; no stale `Уточнить товар`, manual second send, empty-list dead end, or duplicate write after lost response.
