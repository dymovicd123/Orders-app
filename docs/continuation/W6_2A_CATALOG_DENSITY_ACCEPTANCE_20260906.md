# W6.2A — Catalog density acceptance

Date: 2026-09-06
Base Production/main: `5efe5847a65070c8325cbafca40d42ad3c38f3dc` (`W6.1: Catalog browse-first visual foundation`)
Branch: `w6-2a-catalog-density`

This step responds to the first Production visual acceptance of W6.1. The screenshot showed three clear problems: the catalogue used only about half of the available desktop width, repeated product cards were too tall and tiring, and the permanent `Новый товар` form lived after the last catalogue item.

W6.2A is intentionally presentation-only. It does not claim the full W6.2 `Товар → Исполнение → Вариации` semantic renderer complete.

## Changes

- Use the full desktop width with a dense responsive product grid.
- Closed product cards are much shorter and no longer repeat three secondary action buttons.
- Opening a product expands that product across the available catalogue width and reveals its actions/details.
- `Новый товар` returns to the top of the catalogue workspace, but as a compact secondary master-data strip rather than a large primary block.
- Variant cards inside an opened product are denser.
- Catalogue summary cards are reduced so they inform without looking like a dashboard.
- Mobile remains a one-column flow with full-width actions.

## Safety / non-changes

- No Catalog renderer/business logic change.
- No endpoint, D1 read/write, migration, SKU identity or stock truth change.
- No product/variant creation, retirement, rename or deletion performed by this step.
- `СТАНДАРТ` semantics unchanged.
- Arrival remains frozen and untouched.
- Branch2 remains untouched.

## Next W6 slice

The intended full semantic redesign remains master/detail: compact product navigation plus a selected-product sheet grouped as `Товар → Исполнение → Вариации`. W6.2A first removes the obvious visual waste and fatigue found in Production so that the next renderer change starts from an accepted density baseline.
