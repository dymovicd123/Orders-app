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

## Controlled data correction completed

The runtime prevention above remains unchanged. A separate guarded D1 correction was completed independently in Production and Branch2; data was never copied between environments.

### Production

Fresh correction preflight run `36326963839` succeeded and proved the exact active semantic mappings:

- `480 -> 1084` — `УКРАШЕНИЕ`, no-size spelling normalized to the stable active keeper;
- `1277 -> 1438` — `ЭТНО КАРДИГАН`, size 46;
- `1278 -> 1436` — size 48;
- `1279 -> 1441` — size 50;
- `1303 -> 1473` — size 56.

The source variants had no active reservations, open unsent orders, active/ready Workshop work, pending lifecycle events, or active stocktake blockers. Current canonical references were repointed to the keepers while historical textual snapshots and stocktake history were preserved.

Production correction run `36327111635` deliberately failed its own post-verification after exposing a defect in the temporary correction runner: its self-referential stock rollup UPDATE zeroed source rows before the keeper sum was safely preserved. The immutable pre-correction stock baseline made the exact damage measurable: Physical lost 9 units from `480/1084` in Warehouse and 1 unit from `1303/1473` in Warehouse. No later physical movement occurred after the baseline capture.

Guarded recovery run `36327687609` then restored only those proven quantities from the immutable baseline, with stale-state guards, environment guards, active-reservation checks, protected-history hashes, and a recovery audit row. Read-only post-recovery verification run `36327815950` succeeded.

Final relevant Production current truth after recovery:

- keeper `1084`: Warehouse Physical 9 / Reserved 0;
- keeper `1438`: Warehouse Physical 0 / Reserved 1;
- keeper `1436`: Boutique Physical 0 / Reserved 0;
- keeper `1441`: Warehouse Physical 2 / Reserved 1;
- keeper `1473`: Warehouse Physical 2 / Reserved 1;
- retired sources `480, 1277, 1278, 1279, 1303` carry no current Physical/Reserved quantity;
- active reservations remain on keepers `1438`, `1441`, and `1473`, one unit each;
- current canonical source-ID references are zero in orders, inventory movements, Workshop, reservations, aliases, lifecycle, transfers, stock checks, and operation evidence;
- protected historical order/movement/stocktake/transfer facts retained the exact pre-correction hashes.

Final Production semantic audit: run `36322036163`, attempt 3 — success, `activeCollisionGroups: 0`.

### Branch2

Branch2 was audited and corrected separately. Preflight run `36326966628` succeeded. Its exact mappings were:

- `480 -> 1084`;
- `1277 -> 1438`;
- `1278 -> 1436`;
- `1279 -> 1441`.

Branch2 did not have the Production-only active `1303/1473` collision, so that mapping was not copied or invented there. These Branch2 duplicate rows had no current stock or operational references before correction.

Branch2 correction run `36327113370` — success. Final Branch2 semantic audit: run `36322040358`, attempt 3 — success, `activeCollisionGroups: 0`.

### Historical truth after correction

The correction retires duplicate **active working identities**; it does not delete old Catalog rows or rewrite historical textual snapshots. Inactive/historical semantic equivalents therefore may still appear in historical audit data, which is intentional.

The D1 correction also left explicit audit evidence:

- `catalog_semantic_variant_corrections` records source -> keeper mappings;
- `catalog_semantic_stock_correction_baseline` preserves the immutable pre-correction current-stock baseline;
- Production recovery additionally records `catalog_semantic_stock_recoveries`.

The temporary correction/recovery workflows live only on isolated correction branches and are not runtime code intended for `main` or `branch2`.

## Scope boundary

Arrival UI remains frozen. The change is a backend Catalog/materialization identity safety fix triggered by a concrete defect; it is not a redesign of Arrival.

Stage03 remains separate: Branch2 keeps its complete Stage03 runtime; main does not gain Stage03 through this work.
