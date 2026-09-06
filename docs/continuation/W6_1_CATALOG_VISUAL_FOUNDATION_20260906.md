# W6.1 — Catalog browse-first visual foundation

Date: 2026-09-06
Base Production/main: `759f5b49cfa318fe1d1b9e274616fb29cf45a521` (`W5.7: final Warehouse adjacent audit`)
Branch: `w6-1-catalog-visual-foundation`

## Why this step exists

W6 is the Catalog redesign phase. The existing Catalog is structurally safe but visually reads like an administrative/technical stopgap: the new-product form appears before the catalogue, expanded products lead with edit controls, and variants are shown as a wide technical table. This makes ordinary browsing cognitively expensive and lets master-data editing compete with the main question: “what products and real variants do we have?”

The accepted W6 direction remains browse-first: `Товар → Исполнение → Вариации`. W6.1 intentionally starts with a presentation-only hierarchy change before changing renderer semantics or catalogue identity.

## W6.1 changes

- Added `src/styles/w6-catalog-browse.css` as a dedicated late cascade layer.
- The product catalogue list is visually ordered before the `Новый товар` master-data form.
- Product cards are calmer and denser; the large old technical accordion treatment is reduced.
- Product actions remain available but no longer dominate the title row.
- Inside an expanded product, the variant list comes before product-edit controls.
- The old six-column variant table is presented as adaptive human cards instead of a desktop spreadsheet-like grid.
- Type/gender/characteristics/size/physical stock/action receive a clear card hierarchy.
- Product and variant editors remain fully available and are visually secondary, not removed.
- Mobile layout has explicit 760px and 460px contracts with larger action targets and a one-column variant flow.
- The W6 layer is imported from the last Warehouse style module so older Catalog/Warehouse CSS cannot silently override the new hierarchy.

## Deliberate non-changes

This is not the whole W6 redesign.

- No renderer/business logic changed.
- No endpoint, D1 read, D1 write, schema or migration changed.
- No catalogue product/variant identity changed.
- No SKU was created, retired, renamed or deleted.
- Valid `СТАНДАРТ` semantics remain accepted.
- Existing `Уточнить товары`, `Ожидают движения` and clothing-reference workflows remain intact.
- Existing save product / save variant actions remain intact.
- `Найти в остатках` remains intact.
- Arrival UI is frozen and untouched.
- Branch2 is untouched.

## Regression gate

Added `scripts/test-w6-1-catalog-visual-foundation.mjs` and appended it to cumulative `npm run release:check`.

The gate protects:
- browse list before master-data creation;
- variant-card hierarchy;
- edit controls remaining available;
- mobile contracts;
- existing Catalog write/navigation markers;
- valid `СТАНДАРТ` semantics;
- frozen Arrival markers.

## What W6 still needs

W6.1 fixes the visual hierarchy, but the full product model is not finished. The next W6 slice should change the actual renderer semantics, not merely styling:

1. make the default expanded product genuinely read-only/browse-first;
2. group variants by meaningful `Исполнение` (`материал + длина`), with `СТАНДАРТ + СТАНДАРТ` shown as a human “Основное исполнение”, not technical text;
3. show `Вариации` inside an execution as concise gender/color/size combinations;
4. open product/variant editing only from an explicit edit action;
5. make creation a deliberate master-data action rather than a permanent form;
6. improve search so it can find a product through meaningful variant characteristics without exposing internal IDs;
7. preserve exact product/variant IDs and all current safe write rules underneath.

Do not treat W6.1 alone as W6 complete.
