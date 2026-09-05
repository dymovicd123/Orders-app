# W2 Attention Refresh R1

Date: 2026-09-05

## Fixed
- `Склад → Нужно уточнить` now owns one detailed refresh on panel entry instead of starting duplicate detail reads from navigation and the panel effect.
- A reused in-flight summary can no longer overwrite a newer detailed response and make the problem rows disappear.
- A cached summary no longer replaces already loaded detail rows.
- While the Attention panel is active, generic Attention reads are upgraded to the detailed response shape.
- If the detailed request fails, the panel shows a refresh error instead of silently showing counts without rows.
- Known-item intake reuses the Attention payload already loaded by reconciliation instead of unconditionally issuing the same detailed read twice.

## Invariants
- No D1 migration.
- No Worker mutation/business-rule change.
- Arrival UI unchanged.
- Branch2 unchanged.
- No visual/UI acceptance in this hotfix; only source/regression/build/dry-run gates.

## Continue from
After Production deploy succeeds, discuss the next Warehouse actions with the user.
