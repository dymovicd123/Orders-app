# W6.4 — Safe SKU card and catalog lifecycle

Date: 2026-09-06

## Goal

Finish the W6 catalog interaction so an exact size/age tile is treated as a stable SKU, not as an invitation to rewrite its identity.

The human path is now:

`Товар → Исполнение → Цвет → Размер/возраст → Карточка точной позиции`

The authoritative identity remains the existing `variant_id`.

## User-facing behavior

- Clicking an exact size/age opens a compact SKU card instead of the generic editor.
- The card shows the exact product context, type, gender, color, size/age, material, length, Warehouse quantity and Boutique quantity.
- The existing `catalog-variant-commercial-anchor` and `data-variant-id` remain in place for future commercial/price work.
- Admin-only actions are separated by intent:
  - `Создать похожий` starts a new variant with copied characteristics and `id=0`; the save path is POST/new identity.
  - `Исправить ошибку` opens the existing variant only as an exceptional correction path. The server still refuses any identity rewrite after the SKU has operational usage.
  - `Вывести из каталога` is a two-step soft-retirement action. It never deletes history.
- Managers get the same read-only SKU facts but no SKU mutation actions.
- The generic correction editor is explicitly labelled as correction of a newly created position, not ordinary editing.

## Retirement safety

`updateCatalogVariant` now has an authoritative runtime guard before `is_active` can move from 1 to 0.

Retirement is blocked when the variant has any of these live dependencies:

- non-zero physical stock in Warehouse/Boutique;
- non-zero stock reservation snapshot or active reservation rows;
- an active, not-yet-sent order using the SKU;
- an active/ready Workshop task;
- a pending return/exchange lifecycle movement;
- participation in an active stocktake.

Identity correction and deactivation are also forbidden in the same request.

Historical use alone does not prevent soft retirement once live dependencies are gone; historical references are preserved. Historical use *does* continue to prevent identity rewriting through the pre-existing `catalogVariantHasOperationalUsage` gate.

## Mutation reliability

The SKU-card retirement path treats the successful PATCH as authoritative.

A later catalog refresh cannot convert a successful retirement into a false mutation failure. If the refresh is unavailable, the UI tells the user to refresh and explicitly says not to repeat the retirement write. A lost/ambiguous transport response likewise tells the user to refresh before any repeat.

## Regression/adjacent checks

W6.4 adds `scripts/test-w6-4-catalog-sku-card.mjs` to cumulative `release:check` and updates the W6.3 regression gate because the exact-size action intentionally changed from direct editing to opening the SKU card.

The gates protect:

- Product → Execution → Color → Size hierarchy;
- exact `variant_id` anchor;
- create-similar vs correction separation;
- server-side retirement blockers;
- post-write refresh reliability;
- manager/admin boundary;
- mobile SKU-card layout;
- valid `СТАНДАРТ` semantics;
- frozen Arrival workspace.

## Scope boundaries

- No migration.
- No Production D1 read or write was required for implementation.
- Arrival behavior/UI remains frozen.
- Branch2 is untouched.
- No price field or price semantics are invented in W6.4.

## Handoff

After W6.4 passes build/deploy acceptance, W6 catalog interaction can be treated as closed for this scope. W7 can add history/commercial information to the stable exact-SKU card without changing SKU identity semantics.
