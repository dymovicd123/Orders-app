# CLIENT-ZAMMLER completion checkpoint — 2026-09-24

## Classification

CLIENT-ZAMMLER is a separate client request. It is **not** roadmap Stage04.

Historical filenames/commit messages created during the first implementation pass may contain `Stage04-ZAMMLER`. Treat that wording only as an old label; it must not be used to infer that roadmap Stage04 started or was completed.

The main roadmap remains unchanged:
- Stage03 client-policy decisions remain pending.
- Roadmap Stage04 remains paused until the client answers the required business questions.
- Do not infer or invent those answers from CLIENT-ZAMMLER.

## Completed CLIENT-ZAMMLER scope

The request is implemented using the existing Orders / Workshop model, without a parallel ZAMMLER order table.

1. Existing delivery reference `ЗАММЛЕР` is reused; the accidental Latin duplicate was removed on Branch2.
2. Workshop deadline time is supported end-to-end with `workshop_due_time` / `due_time`.
3. Orders has a dedicated `ЗАММЛЕР` create surface:
   - delivery fixed to `ЗАММЛЕР`;
   - first payment method fixed to `КАСПИ МАГАЗИН`;
   - when a line is switched to Workshop, urgency + order date + default time `20:00` are prefilled;
   - date/time remain editable.
4. The ZAMMLER panel has its own order list, but it reads the normal `orders` model with an exact `delivery_type = 'ЗАММЛЕР'` server filter.
5. Workshop has a separate operational ZAMMLER invoice mode:
   - ordinary Workshop invoice excludes ZAMMLER;
   - ZAMMLER invoice includes only ZAMMLER tasks;
   - deadline is shown as date/time and overdue state;
   - text / DOCX / PDF / print exports use the ZAMMLER-specific title and deadline column.
6. Existing order actions, pagination and shared filters are reused; no parallel `zammler_orders` or separate financial model was introduced.

## Branch2 verification

Final Branch2 implementation head before this context checkpoint:
- `c58b6da236a51953b3ebf2a30860e76c0f83615a`
- `CLIENT-ZAMMLER-F3: align Workshop grouping regression`

Cloudflare deploy monitor:
- run `36007342788` — **success**

The F failure chain was fully repaired:
- F1 aligned the legacy small-screen Workshop header regression;
- F2 removed a stale unused Workshop selection binding and refreshed the exact frontend manifest;
- F3 aligned the older Workshop grouping regression with the new exact ZAMMLER grouping.

## Production release

Production schema preparation:
- main commit `f8c6a0c5ac550f21305675f114a08f369ea8b212`
- migration workflow `36008226771` — **success**
- Cloudflare deploy monitor `36008226845` — **success**

Migration `0075_v72_zammler_workshop_due_time.sql` is schema-only and adds:
- `order_items.workshop_due_time`
- `workshop_tasks.due_time`

The production workflow verified the existing Cyrillic `ЗАММЛЕР` reference, rejected a Latin duplicate, preserved business-row counts, and added only missing columns.

Production runtime release:
- PR #194 — merged
- pre-merge quality run `36011402118` — **success**
- main commit `8d0c6c3be08fd1602b9db0c2b2f2d57ea4b22a43`
- Cloudflare deploy monitor `36011578507` — **success**

The cumulative release gate includes `CLIENT-ZAMMLER Production runtime`, which verifies the dedicated create/list flow, exact delivery filter, due-time plumbing, separate Workshop invoice scope, and absence of a parallel ZAMMLER data model.

## Current boundary / next action

CLIENT-ZAMMLER is technically complete and deployed to Production.

Do not continue into roadmap Stage04 from this checkpoint. The next roadmap work remains blocked by the client's unanswered business rules from the Stage03 pre-client checkpoint.

Until the client answers, only:
- fix a concrete defect found in CLIENT-ZAMMLER acceptance;
- make a narrowly requested client change;
- or work on an unrelated explicitly requested item.

Canonical Stage03 boundary:
`docs/continuation/STAGE03_H6_PRE_CLIENT_READINESS_20260923.md`
