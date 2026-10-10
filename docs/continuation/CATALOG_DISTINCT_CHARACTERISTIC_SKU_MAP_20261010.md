# Distinct-characteristic source-to-keeper SKU mapping — read-only phase (2026-10-10)

## Why a separate model
A user may decide that reference value ХАКИ should be replaced by ЗЕЛЁНЫЙ, or ДРАП by ШЕРСТЬ. Unlike punctuation-equivalent names, this changes an actual **business characteristic**; SKUs are not automatically interchangeable. A stock split between warehouse and boutique, active client reserves, new executions, prices, already shipped order snapshots, return/exchange history and workshop obligations must all remain accountable.

## New read-only admin endpoint
`GET /api/reference-values/characteristic-sku-plan?sourceId=...&targetId=...&afterVariantId=0&limit=20`

- Supports color, material, length, adult size and child age only. Source and target must be actual values from the same reference list, target active, IDs different.
- Enumerates **all affected source variants with stable ID-keyset pagination** (1–50 per page); no hidden 400-row cutoff.
- Examines all existing active target candidates in the same product with bounded 200-row query pages, matching **all other business attributes**. Color/size changes require same underlying execution identity, material/length may require mapping between distinct executions while checking that variant and execution metadata agree. Wrong product, category, gender, other colors or other sizes never become candidate keepers.
- Per source variant, reports `unique_keeper`, `ambiguous_keepers`, `no_keeper`, `needs_execution_review`, or `historical`. Multiple matching keepers are **not** silently resolved to first ID.
- For unique source→target suggestions, shows physical and reserved quantity at warehouse/boutique separately, active reserve count, and active unsent order count.
- ALWAYS returns `canApply=false`, each row `canAutomaticallyMerge=false`, `noChangesApplied=true`. This **does not** call the existing exact-SKU merge writer, which rightly rejects genuinely different characteristics. History, money, stock and customer orders remain untouched.
- Tests include 430 source variants, keeper absent / unique / ambiguous, wrong gender excluded, inactive source, distinct material executions, missing execution proof, child ages, warehouse/boutique reserves, active orders and pure zero-write DB review. Adds cumulative Stage04-safe gate.

## Next
Connect the paginated map to the existing human-facing **Справочники → Объединить значения** review, explaining what needs human decision per SKU. Then design append-only, explicit, atomic characteristic-reclassification contract **only** for cases with fully verified current stock and customer commitments. No broad retagging of orders or stock and no hidden automatic material-to-material inventory merge. Always recheck fresh source/keeper identities and all physical evidence at final write time; avoid employee locks. No production main/D1 changes or main merge.
