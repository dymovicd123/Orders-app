# W6.2 — Catalog master/detail redesign

Date: 2026-09-06
Base Production/main: `e584d4d0f98f30d62695b7d308b586d44d567958` (`W6.2A: compact Catalog after visual acceptance`)
Branch: `w6-2-catalog-master-detail`

## Goal

Replace the remaining technical accordion/table mental model with the accepted human catalogue model:

`Товар → Исполнение → Вариации`

The Production screenshot after W6.1/W6.2A made the desired direction explicit: use the desktop width, keep the product list compact, put one selected product into a dedicated detail surface, keep creation/editing deliberate, and stop exposing technical defaults as if they were user-facing product language.

## Main UX changes

- Desktop is now true master/detail:
  - compact product navigation on the left;
  - selected-product sheet on the right.
- Product rows no longer repeat `Открыть / Найти / Редактировать / + Вариант`.
- Product list text avoids zero-heavy summaries such as `Детские: 0`.
- `+ Новый товар` is a top-level deliberate action. The form opens in the detail pane instead of living permanently before/after the catalogue.
- Search is local to the catalogue and can match product name plus meaningful variant fields: category, gender, color, material, length and size/age.
- Selected product variants are grouped by execution (`material + length`).
- `СТАНДАРТ + СТАНДАРТ` is rendered to ordinary users as `Основное исполнение`.
- Non-standard execution names remain truthful: material, length, or both are shown when they carry real meaning.
- Variations inside an execution are concise rows with color, gender, adult/child type, size/age and physical quantity by Warehouse/Boutique.
- Product editing and variant editing are explicit actions from the selected product sheet.
- Mobile becomes list → detail: before selection only the product list is shown; after selection the detail sheet replaces it and gets an explicit `← К товарам` action.

## Preservation strategy

The previous Catalog renderer was preserved byte-for-byte as `catalogLegacyAdminModes.tsx`. W6.2 delegates all non-catalog administrative modes to that proven renderer:

- `Уточнить товары`;
- `Ожидают движения`;
- `Характеристики одежды`.

This keeps W6.2 focused on ordinary catalogue browse/edit UX without rewriting the already stabilized exception-resolution workflows at the same time.

## Safety / non-changes

- No endpoint change.
- No D1 read/write change.
- No schema or migration.
- No product/variant identity rewrite.
- No automatic SKU creation, retirement, rename or deletion.
- Exact `product_id` / `variant_id` remain authoritative underneath the UI.
- `СТАНДАРТ` remains a valid stored value; only the browse label changes.
- Existing `saveCatalogProduct()` and `saveCatalogVariant()` write paths are reused.
- Warehouse stock truth and reservation math are unchanged.
- Arrival UI remains frozen and untouched.
- Branch2 remains untouched.

## Regression gate

Added `scripts/test-w6-2-catalog-master-detail.mjs` to cumulative `release:check`.

It protects:
- legacy exception-mode delegation;
- true master/detail DOM structure;
- Product → Execution → Variations grouping;
- human `Основное исполнение` label;
- characteristic-aware search;
- explicit creation/editing actions;
- compact desktop product rows;
- mobile list/detail contract;
- existing Catalog write markers;
- valid `СТАНДАРТ` semantics;
- frozen Arrival marker.

## W6 status after this step

W6.2 completes the main browse/edit interaction model. Remaining W6 work should be an acceptance/audit pass rather than another structural redesign: inspect real Production catalogue data in the new hierarchy, identify proven retirement candidates only, verify awkward products/variants, and close any concrete mobile/desktop UX defects without broadening scope into stock or Arrival logic.
