# Catalog semantic SKU identity — 2026-09-27 checkpoint

Repository: `dymovicd123/Orders-app`

## Incident

Production read-only forensic found that `ЭТНО КАРДИГАН` could have two active physical SKU identities for a human-equivalent color spelling such as:

- `СВЕТЛО-СЕРЫЙ`
- `СВЕТЛО СЕРЫЙ`

Resolver R13 already treated harmless dash/space differences as one known human fact, while Catalog exact SKU lookup and Arrival materialization could still treat those spellings as different concrete `variant_id` values.

This created a real split between physical stock and order resolution: stock could exist on one variant while an order resolved to the punctuation-equivalent sibling and reported shortage.

## Production evidence captured before code change

The diagnostic was read-only against Production D1 `orders_db_prod`; the run reported `rows_written: 0` and `changed_db: false`.

Concrete `ЭТНО КАРДИГАН` findings included semantic duplicate pairs under the same execution:

- size 46: variants `1277` / `1438`
- size 48: variants `1278` / `1436`
- size 50: variants `1279` / `1441`
- size 56: variants `1303` / `1473`

A separate valid shortage also existed and must not be confused with this defect: for variant `1457` physical stock was 2 while active reservations totaled 3, so its negative free quantity was legitimate.

Fresh Arrival-created variants `1467`–`1472` were confirmed to exist with positive physical stock. The incident therefore was not a generic “Arrival failed to write stock” failure.

## Code prevention completed

The runtime fix deliberately preserves existing history and does not rewrite D1 data.

New invariant:

1. exact concrete SKU spelling remains the fast path;
2. if exact lookup misses, Catalog can reuse a punctuation-equivalent color identity;
3. newly materialized Catalog combinations use one stable punctuation-insensitive color spelling;
4. Arrival materialization uses exact-first + semantic fallback and de-duplicates punctuation-equivalent colors inside one physical operation;
5. the resolved inventory snapshot follows the actual Catalog variant selected;
6. existing historical duplicate rows are not silently merged by runtime code.

Examples such as `СВЕТЛО-СЕРЫЙ`, `СВЕТЛО СЕРЫЙ`, `СВЕТЛО–СЕРЫЙ`, and `СВЕТЛО‑СЕРЫЙ` are one semantic color identity for creation/reuse purposes.

## Release evidence

### main / Production

- PR #220: `Catalog identity: prevent punctuation-equivalent color SKU splits`
- merged runtime SHA: `645b54ae320e45e1d34861f2e6e715819fcf5e43`
- pre-merge Quality check run: `36320840253` — success
- exact merged-SHA Cloudflare deploy run: `36320979456` — success
- combined status: `cloudflare-deploy/main = success`

No migration, D1 correction, backfill, or historical rewrite was part of PR #220.

### branch2

- PR #221: `Branch2 Catalog identity: prevent punctuation-equivalent color SKU splits`
- merged runtime SHA: `56f24c0dd9a883de966d9dccf31bf456d86422b1`
- Branch2 cumulative candidate tree validation run: `36320955570` — success
- validation branch final tree had no file diff from PR #221 candidate; the extra CI marker was created and removed before the successful validation run
- Stage03 Branch2 safety run on merged SHA: `36321055413` — success
- exact merged-SHA Cloudflare deploy run: `36321055507` — success
- combined status: `cloudflare-deploy/branch2 = success`

No Stage03 pricing/runtime rewrite and no Branch2 D1 correction were part of PR #221.

## What remains intentionally unfinished

The code now prevents this punctuation split from continuing to create new physical identities, but existing duplicate rows are still present until a separate controlled data-correction phase.

Next chunk must be treated as a data-integrity operation, not as another ordinary code patch:

- freshly re-open GitHub first;
- read-only audit Production and Branch2 D1 separately;
- do not assume Branch2 has the same duplicate rows or IDs as Production;
- prove keeper/retired mapping per semantic collision;
- prove physical stock, active reservations, open orders, Workshop, transfers, lifecycle, stock checks/stocktakes, aliases, and current stock rows before mutation;
- preserve historical movement/order snapshots;
- never copy/sync data between Production and Branch2;
- use exact Worker + logical D1 name + D1 id guards before any mutation;
- make the correction retry-safe/idempotent and leave an audit record;
- verify current Physical / Reserved / Available after correction and only then retire duplicate working variants.

Do not merge these existing rows merely because the text looks similar unless the full execution + category + gender + semantic color + size identity is proven equal.

## Scope boundary

Arrival UI remains frozen. The change is a backend Catalog/materialization identity safety fix triggered by a concrete defect; it is not a redesign of Arrival.

Stage03 remains separate: Branch2 keeps its complete Stage03 runtime; main does not gain Stage03 through this work.
